// Make a commands.json from COMMAND's output
// Assumes max subcommand depth of 1
// Requires Redis from guybe7/redis/cmd_ptr
// Open:
// * SORT has unknown key_specs
// * Need to extract return types
// * The QUIT command doesn't exist in the commands table
// * MD deprecation text needs to be edited out
// * since field for new args (i.e. history)
// Notes:
// * The `movablekeys` server flag is deprecated intentionally
// 
// * Adds until, replaced_by, internal & undocumented fields, and 'pure-token' type, group=cluster

import { createClient } from 'redis';
import { promises as fs, existsSync, readFileSync } from 'fs';
import { assert } from 'console';

const options = {
  noreturn: false,
  noargs: false,
}

const docPath = process.env.REDIS_DOC || '../redis-doc';
const srcPath = process.env.REDIS_SRC || '../redis';
const outputPathJSON = './json';
const outputPathMD = './md';

function makeTbdStr() {
    var i = 0;
    function tbd() {
      i = i + 1;
      return `__TBD__${i}__`;  
    }
    return tbd;
}
const getTbdStr = makeTbdStr()

function convertType (t) {
  if (t === 'posix time') {
    return 'unix-time';
  }
  return t;
}

function isAlpha (s) {
  return (s.search(/[^A-Za-z_]/) == -1 && s.length > 0);
}

function isUpper (s) {
  return (isAlpha(s) && s.search(/[^A-Z_]/) == -1);
}

function convertSingleArg(old) {
  const n = {};
  if ("command" in old) {
    n.token = old.command;
  }
  if (Array.isArray(old.name)) {
    n.name = old.name.join('_');
    n.type = 'block';
    n.value = old.name.map((e,i) => { 
      return {
        name: e,
        type: old.type[i],
        value: e,
      };
    });
  } else if (old.type != 'enum' && old.type != 'block') {
    if ('name' in old && old.name.indexOf(' ') == -1) {
      n.name = old.name;
      n.type = convertType(old.type);
      n.value = old.name;
    } else if (!('name' in old)) {
      n.name = old.command.toLowerCase();
      n.type = 'pure-token';
    } else if (old.name.indexOf(' ') != -1) {
      n.name = old.name.replace(' ','_');
      n.type = 'block';
      n.value = old.name.split(' ').map(e => { 
        return {
          name: e.toLowerCase(),
          "type": convertType(old.type),
          value: e,
        };
      });
    }
  } else if (old.type == 'enum') {
    if (old.enum.length == 1) {
      n.name = old.name;
      n.token = old.enum[0];
      n.type = 'pure-token';
    } else {
      if ('name' in old && isAlpha(old.name)) {
        n.name = old.name;
      } else {
        n.name = old.enum.join('_').toLowerCase();
        if (!isAlpha(n.name)) {
          n.name = getTbdStr();
        }  
      }
      n.type = 'oneof';
      n.value = old.enum.map(e => {
        const s = e.split(' ');
        if (s.length !== 1 && s.length !== 2) {
          console.error(`-ERR invalid enum type ${e}`);
        }
        if (s.length == 2 && isUpper(s[0]) && !isUpper(s[1])) {
          // SET ... [EX msec|...
          return {
            name: s[0].toLowerCase(),
            "type": s[1] === 'timestamp' ? 'unix-time' : 'integer',
            "value": s[1],
            token: s[0],
          };
        }
        if (e == 'ID') {
          return {
            name: 'id',
            "type": 'string',
            value: 'ID',
          };
        }
        if (isAlpha(e) && !isUpper(e)) {
          return {
            name: e.toLowerCase(),
            "type": 'pure-token',
            token: e,
        };
        }
        let name;
        if (isAlpha(e)) {
          name = e.toLowerCase();
        } else if (e === '""') {
          name = 'empty_string';
        } else if (e === '=') {
          name = 'equal';
        } else if (e === '~') {
          name = 'approximately';
        } else if (e === '*') {
          name = 'auto_id';
        } else if (e === '$') {
          name = 'new_id';
        } else if (e === '>') {
          name = 'next_id';
        }
        return {
          "name": name,
          "type": 'pure-token',
          token: e,
        };
      });
    }
  } else if (old.type == 'block') {
    n.name = old.name;
    n.type = 'block';
    n.value = old.block.map(x => convertSingleArg(x));
  } else {
    console.error(`-ERR invalid type ${old.type}`);
  }

  if (old["optional"]) {
    n.optional = true;
  }
  if (old["variadic"]) {
    n.multiple = true;
  }
  if (old["multiple"]) {
    n.multiple = true;
    if ('token' in n) {
      n.multiple_token = true;
    }
  }

  return n;
}

