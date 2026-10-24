// Build-only evidence. This does not launch or execute any browser.
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
const builtins=new Set(builtinModules.flatMap(name=>[name,`node:${name}`]));
export default {
 plugins:[{name:'reject-node-in-browser-graph',enforce:'pre' as const,resolveId(id:string){if(id.startsWith('node:')||builtins.has(id))throw new Error(`Forbidden Node builtin in browser graph: ${id}`);return null;}}],
 build:{outDir:fileURLToPath(new URL('./dist',import.meta.url)),emptyOutDir:true,target:'es2022',lib:{entry:fileURLToPath(new URL('./entry.ts',import.meta.url)),formats:['es' as const],fileName:()=> 'pristine-support.js'},minify:false},
};
