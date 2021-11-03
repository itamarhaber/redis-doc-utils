// Make a commands.json from COMMAND's output
// Assumes max subcommand depth of 1
// * SORT has unknown key_specs
// * function is wrong in some cases (e.g. SETNX b/c it doesn't exist, zunionInterDiffGetKeys, COUNT GETKEYS b/c of capitalization, the HOST: command...). Maybe parse server.c?
// * Some commmands don't have a commands.json entry (e.g. PFSELFTEST, HOST:, CONFIG/XGROUP...)
// * Command arguments need translation to new format
// * Need to convert md `SET` to [`SET`](/commands/set) in MD
// * Need to extract return types

import { createClient } from 'redis';
import { promises as fs } from 'fs';

const docPath = process.env.REDIS_DOC || '../redis-doc';
const srcPath = process.env.REDIS_SRC || '../redis';
const outputPathJSON = './json';
const outputPathMD = './md';

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

async function loadCommandMarkdown(name) {
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
    'depracated': false,
  };

  const fname = commandFileName(name);
  let buff;
  try {
    buff = await fs.readFile(`${docPath}/commands/${fname}.md`, 'utf-8');
  } catch (err) {
    console.error(`-ERR while reading ${fname}.md: ${err}`);
    return {};
  }
  const md = buff.toString();
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
      m[''] = '';
      s = sections.reply;
      continue;
    } else if (l.startsWith('#')) {
      s = sections.body;
    }

    if (s == sections.body) {
      m['body'] += l + '\n';
      m.depracated = m.depracated || (l.indexOf('deprecated') != -1); // TODO: false positives info, role...
    } else if (s == sections.history) {
      if (l.trim().length == 0) {
        continue;
      }
      let re = l.match(/^\* `>= (.+)`: (.+)$/);
      if (re) {
        m['history'].push([re[1], re[2]]);
      }
    } else if (s == sections.reply) {
      m['return_summary'] += l + '\n';
    }
  }

  if (m['history'].length == 0) {
    delete m['history'];
  }

  if (!m['depracated']) {
    delete m['depracated'];
  }

  m['return_summary'] = m['return_summary'].trim();
  if (m['return_summary'].length != 0) {
    m['return_types'] = splitMDReturnSummary(m['return_summary']);
  }
  if (m['return_types'] === undefined) {
    console.error(`-ERR no return types for ${name}: ${JSON.stringify(m['return_summary'],null,2)}`);
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
    return o;
  });
  return obj;
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

  if (args[6].length !== 0) {
    o[name].acl_categories = args[6].map(x => x.slice(1));
  }

  if (args[7].length !== 0) {
    o[name].key_specs = kargsRESPToObj(name, args[7]);
  }

  if (args[8].length !== 0) {
    o[name].subcommands = args[8].map(x => convertCommand(name, x));
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
  let fname = name.split(' ').join().toLowerCase() + 'command';
  let found = funcs.funcs.filter(x => x.toLowerCase() == fname);
  if (found.length != 0) {
    cmd[kname]['function'] = found[0];
  } else {
    console.error(`-ERR can't find a function for ${name} in server.h`);
  }
  
  fname = name.split(' ').join().toLowerCase() + 'getkeys';
  found = funcs.getters.filter(x => x.toLowerCase() == fname);
  if (found.length != 0) {
    cmd[kname]['get_keys_function'] = found[0];
  } else {
    console.error(`-ERR can't find a keys getter for ${name} in server.h`);
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

  if (cmd[name].subcommands !== undefined) {
    cmd[name].subcommands = cmd[name].subcommands.map(x => enrichWithJSON(json, x));
  }
  return cmd;
}

async function enrichWithMD(cmd) {
  const name = getCommandNameFromObj(cmd);
  const kname = getCommandName(cmd);
  const md = await loadCommandMarkdown(name);

  cmd[kname] = {
    ...md,
    ...cmd[kname],
  };

  if (cmd[kname].subcommands !== undefined) {
    await Promise.all(cmd[kname].subcommands.map(async (s) => enrichWithMD(s)));
  }

  return cmd;
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

  s[kname] = {
    summary: cmd[kname].summary,
    complexity: cmd[kname].complexity,
    group: cmd[kname].group,
    since: cmd[kname].since,
    arity: cmd[kname].arity,
    depracated: cmd[kname].depracated,
    container: cmd[kname].container,
    function: cmd[kname].function,
    get_keys_function: cmd[kname].get_keys_function,
    history: cmd[kname].history,
    command_flags: cmd[kname].command_flags,
    acl_categories: cmd[kname].acl_categories,
    subcommands: cmd[kname].subcommands,
    key_specs: cmd[kname].key_specs,
    return_types: cmd[kname].return_types,
    arguments: cmd[kname].arguments,
  }

  const json = JSON.stringify(s,null,2);
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

async function main() {
  const client = createClient();
  client.on('error', (err) => console.error('-ERR Redis client error', err));
  await client.connect();

  const commandOutput = await client.sendCommand(['COMMAND']);
  console.log('Loading `COMMAND` reply');
  let commands = await commandOutput.map(x => convertCommand(null, x));

  console.log('Loading server.h');
  const functions = await loadServerH();

  console.log('Loading commands.json');
  const commandsJSON = await loadCommandsJSON();

  console.log('Adding functions');
  commands = commands.map(x => addFunctions(functions,x));

  console.log('Enrichening with JSONs');
  commands = commands.map(x => enrichWithJSON(commandsJSON, x))

  console.log('Enrichening with MarkDown');
  commands = await Promise.all(commands.map(async (x) => enrichWithMD(x)));

  await fs.writeFile(`commands.json`, JSON.stringify(commands, null, 2));

  console.log('Persisting files');
  await Promise.all(Object.values(commands).map(async (cmd) => {
    persistCommand(cmd);
  }));

  await client.disconnect();
  return;
}

await main();