function commandFileName(name) {
  return name.toLowerCase().replace(' ', '-');
}

function splitMDReturnSummary(s) {
  s = s.trim();
  const r = [];
  let n = s.match(/@([a-z\-]+?)-reply/g);
  if (n) {
    n = n.length;
  }

  if (n == 1) {
    // E.g. @simple-string-reply
    let re = s.match(/^@([a-z\-]+?)-reply$/m);
    if (re) {
      r.push({
        type: re[1],
      });
      return r;
    }

    // E.g. @simple-string-reply: `OK`.
    re = s.match(/^@([a-z\-]+?)-reply: (.*)$/m);
    if (re) {
      r.push({
        description: re[2],
        type: re[1],
      });
      return r;
    }
  }
}

function linkifyMD(cmds,name,md) {
  return md.replace(/`.+?`/g, s => {
    const k = s.slice(1,s.length-1);
    const e = cmds.map(x => Object.keys(x)[0]).filter(x => x == k);
    if (k[0] == '!') {
      return `\`${k.slice(1)}\``;
    } else if (e.length == 1 && name != k) {
      return `[${s}](/commands/${commandFileName(k)})`;
    } else {
      return s;
    }
  });
}

function convertExamples(md) {
  md = md.replace(/@examples/g,'## Examples');
  return md.replace(/```cli[\s\w\W]+?```/gm, s => {
    const r = '{{% redis-cli %}}' + s.slice(6,s.length-3) + '{{% /redis-cli %}}';
    return r;
  });
}

async function loadCommandMarkdown(cmds,name) {
  const sections = {
    body: '<body>',
    history: '@history',
    examples: '@examples',
    reply: '@return',
  };

  const m = {
    'body': '',
    'history': [],
    'return_summary': '',
  };

  const fname = commandFileName(name);
  let buff;
  try {
    buff = await fs.readFile(`${docPath}/commands/${fname}.md`, 'utf-8');
  } catch (err) {
    console.error(`-ERR while reading ${fname}.md: ${err}`);
    return {};
  }
  let md = buff.toString();
  const lines = md.split('\n');
  let i = 0;
  let s = sections.body;
  while (i < lines.length) {
    const l = lines[i];
    i++;
    if (l.startsWith(sections.history)) {
      s = sections.history;
      continue;
    } else if (l.startsWith(sections.examples)) {
      s = sections.body;
    } else if (l.startsWith(sections.reply)) {
      s = sections.reply;
      continue;
    } else if (l.startsWith('#')) {
      s = sections.body;
    }

    if (s == sections.body) {
      m['body'] += l + '\n';
    } else if (s == sections.history) {
      if (l.trim().length == 0) {
        continue;
      }
      let re = l.match(/^\* `>= (.+)`: (.+)$/);
      if (re) {
        const desc = re[2].replace(/`!.+?`/g, s => '`' + s.slice(2));
        m['history'].push([re[1], desc]);
      }
    } else if (s == sections.reply) {
      m['return_summary'] += l + '\n';
    }
  }

  m['body'] = linkifyMD(cmds,name,m['body']);
  m['body'] = convertExamples(m['body'])

  if (m['history'].length == 0) {
    delete m['history'];
  }

  if (!m['deprecated']) {
    delete m['deprecated'];
  }

  m['return_summary'] = m['return_summary'].trim();
  if (m['return_summary'].length != 0) {
    m['return_types'] = splitMDReturnSummary(m['return_summary']);
  }
  if (m['return_types'] === undefined) {
    console.error(`-ERR no return types for ${name}: ${JSON.stringify(m['return_summary'],null,4)}`);
  } else {
    delete m['return_summary'];
  }

  return m;
}

async function loadCommandsJSON() {
  const data = await fs.readFile(`${docPath}/commands.json`, 'utf8');
  const json = JSON.parse(data);
  return json
}

