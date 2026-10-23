import {copyFile,cp} from 'node:fs/promises';
for (const name of ['serve.py','START-WINDOWS.bat','PLAY-README.txt']) await copyFile(name,`dist/${name}`);

await cp('licenses','dist/licenses',{recursive:true});
