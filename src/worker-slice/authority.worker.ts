import {configureCompactSupportAssetLoader} from '../compact/support/index.js';
import {loadCompactSupportAsset} from '../compact/support/assets.js';
import {createAuthorityRuntime} from './authority-runtime.js';
import type {AuthorityCommand,AuthorityMessage} from './protocol.js';
/** Pure authority harness. The visual slice's worker entry composes its CPU mesh hook here, not on main. */
const scope=globalThis as unknown as {postMessage:(message:AuthorityMessage,transfer?:Transferable[])=>void;onmessage:((event:MessageEvent<AuthorityCommand>)=>void)|null;addEventListener:(type:string,callback:()=>void)=>void};
configureCompactSupportAssetLoader(loadCompactSupportAsset);
const runtime=createAuthorityRuntime({now:()=>performance.timeOrigin+performance.now(),emit:(message,transfer)=>scope.postMessage(message,transfer)});
const timer=setInterval(()=>runtime.pump(),8);
scope.onmessage=event=>{void runtime.handle(event.data).then(ack=>{if(event.data.kind==='dispose'&&ack.status==='accepted')clearInterval(timer);});};
scope.addEventListener('close',()=>{clearInterval(timer);runtime.dispose();});