function kargsRESPToObj(name, kargs) {
  function arrToObj(arr) {
    const o = {};
    for (let i = 0; i < arr.length; i += 2) {
      const k = arr[i], v = arr[i + 1];
      o[k] = v;
    }
    return o;
  }

  const obj = kargs.map(x => {
    const o = arrToObj(x);
    let s = o['begin_search'];
    switch (s[1]) {
      case 'index':
        o['begin_search'] = {
          index: {
            pos: s[3][1],
          },
        };
        break;
      case 'keyword':
        o['begin_search'] = {
          keyword: {
            keyword: s[3][1],
            startfrom: s[3][3],
          },
        };
        break;
      case 'unknown':
        o['begin_search'] = {
          unknown: null,
        };
        break;
      default:
        console.error(`-ERR in ${name} keyspec begin_search unknown ${JSON.stringify(s)}`);
    }
    s = o['find_keys'];
    switch (s[1]) {
      case 'keynum':
        o['find_keys'] = {
          keynum: {
            keynumidx: s[3][1],
            firstkey: s[3][3],
            step: s[3][5],
          },
        };
        break;
      case 'range':
        o['find_keys'] = {
          range: {
            lastkey: s[3][1],
            step: s[3][3],
            limit: s[3][5],
          },
        };
        break;
      case 'unknown':
        o['find_keys'] = {
          unknown: null,
        };
        break;
      default:
        console.error(`-ERR in ${name} keyspec find_keys unknown ${JSON.stringify(s)}`);
    }
    o['flags'] = undefinedIfZeroArray(o['flags']);
    return o;
  });
  return obj;
}

function extractFuncName(str) {
  const s = str.split(' ').filter(x => x !== '');
  assert(s.length == 6);
  return s[3];
}

function convertCommand(container, args) {
  const o = {};
  const name = args[0].toUpperCase();

  o[name] = {
    arity: args[1],
    command_flags: args[2],
    // first: args[3],
    // last: args[4],
    // step: args[5],
  };

  o[name]['command_flags'] = o[name]['command_flags'].filter(x => x !== 'movablekeys');

  if (args[6].length !== 0) {
    o[name].acl_categories = args[6].map(x => x.slice(1));
  }

  if (args[7].length !== 0) {
    o[name].key_specs = kargsRESPToObj(name, args[7]);
  }

  if (args[8].length !== 0) {
    o[name].subcommands = args[8].map(x => convertCommand(name, x));
  }

  if (args[9] !== null) {
    o[name].function = extractFuncName(args[9]);
  }

  if (args[10] !== null) {
    o[name].get_keys_function = extractFuncName(args[10]);
  }

  if (container) {
    o[name].container = container;
  }

  return o;
}

function getCommandName(cmd) {
  if (cmd !== undefined) {
    return Object.keys(cmd)[0];
  } else {
    console.trace('show me')
  }
}

function getCommandNameFromObj(cmd) {
  const name = getCommandName(cmd);
  if (cmd[name].container !== undefined) {
    return cmd[name].container + ' ' + name;
  } else {
    return name;
  }
}

function addFunctions(funcs, cmd) {
  const kname = getCommandName(cmd);
  const name = getCommandNameFromObj(cmd);

  // Guess the function
  if (cmd[kname]['function'] === undefined) {
    let fname = name.split(' ').join().toLowerCase() + 'command';
    let found = funcs.funcs.filter(x => x.toLowerCase() == fname);
    if (found.length != 0) {
      // Try to match the the entire subcommand
      cmd[kname]['function'] = found[0];
    } else {
      if (cmd[kname].container !== undefined) {
        fname = cmd[kname].container.toLowerCase() + 'command';
        found = funcs.funcs.filter(x => x.toLowerCase() == fname);
        if (found.length != 0) {
          // Try to match its container
          cmd[kname]['function'] = found[0];
        } else {
          console.error(`-ERR can't find a function for ${name} in server.h`);
        }
      }
    }
  }
  
  // Guess the getter
  if (cmd[kname]['get_keys_function'] === undefined) {
    if (cmd[kname]['key_specs'] !== undefined) {
      let fname = name.split(' ').join().toLowerCase() + 'getkeys';
      let found = funcs.getters.filter(x => x.toLowerCase() == fname);
      if (found.length != 0) {
        cmd[kname]['get_keys_function'] = found[0];
      } else {
        console.error(`-ERR can't find a keys getter for ${name} in server.h`);
      }
    }
  }

  if (cmd[kname].subcommands !== undefined) {
    cmd[kname].subcommands = cmd[kname].subcommands.map(x => addFunctions(funcs, x));
  }
  return cmd;
}

