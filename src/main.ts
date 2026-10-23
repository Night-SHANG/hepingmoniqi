import './style.css';
import {createExperimentFlow} from './experiment-flow';
import {toolAvailable,nextGoal} from './gameplay';
import { createAudio } from './audio';
import { createWorld } from './domain';
import { createScene } from './scene';
import { createProjectilePhysics } from './physics';
import type { SceneApi, Vec3, WeaponId, WorldSnapshot, ProjectilePhysics, Detonation, MapId, ProjectileCommand, TrajectoryPreview, TriggerMode } from './contracts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="game"><div id="scene" aria-label="可旋转的三维小屋试验场"></div>
<header class="top"><div class="brand"><span class="cube">◈</span><div><h1>核平模拟器</h1><p>从小屋到宇宙 <span>DESTRUCTION SANDBOX</span></p></div></div><div class="stats"><div class="stat destruction"><span>◉ 建筑拆除</span><strong id="damage">0<small>%</small></strong><i><b id="damage-bar"></b></i></div><div class="stat"><span>◇ 研究进度</span><strong id="research">0</strong><i><b id="research-bar"></b></i></div></div></header>
<section class="location"><b>E0</b><div><h2 id="map-title">小屋试验场 <span>/ 木屋庭院</span></h2><p><span class="green-dot"></span><span id="mode-label">主模式</span> · 无人实验场</p></div></section>
<section class="mission"><div><b>本轮实验</b><strong id="objective-progress">建筑拆除 0%</strong></div><p id="next-goal"></p><nav><button id="map-courtyard">木屋庭院</button><button id="map-warehouse" disabled>仓库 · 研究120解锁</button></nav><div class="round-line"><span id="ammo">弹药 6 / 6</span><button id="finish-round">结束本轮</button></div></section>
<div class="intro" id="intro"><span>实验 001</span><h3>从手榴弹开始</h3><p>每轮6枚，尽量拆得更多。<br>少量破坏也获研究；用更强工具回来重试。</p><button id="dismiss-intro">知道了 <span>↗</span></button></div>
<aside class="tools"><button id="pause" title="暂停模拟">Ⅱ <span>暂停</span></button><button id="slow" title="慢动作">◷ <span>0.25×</span></button><button id="camera" title="重置镜头">⌾ <span>镜头</span></button><button id="reset" title="重建小屋，保留研究进度">↻ <span>重建</span></button><button id="settings" title="设置">⚙ <span>设置</span></button></aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="aim-hint" id="aim-hint"><span>＋</span> 点选庭院物件，设置瞄准点</div>
<div class="experiment-controls"><label>投放<select id="delivery"><option value="quick">快捷逐发</option><option value="preview">轨迹确认</option><option value="place">直接放置</option></select></label><label>引爆<select id="trigger"><option value="automatic">自动引爆</option><option value="remote">统一遥控</option></select></label><button id="cancel-preview" hidden>取消轨迹</button></div><footer class="console"><div class="weapon-group"><button data-weapon="charge" class="weapon selected"><span class="key">1</span><span class="weapon-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12 5h8v5H12zM21 5h4v13h-3V9h-1z" fill="currentColor"/><path d="M9 11h14l3 8-4 10H10L6 19z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 17h16M9 23h14M13 11v17M19 11v17" stroke="currentColor" stroke-width="1.5"/></svg></span><span><b>手榴弹</b><small>抛投 / 放置</small></span></button><button data-weapon="pulse" class="weapon"><span class="key">2</span><span class="weapon-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m26 3 3 10-7-3z" fill="currentColor"/><path d="m21 9 4 4-13 13-5-5zM10 17l-6 2 2 5M17 24l-2 6-5-2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m6 26-3 3m7-3-4 4" stroke="currentColor" stroke-width="2"/></svg></span><span><b>火箭弹</b><small id="pulse-label">研究40解锁</small></span></button><button data-weapon="shock" class="weapon"><span class="key">3</span><span class="weapon-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="8" width="26" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8v18M23 8v18" stroke="currentColor" stroke-width="3"/><rect x="13" y="12" width="6" height="6" fill="currentColor"/><path d="M16 8V3h7" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span><b>遥控爆破包</b><small id="shock-label">研究90解锁</small></span></button></div><label class="power"><span>威力 <strong id="power-value">100%</strong></span><input id="power" aria-label="武器威力" type="range" min="25" max="100" value="100"/><small>精细实验 <span>全力释放</span></small></label><div class="action-buttons"><button id="fire" disabled>投 掷 <small>SPACE</small></button><button id="detonate" disabled>引爆已放置 · 0</button></div></footer>
<div class="bottom-line"><span>拖动旋转 · 滚轮缩放 · 点击瞄准 · 空格发射</span><span id="save-status">本机自动保存</span></div>
<dialog id="completion-dialog"><span class="eyebrow">ROUND SUMMARY</span><h2 id="completion-title">本轮实验结束</h2><p id="round-summary"></p><div class="completion-actions"><button id="next-map">前往双跨仓库</button><button id="retry-map">重试本图</button><button id="continue-free">继续自由破坏</button><button id="observe-scene">查看现场</button></div></dialog>
<dialog id="settings-dialog"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">EXPERIMENT SETTINGS</span><h2>实验设置</h2><label class="setting-row">自由沙盒 <input id="sandbox" type="checkbox"/></label><p>任选建筑，无限弹药；武器需在主模式解锁，不增加研究。</p><label class="setting-row">静音 <input id="mute" type="checkbox"/></label><p>爆炸与木块音效使用已核验的 CC0 素材。</p><label class="setting-row">减少动态效果 <input id="reduce-motion" type="checkbox"/></label><p>以慢动作观察破坏，降低动态变化速度。</p><button class="done">返回实验</button></form></dialog>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = createAudio();
const world = createWorld();
const saveKey = 'hepingmoniqi.first-playable.v1';
let target: Vec3 | null = null;
let weapon: WeaponId = 'charge';
let power = 100, paused = false, slow = false, sandbox = false;
let delivery:'quick'|'preview'|'place'='quick', trigger:TriggerMode='automatic';
let growSnapshot:WorldSnapshot|null=null, planned:ProjectileCommand|null=null, preview:TrajectoryPreview|null=null;
let timer:ReturnType<typeof setTimeout>,shot=0,previousResearch=0,physics:ProjectilePhysics|null=null;
const flow=createExperimentFlow(),detonations:Detonation[]=[];
function toast(text:string){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('visible'),3400);}
try{const raw=localStorage.getItem(saveKey);if(raw){const prior=JSON.parse(raw);if(!world.restore(prior))toast('存档不兼容，已保留原数据并开启新实验。');else if(prior.schemaVersion!==4)toast('旧研究已保留，现在每轮有独立弹药配额。');}}catch{toast('存档暂不可用，本轮仍可继续。');}
previousResearch=world.getSnapshot().research;
let scene:SceneApi;
try{scene=createScene($('scene'),{onAim(point){target=point;clearPreview();scene.setTarget(point);render();$('aim-hint').textContent=delivery==='place'?'点击放置，把当前工具布置在选定表面。':'瞄准已就绪，可以发射或查看轨迹。';$('intro').classList.add('hidden');},onFrame(dt){if(!physics)return;for(const e of physics.step(dt))detonate(e);scene.setProjectiles(physics.getProjectiles());checkSettlement();}});scene.setVoxels(world.getVoxels());}
catch(error){app.innerHTML='<div class="startup-error"><h1>暂时无法开启三维实验场</h1><p>请使用支持WebGL2的浏览器。已保存研究未被清除。</p><button onclick="location.reload()">重新尝试</button></div>';throw error;}
void createProjectilePhysics().then(engine=>{physics=engine;physics.syncVoxels(world.getVoxels(),world.epoch);render();}).catch(error=>{console.error(error);toast('物理系统加载失败，请刷新重试。');});
function clearPreview(){planned=null;preview=null;scene?.setTrajectory(null);}
function syncWorld(){scene.setVoxels(world.getVoxels());physics?.syncVoxels(world.getVoxels(),world.epoch);scene.setProjectiles(physics?.getProjectiles()??[]);}
function save(){if(sandbox)return;try{localStorage.setItem(saveKey,JSON.stringify(world.getSnapshot()));$('save-status').textContent='已保存到此浏览器';}catch{$('save-status').textContent='浏览器存储不可用';}}
function mainResearch(){return sandbox&&growSnapshot?growSnapshot.research:world.getSnapshot().research;}
function unlocked(id:WeaponId){return toolAvailable(id,mainResearch(),false);}
function availableAmmo(){const r=world.getRound();return sandbox||(!r.settled&&r.used<r.budget);}
function render(){
 const o=world.getObjective(),r=world.getRound(),research=mainResearch(),pct=Math.round(o.fraction*100),armed=physics?.getProjectiles().filter(p=>p.state==='attached'||p.trigger==='remote').length??0;
 $('damage').innerHTML=`${pct}<small>%</small>`;$('damage-bar').style.width=`${pct}%`;$('research').textContent=String(research);$('research-bar').style.width=`${Math.min(100,research/120*100)}%`;
 $('objective-progress').textContent=`建筑拆除 ${pct}%`;$('next-goal').textContent=sandbox?'自由模式 · 无限弹药，武器随主模式解锁':nextGoal(research,false,o.mapId);
 $('ammo').textContent=sandbox?'弹药 ∞':`弹药 ${Math.max(0,r.budget-r.used)} / ${r.budget}`;
 $('finish-round').hidden=sandbox;$('finish-round').textContent=flow.state==='ending'?'等待爆炸结束…':r.settled?'查看本轮结果':armed?'引爆并结束':'结束本轮';
 ($('finish-round') as HTMLButtonElement).disabled=flow.state==='ending';
 $('map-title').textContent=o.mapId==='courtyard'?'小屋试验场 / 木屋庭院':'双跨仓库 / 拆除实验';
 $('map-courtyard').classList.toggle('active',o.mapId==='courtyard');$('map-warehouse').classList.toggle('active',o.mapId==='warehouse');
 const open=sandbox||research>=120;($('map-warehouse') as HTMLButtonElement).disabled=!open||flow.state==='ending';($('map-courtyard') as HTMLButtonElement).disabled=flow.state==='ending';$('map-warehouse').textContent=open?'双跨仓库':'仓库 · 研究120';
 $('pulse-label').textContent=unlocked('pulse')?'碰撞 / 遥控':'研究40解锁';$('shock-label').textContent=unlocked('shock')?'放置 / 发射':'研究90解锁';
 document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>{b.classList.toggle('locked',!unlocked(b.dataset.weapon as WeaponId));b.classList.toggle('selected',b.dataset.weapon===weapon);});
 $('detonate').textContent=`统一引爆 · ${armed}`;($('detonate') as HTMLButtonElement).disabled=!armed||paused||flow.state==='ending';$('detonate').classList.toggle('shown',armed>0||delivery==='place'||trigger==='remote');
 $('fire').innerHTML=delivery==='place'?'放 置 <small>SPACE</small>':delivery==='preview'?(planned?'确认发射':'预览轨迹'):'发 射 <small>SPACE</small>';
 ($('fire') as HTMLButtonElement).disabled=!physics||!target||!flow.canAct()||!availableAmmo()||!unlocked(weapon)||(delivery==='place'&&!scene?.getAimSurface());
 ($('trigger') as HTMLSelectElement).disabled=delivery==='place';($('trigger') as HTMLSelectElement).value=delivery==='place'?'remote':trigger;$('cancel-preview').hidden=!planned;
}
function select(id:WeaponId){if(!unlocked(id)){toast('请在主模式积累研究，解锁后自由模式也可使用。');return;}weapon=id;clearPreview();audio.play('ui-click',.7);render();}
function launchCommand():ProjectileCommand{return {id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,origin:scene.getLaunchOrigin(target!),target:{...target!},weapon,power:power/100,trigger};}
function fire(){
 if(!target||!physics||!flow.canAct()||!availableAmmo()||!unlocked(weapon)||$('settings-dialog').hasAttribute('open')||$('completion-dialog').hasAttribute('open'))return;
 if(paused){toast('继续模拟后即可操作。');return;}
 let accepted=false;
 if(delivery==='place'){const surface=scene.getAimSurface();if(!surface)return;accepted=physics.attach({id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,surface,power:power/100,weapon});}
 else if(delivery==='preview'&&!planned){planned=launchCommand();preview=physics.preview(planned);scene.setTrajectory(preview);$('aim-hint').textContent='轨迹已预览，确认后才消耗弹药；重新瞄准可调整。';render();return;}
 else{const command=planned??launchCommand();accepted=physics.launch(command);clearPreview();}
 if(!accepted){toast('当前投放位置已变化，请重新选择。');render();return;}
 if(!sandbox)world.recordShot();scene.setProjectiles(physics.getProjectiles());save();render();
 $('aim-hint').textContent=delivery==='place'||trigger==='remote'?'已布置遥控弹，可继续安排，最后统一引爆。':weapon==='charge'?'手榴弹飞行中，3秒后在实际位置爆炸。':'弹体飞行中，碰撞后引爆。';
}
function detonate(event:Detonation){
 if(event.epoch!==world.epoch)return;
 const result=world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power,reward:!sandbox});if(!result.accepted)return;
 detonations.push({...event,position:{...event.position}});if(detonations.length>256)detonations.shift();clearPreview();syncWorld();scene.playDamage(result,event.position,event.weapon);audio.play('blast',event.weapon==='shock'?1:.8);
 if(result.newlyDestroyed){const epoch=world.epoch;setTimeout(()=>{if(world.epoch===epoch)audio.play('wood-impact',.75);},120);}
 if(!sandbox){const research=world.getSnapshot().research;if(previousResearch<90&&research>=90)toast('遥控爆破包已解锁');else if(previousResearch<40&&research>=40)toast('火箭弹已解锁');previousResearch=research;save();}render();
}
function detonateAll(){if(!physics)return;for(const e of physics.detonateAttached())detonate(e);scene.setProjectiles(physics.getProjectiles());render();}
function showSummary(){const result=world.finishRound();flow.settled();save();$('completion-title').textContent='本轮实验结束';$('round-summary').textContent=`建筑拆除 ${Math.round(result.destruction*100)}% · 使用 ${result.used}/${result.budget} 枚 · 获得 ${result.researchEarned} 研究。带着新工具回来，再试一次。`;$('next-map').hidden=mainResearch()<120||world.getObjective().mapId==='warehouse';($('completion-dialog') as HTMLDialogElement).showModal();render();}
function checkSettlement(){if(!sandbox&&physics&&flow.shouldSettle(physics.getProjectiles().length,scene.hasActiveEffects()))showSummary();}
$('finish-round').onclick=()=>{if(sandbox)return;if(world.getRound().settled){showSummary();return;}flow.requestFinish();clearPreview();paused=false;slow=false;updateTime();detonateAll();render();checkSettlement();};
$('fire').onclick=fire;$('detonate').onclick=()=>{if(!paused&&flow.canAct())detonateAll();};
$('delivery').addEventListener('change',e=>{delivery=(e.target as HTMLSelectElement).value as typeof delivery;clearPreview();render();});
$('trigger').addEventListener('change',e=>{trigger=(e.target as HTMLSelectElement).value as TriggerMode;clearPreview();render();});
$('cancel-preview').onclick=()=>{clearPreview();render();};
document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>b.onclick=()=>select(b.dataset.weapon as WeaponId));
$('power').addEventListener('input',e=>{power=Number((e.target as HTMLInputElement).value);$('power-value').textContent=`${power}%`;clearPreview();render();});
function updateTime(){scene.setTimeScale(paused?0:slow?.25:1);$('pause').classList.toggle('active',paused);$('slow').classList.toggle('active',slow);$('pause').innerHTML=paused?'▶ <span>继续</span>':'Ⅱ <span>暂停</span>';render();}
$('pause').onclick=()=>{if(flow.state==='ending')return;paused=!paused;updateTime();};$('slow').onclick=()=>{if(flow.state==='ending')return;slow=!slow;updateTime();};$('camera').onclick=()=>{scene.resetCamera();clearPreview();render();};
function clearTransient(){flow.reset();scene.clearEffects();clearPreview();target=null;paused=false;detonations.length=0;scene.setTarget(null);syncWorld();updateTime();}
$('reset').onclick=()=>{($('completion-dialog') as HTMLDialogElement).close();world.reset();clearTransient();save();toast(sandbox?'自由场景已重建。':'新一轮已准备，弹药补满，研究保留。');};
$('dismiss-intro').onclick=()=>$('intro').classList.add('hidden');$('settings').onclick=()=>{if(flow.state!=='ending')($('settings-dialog') as HTMLDialogElement).showModal();};
function changeSandbox(enabled:boolean){if(enabled===sandbox)return;if(enabled){growSnapshot=world.getSnapshot();sandbox=true;world.reset();}else{sandbox=false;if(growSnapshot)world.restore(growSnapshot);growSnapshot=null;}weapon='charge';clearTransient();$('mode-label').textContent=sandbox?'自由模式 · 不计研究':'主模式';($('sandbox') as HTMLInputElement).checked=sandbox;render();}
$('sandbox').addEventListener('change',e=>changeSandbox((e.target as HTMLInputElement).checked));
$('mute').addEventListener('change',e=>audio.setMuted((e.target as HTMLInputElement).checked));$('reduce-motion').addEventListener('change',e=>{slow=(e.target as HTMLInputElement).checked;updateTime();});
window.addEventListener('keydown',e=>{if((e.target as HTMLElement)?.matches('input,textarea,select')||$('settings-dialog').hasAttribute('open')||$('completion-dialog').hasAttribute('open'))return;if(e.code==='Space'){e.preventDefault();fire();}if(e.code==='Digit1')select('charge');if(e.code==='Digit2')select('pulse');if(e.code==='Digit3')select('shock');});
function enterMap(id:MapId){if(flow.state==='ending')return;if(!world.loadMap(id,sandbox)){toast('主模式累计120研究后解锁仓库。');return;}clearTransient();save();}
$('map-courtyard').onclick=()=>enterMap('courtyard');$('map-warehouse').onclick=()=>enterMap('warehouse');
function closeCompletion(){($('completion-dialog') as HTMLDialogElement).close();}
$('completion-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCompletion();});$('next-map').onclick=()=>{closeCompletion();enterMap('warehouse');};$('retry-map').onclick=()=>{closeCompletion();$('reset').click();};$('continue-free').onclick=()=>{closeCompletion();changeSandbox(true);};$('observe-scene').onclick=closeCompletion;
document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});render();
// Read-only diagnostics for real-input acceptance, never a gameplay mutation API.
Object.assign(window,{__heping:{snapshot:()=>world.getSnapshot(),objective:()=>world.getObjective(),round:()=>world.getRound(),projectiles:()=>physics?.getProjectiles()??[],lastDetonations:()=>detonations.map(e=>({...e,position:{...e.position}})),preview:()=>preview?structuredClone(preview):null,get flow(){return flow.state;},get activeEffects(){return scene.hasActiveEffects();},get renderedProjectiles(){return scene.getRenderedProjectileCount();},get sandbox(){return sandbox;},get physicsReady(){return physics!==null;},get target(){return target;},get weapon(){return weapon;}}});
