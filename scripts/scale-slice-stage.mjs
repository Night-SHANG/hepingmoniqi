import {copyFile,cp} from 'node:fs/promises';
await copyFile('dist-scale-slice/scale-slice.html','dist-scale-slice/index.html');
for(const name of ['serve.py','START-WINDOWS.bat','PLAY-README.txt'])await copyFile(`scale-launcher/${name}`,`dist-scale-slice/${name}`);
await cp('licenses','dist-scale-slice/licenses',{recursive:true});