function enrichWithJSON(json, cmd) {
  const name = getCommandName(cmd);
  const fname = getCommandNameFromObj(cmd);

  if (json[fname] !== undefined) {
    cmd[name] = {
      ...json[fname],
      ...cmd[name],
    }
  } else console.error(`-ERR no commands.json entry for ${fname}`);

  if (cmd[name].arguments !== undefined) {
    cmd[name].arguments = cmd[name].arguments.map(a => convertSingleArg(a));
  }

  if (cmd[name].subcommands !== undefined) {
    cmd[name].subcommands = cmd[name].subcommands.map(x => enrichWithJSON(json, x));
  }
  return cmd;
}

async function enrichWithMD(cmds, cmd) {
  const name = getCommandNameFromObj(cmd);
  const kname = getCommandName(cmd);
  const md = await loadCommandMarkdown(cmds,name);

  cmd[kname] = {
    ...md,
    ...cmd[kname],
  };

  // TODO: sanitize MD fully

  if (cmd[kname].subcommands !== undefined) {
    await Promise.all(cmd[kname].subcommands.map(async (s) => enrichWithMD(cmds,s)));
  }

  return cmd;
}

function undefinedIfZeroArray(a) {
  if (Array.isArray(a) && a.length !== 0) {
    return a;
  } else {
    return undefined;
  }
}

async function persistCommand(cmd) {
  const kname = getCommandName(cmd);
  const name = getCommandNameFromObj(cmd);
  const fname = commandFileName(name);

  if (cmd[kname]['body'] !== undefined) {
    let md = cmd[kname]['body'];
    delete cmd[kname]['body'];
    await fs.writeFile(`${outputPathMD}/${fname}.md`,md,'utf-8');
  } else {
    console.error(`-ERR no markdown file for ${name}`);
  }

  if (cmd[kname].subcommands !== undefined) {
    await Promise.all(cmd[kname].subcommands.map(async (s) => persistCommand(s)));
    cmd[kname].subcommands = cmd[kname].subcommands.map(s => getCommandName(s)).sort();
  }

  const s = {
  };

  const flags = [...cmd[kname].command_flags];
  if (cmd[kname].internal) {
    flags.push('internal');
  }

  let complexity = cmd[kname].complexity;
  if (complexity === undefined) {
    if (cmd[kname].arity != -1 && cmd[kname].subcommands !== undefined) {
      complexity = 'Depends on subcommand.';
    } else if (kname === 'HELP') {
      complexity = 'O(1)';
    } else {
      complexity = getTbdStr();
    }
  }

  s[kname] = {
    summary: cmd[kname].summary || getTbdStr(),
    complexity: complexity,
    group: cmd[kname].group || getTbdStr(),
    since: cmd[kname].since || getTbdStr(),
    arity: cmd[kname].arity,
    container: cmd[kname].container,
    function: cmd[kname].function,
    get_keys_function: cmd[kname].get_keys_function,
    until: cmd[kname].until,
    replaced_by: cmd[kname].replaced_by,
    internal: cmd[kname].internal,
    undocumented: cmd[kname].undocumented,
    history: undefinedIfZeroArray(cmd[kname].history),
    command_flags: undefinedIfZeroArray(flags),
    acl_categories: undefinedIfZeroArray(cmd[kname].acl_categories),
    key_specs: undefinedIfZeroArray(cmd[kname].key_specs),
  };

  if (s[kname].group === undefined) console.error(`--ERR No group for ${name}`);

  if (!options.noreturn) {
    s[kname]['returns'] = undefinedIfZeroArray(cmd[kname].returns);
  }

  if (!options.noargs) {
    s[kname]['arguments'] = undefinedIfZeroArray(cmd[kname].arguments);
  }

  const json = JSON.stringify(s,null,4);
  await fs.writeFile(`${outputPathJSON}/${fname}.json`,json,'utf-8');
}

async function loadServerH() {
  const buff = await fs.readFile(`${srcPath}/src/server.h`,'utf-8');
  const lines = buff.split('\n');
  const funcs = lines.reduce((a,x) => {
    const re = x.match(/^void ([a-zA-Z]+Command)\(client \*c\);$/);
    if (re) {
      a.push(re[1]);
    }
    return a;
  },[]);

  const getters = lines.reduce((a,x) => {
    const re = x.match(/^int ([a-zA-Z]+GetKeys).*;$/);
    if (re) {
      a.push(re[1]);
    }
    return a;
  },[]);

  return {
    funcs: funcs,
    getters: getters,
  };
}

