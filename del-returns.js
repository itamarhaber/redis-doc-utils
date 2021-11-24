// clear returns from patches
import { readFileSync, writeFileSync, readdir } from 'fs';

const path = './patch';
readdir(path,(err, files) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(files)
    files.forEach(file => {
        const filename = `${path}/${file}`;
        const buff = readFileSync(filename);
        const obj = JSON.parse(buff);
        delete obj[Object.keys(obj)[0]].returns;
        writeFileSync(filename,JSON.stringify(obj,null,2));
    });
});