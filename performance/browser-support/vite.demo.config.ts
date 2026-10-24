import {fileURLToPath} from 'node:url';
import library from './vite.config.ts';
export default {root:fileURLToPath(new URL('.',import.meta.url)),base:'./',plugins:library.plugins,build:{outDir:'dist-demo',emptyOutDir:true,target:'es2022',minify:false,assetsInlineLimit:0}};