function backpropIfContainer(cmd) {
  const kname = getCommandName(cmd);
  if (cmd[kname].subcommands !== undefined) {
    const sname = getCommandName(cmd[kname].subcommands[0]);
    if (cmd[kname].group === undefined) {
      cmd[kname]['group'] = cmd[kname].subcommands[0][sname]['group'];
    }
    if (cmd[kname].since === undefined) {
      cmd[kname]['since'] = cmd[kname].subcommands.map(x => {
        const sname = getCommandName(x);
        return x[sname]['since'];
      }).sort()[0];
    }
  }
  return cmd;
}

function popagateIfSubcommand(cmd) {
  const kname = getCommandName(cmd);
  if (cmd[kname].subcommands !== undefined) {
    cmd[kname].subcommands = cmd[kname].subcommands.map(x => {
      const sname = getCommandName(x);
      if (x[sname].group === undefined) {
        x[sname].group = cmd[kname].group;
      }
      return x;
    });
  }
  return cmd;
}

async function meldJSONFiles() {
  await new Promise(resolve => setTimeout(resolve, 100));
  const files = await fs.readdir(outputPathJSON);
  const payload = {};
  await Promise.all(files.map(async (x) => {
    const path = `${outputPathJSON}/${x}`;
    const buff = await fs.readFile(path);
    const json = JSON.parse(buff);
    const k = Object.keys(json)[0];
    const n = getCommandNameFromObj(json);
    payload[n] = json[k];
  }));
  await fs.writeFile('commands.json',JSON.stringify(payload,null,4),'utf-8');

  const tbds = Object.entries(payload).reduce((a,[ck,cv]) => {
    const ov = Object.entries(cv)
      .filter(([_,vv]) => typeof(vv) === 'string' && vv.startsWith('__TBD__')) 
      .reduce((ac,[tk,tv]) => {
        ac[tk] = `PATCH${tv}`;
        return ac;
      },{});

      // if (cv.returns === undefined) {
      //   ov.returns = [
      //     {
      //       "description": `PATCH${getTbdStr()}`,
      //       "type": {
      //         "RESP2":"null-bulk-string",
      //         "RESP3":"null"
      //       }
      //     }
      //   ];  
      // }

      if (Object.entries(ov).length != 0) {
        a[ck] = ov;
      }
    return a;
  },{});
  await Promise.all(Object.entries(tbds).map(async ([k,v]) => {
    const path = `./tbds/${commandFileName(k)}.json`;
    const p = {};
    p[k] = {
      ...v,
    };
    return await fs.writeFile(path,JSON.stringify(p,null,4),'utf-8');
  }));
}

function prePatch(cmds) {
  const p = {
    "BRPOPLPUSH": {
      "until": "6.2.0",
      "replaced_by": "`BLMOVE` with the `RIGHT` and `LEFT` arguments",
    },
    "GEORADIUS": {
      "until": "6.2.0",
      "replaced_by": "`GEOSEARCH` and `GEOSEARCHSTORE` with the `BYRADIUS` argument",
    },
    "GEORADIUS_RO": {
      "group": "geo",
      "until": "6.2.0",
      "replaced_by": "`GEOSEARCH` with the `BYRADIUS` argument",
    },
    "GEORADIUSBYMEMBER": {
      "until": "6.2.0",
      "replaced_by": "`GEOSEARCH` and `GEOSEARCHSTORE` with the `BYRADIUS` and `FROMMEMBER` arguments",
    },
    "GEORADIUSBYMEMBER_RO": {
      "group": "geo",
      "until": "6.2.0",
      "replaced_by": "`GEOSEARCH` with the `BYRADIUS` and `FROMMEMBER` arguments",
    },
    "GETSET": {
      "until": "6.2.0",
      "replaced_by": "`SET` with the `!GET` argument",
    },
    "HMSET": {
      "until": "4.0.0",
      "replaced_by": "`HSET` with multiple field-value pairs",
    },
    "RPOPLPUSH": {
      "until": "6.2.0",
      "replaced_by": "`LMOVE` with the `RIGHT` and `LEFT` arguments",
    },
    "ZRANGEBYSCORE": {
      "until": "6.2.0",
      "replaced_by": "`ZRANGE` with the `BYSCORE` argument",
    },
    "ZRANGEBYLEX": {
      "until": "6.2.0",
      "replaced_by": "`ZRANGE` with the `BYSCORE` argument",
    },
    "ZREVRANGE": {
      "until": "6.2.0",
      "replaced_by": "`ZRANGE` with the `REV` argument",
    },
    "ZREVRANGEBYLEX": {
      "until": "6.2.0",
      "replaced_by": "`ZRANGE` with the `REV` and `BYLEX` arguments",
    },
    "ZREVRANGEBYSCORE": {
      "until": "6.2.0",
      "replaced_by": "`ZRANGE` with the `REV` and `BYSCORE` arguments",
    },
    "SUBSTR": {
      "group": "string",
      "undocumented": true,
      "until": "2.0.0",
      "replaced_by": "`GETRANGE`",
    },
    "PFSELFTEST": {
      "group": "hyperloglog",
      "internal": true,
      "undocumented": true,
    },
    "PFDEBUG": {
      "group": "hyperloglog",
      "internal": true,
      "undocumented": true,
    },
    "HOST:": {
      "group": "server",
      "internal": true,
      "undocumented": true,
    },
    "REPLCONF": {
      "group": "server",
      "internal": true,
      "undocumented": true,
    },
    "DEBUG": {
      "group": "server",
      "internal": true,
    },
    "RESTORE-ASKING": {
      "group": "server",
      "internal": true,
      "undocumented": true,
    },
    "XSETID": {
      "group": "stream",
      "internal": true,
      "undocumented": true,
    },
    "POST": {
      "group": "server",
      "internal": true,
      "undocumented": true,
    },
    "CLUSTER": {
      "group": "cluster",
    },
    "MODULE": {
      "group": "server",
    },
  };
  cmds = cmds.map(x => {
    const kname = getCommandName(x);
    if (kname in p) {
      x[kname] = {
        ...x[kname],
        ...p[kname],
      }
    };
    return x;
  });
  return cmds;
}

function postPatchCommand(cmd) {
  const kname = getCommandName(cmd);
  const name = getCommandNameFromObj(cmd);
  const path = `./patch/${commandFileName(name)}.json`;
  if (existsSync(path)) {
    const buff = readFileSync(path);
    const patch = JSON.parse(buff);
    Object.entries(patch[name]).forEach(([k,v]) => cmd[kname][k] = v);
  }
  if (cmd[kname].subcommands !== undefined) {
    cmd[kname].subcommands = cmd[kname].subcommands.map((x) => postPatchCommand(x));
  }
  return cmd;
}

function postPatch(cmds) {
  cmds = cmds.map((x) => postPatchCommand(x));
  return cmds;
}

async function main() {
  const client = createClient();
  client.on('error', (err) => console.error('-ERR Redis client error', err));
  await client.connect();

  const commandOutput = await client.sendCommand(['COMMAND']);
  console.log('Loading `COMMAND` reply');
  let commands = await commandOutput.map(x => convertCommand(null, x));

  // console.log('Loading server.h');
  // const functions = await loadServerH();
  // await fs.writeFile('functions.json',JSON.stringify(functions,null,4),'utf-8');
  // functions.funcs.push('slowlogCommand'); // Not in .h file

  console.log('Loading commands.json');
  const commandsJSON = await loadCommandsJSON();

  console.log('Applying pre patch');
  commands = prePatch(commands);

  // console.log('Adding functions');
  // commands = commands.map(x => addFunctions(functions,x));

  console.log('Enrichening with JSONs');
  commands = commands.map(x => enrichWithJSON(commandsJSON, x))

  console.log('Backpropagating container properties');
  commands = commands.map(x => backpropIfContainer(x));

  console.log('Propagating container properties');
  commands = commands.map(x => popagateIfSubcommand(x));

  console.log('Enrichening with MarkDown');
  commands = await Promise.all(commands.map(async (x) => enrichWithMD(commands,x)));

  console.log('Applying post patch');
  commands = postPatch(commands);

  console.log('Persisting files');
  await Promise.all(Object.values(commands).map(async (cmd) => {
    persistCommand(cmd);
  }));

  await client.disconnect();
  return;
}

await main();

console.log('Melding JSONs');
await meldJSONFiles();