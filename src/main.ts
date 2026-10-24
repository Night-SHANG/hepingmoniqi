import './style.css';
import { WEAPON_IDS, MAP_IDS, TOOLS, MAPS, CAPACITY_TIERS, mapAvailable } from './content-catalog';
import { toolArtwork, backpackIcon } from './ui-icons';
import { MAX_SELECTED_TOOL_TYPES, selectedToolTypes, selectedToolTypeCount, canSelectToolType, validateToolSelection, requiresLoadoutReselection } from './gameplay';
import { createExperimentFlow } from './experiment-flow';
import { toolAvailable, nextGoal, capacityForResearch, weaponCost, validateLoadout, crossedUnlocks, deliveryPolicy } from './gameplay';
import { createNavigation } from './navigation';
import type { GameMode, GameScreen } from './navigation';
import { createAudio } from './audio';
import {loadGameSave,saveGameSnapshot} from './game-save-store';
import { createStructuralGameWorld, previewGameVoxels } from './structural/game-world';
import { createScene } from './scene';
import { createProjectilePhysics } from './physics';
import type { SceneApi, Vec3, WeaponId, ProjectilePhysics, Detonation, MapId, ProjectileCommand, TriggerMode, Loadout } from './contracts';

async function boot(){
const weapons=WEAPON_IDS;
const names=Object.fromEntries(weapons.map(id=>[id,TOOLS[id].name])) as Record<WeaponId,string>;
const icon=(id:WeaponId)=>`<svg viewBox="0 0 32 32" aria-hidden="true">${toolArtwork[id]}</svg>`;
const buildingIcon='<svg viewBox="0 0 110 70" aria-hidden="true"><path d="m10 32 43-24 46 24-45 25z" fill="#ef8a30"/><path d="M17 34v26l37 10V47z" fill="#916132"/><path d="m54 47 37-15v28L54 70z" fill="#b48345"/><path d="M29 43v15m12-11v14m23-14v13m15-18v13" stroke="#ffd093" stroke-width="6"/><path d="m10 32 43-24 46 24-45 15z" fill="none" stroke="#ffd6a6" stroke-width="2"/></svg>';
const mapDescriptions:Record<MapId,{kicker:string;detail:string;picture:string}>={
 neighborhood:{kicker:'街区尺度',detail:'9栋独立建筑 · 道路与广场',picture:buildingIcon},
 city:{kicker:'城市尺度',detail:'6街区 · 36栋建筑',picture:buildingIcon},
 courtyard:{kicker:'WOOD / STONE',detail:'小型建筑 · 从这里开始',picture:buildingIcon},
 warehouse:{kicker:'TWIN BAY',detail:'双跨结构 · 分开支撑',picture:buildingIcon},
 bridge:{kicker:'ELEVATED LINK',detail:'高架连接 · 支撑实验',picture:'<svg viewBox="0 0 110 70" aria-hidden="true"><path d="m5 25 66-16 34 14-66 18z" fill="#8eb6bd"/><path d="M5 25v9l34 16V41z" fill="#3d596b"/><path d="m39 41 66-18v10L39 50z" fill="#698695"/><path d="M14 37v22l13 6V43zm54 3v20l13-4V36z" fill="#a4ad9b"/><path d="M13 22v-8m20 4v-8m20 3V5m19 5V2" stroke="#dce3be" stroke-width="3"/><path d="m12 15 60-14" stroke="#dce3be" stroke-width="3"/></svg>'},
 tower:{kicker:'STACKED TOWER',detail:'叠层楼板 · 连锁坍塌',picture:'<svg viewBox="0 0 110 70" aria-hidden="true"><path d="m34 8 29-7 22 11-31 8z" fill="#b7c4b7"/><path d="M34 8v46l20 14V20z" fill="#9b7156"/><path d="m54 20 31-8v45L54 68z" fill="#526d7b"/><path d="m31 24 23 12 34-9m-57 9 23 12 34-9M31 48l23 12 34-9" fill="none" stroke="#d1c2a0" stroke-width="5"/><path d="M43 18v9m0 12v9m24-25v9m10-12v9m-10 16v9m10-12v9" stroke="#8bced5" stroke-width="5"/></svg>'},
 cantilever:{kicker:'CANTILEVER',detail:'悬臂平台 · 单侧承重',picture:'<svg viewBox="0 0 110 70" aria-hidden="true"><path d="m9 27 64-19 31 16-65 20z" fill="#acd5d6"/><path d="M9 27v9l30 17v-9z" fill="#41677b"/><path d="m39 44 65-20v9L39 53z" fill="#7094a1"/><path d="M25 43v19l13 7V50z" fill="#8f8773"/><path d="M38 50v19l10-4V47z" fill="#b5ad91"/><path d="m15 25 61-17M76 8l22 12" stroke="#e2e4cf" stroke-width="4"/></svg>'},
};
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<main class="game" data-screen="home"><div id="scene" aria-label="可旋转的真实三维实验场"></div><div class="screen-shade"></div>
<section id="home-screen" class="screen home-screen"><div class="home-panel panel"><div class="edition"><span class="status-dot"></span>体素拆除实验室 <span>V0.9</span></div><div class="game-logo"><span>核平</span>模拟器</div><p class="home-tagline">从一间小屋开始。<br>选好工具，亲手拆出下一种可能。</p><div class="home-modes"><button id="mode-main" class="mode-card primary"><span class="mode-index">01 / RESEARCH</span><strong id="main-entry-title">主模式</strong><small>携带配置 · 拆除建筑 · 累积研究</small><span class="mode-arrow">↗</span></button><button id="mode-free" class="mode-card"><span class="mode-index">02 / SANDBOX</span><strong>自由模式</strong><small>任选场景 · 无限弹药 · 不计研究</small><span class="mode-arrow">↗</span></button></div><div class="home-bottom"><button id="home-research">◇ 研究 <b id="home-research-value">0</b></button><button id="home-settings">⚙ 设置</button></div><p class="home-save">研究自动保存至此浏览器</p></div><div class="home-scene-note"><span>LIVE VOXEL WORLD</span><strong>体素破坏实验</strong><p>真实三维场景 · 弹道碰撞 · 结构坍塌</p></div></section>
<section id="setup-screen" class="screen setup-screen" hidden><header class="setup-header"><button id="setup-back" class="blue-button">← 返回主页</button><div><span class="eyebrow">PREPARE YOUR EXPERIMENT</span><h1 id="setup-title">主模式</h1></div><div class="research-badge">累计研究 <strong id="setup-research">0</strong><small>RP</small></div></header><div class="setup-columns"><aside class="scene-panel panel"><div class="panel-title"><span>01</span><h2>选择场景</h2></div><p class="panel-caption" id="scene-choice-caption">每次开始实验，建筑完整重建</p><div class="scene-choices" tabindex="0" aria-label="选择场景列表">${MAP_IDS.map(id=>`<button data-scene="${id}" class="scene-card${id==='courtyard'?' selected':''}"><span class="building-picture ${id}-picture">${mapDescriptions[id].picture}<span>${mapDescriptions[id].kicker}</span></span><div><strong>${MAPS[id].name}</strong><small id="map-hint-${id}">${mapDescriptions[id].detail}</small><span class="scene-state"></span></div></button>`).join('')}</div><div class="scene-footnote"><span>◈</span><p>场景与工具分别选择。<br>少量破坏也会留下研究成果。</p></div></aside><div class="setup-center"><span id="selected-scene-kicker">COURTYARD / E0</span><h2 id="selected-scene-name">木屋庭院</h2><p id="setup-center-copy">这一轮，准备怎样拆？</p></div><aside class="loadout-panel panel"><div class="panel-title"><span>02</span><h2 id="loadout-title">携带配置</h2></div><p class="panel-caption" id="loadout-caption">按格数配装，研究不会被消耗</p><p id="selection-limit" class="selection-limit" role="status"></p><p id="legacy-reselection" class="legacy-reselection" hidden></p><div class="loadout-rows" tabindex="0" aria-label="选择携带工具列表">${weapons.map(id=>`<div class="loadout-row" data-loadout="${id}"><span class="loadout-icon ${id}">${icon(id)}</span><div class="loadout-name"><strong>${names[id]}</strong><small id="loadout-hint-${id}">${weaponCost(id)}格 / 枚</small></div><div class="stepper"><button data-adjust="${id}" data-delta="-1" aria-label="减少${names[id]}">−</button><output id="loadout-${id}">0</output><button data-adjust="${id}" data-delta="1" aria-label="增加${names[id]}" class="add">＋</button></div><button type="button" class="free-tool-toggle" data-free-tool="${id}" aria-pressed="false" hidden>选择</button></div>`).join('')}</div><div id="capacity-section" class="capacity-section"><div><span class="capacity-title">携带容量 <button id="capacity-help" type="button" aria-label="查看携带容量升级条件" aria-haspopup="dialog">ⓘ</button></span><strong id="capacity-value">6 / 6</strong></div><div id="capacity-meter" class="capacity-meter"></div><p id="capacity-note">累计120研究：携带容量 6 → 8 格</p></div><div id="free-mode-note" class="free-mode-note" hidden><strong>∞ 无限弹药</strong><p>最多选择3种工具，所选工具无限使用。<br>共享主模式解锁，不获得研究。</p></div><button id="start-experiment" class="primary start-button">开始实验 <span>↗</span></button><p class="start-caption" id="start-caption">新解锁工具从下一轮起可携带</p></aside></div></section>
<section id="game-screen" class="screen game-screen" hidden><header class="top"><div class="location panel"><span class="location-mark">◈</span><div><h1 id="map-title">木屋庭院</h1><p><span id="mode-label">主模式</span> <span class="location-slash">/</span> <span id="game-research">0 RP</span></p></div></div><div class="round-status"><div class="damage-panel panel"><span>建筑拆除</span><strong id="damage">0<small>%</small></strong><i><b id="damage-bar"></b></i></div><button id="finish-round" class="blue-button">结束本轮</button></div></header><nav class="game-navigation"><button id="game-home">← 主页</button><button id="change-scene">更换场景 / 配置</button></nav><aside class="tools"><button id="pause" title="暂停模拟">Ⅱ <span>暂停</span></button><button id="camera" title="重置镜头">⌾ <span>镜头</span></button><button id="slow" title="慢动作">▷ <span>慢速</span></button><button id="settings" title="实验设置">⚙ <span>设置</span></button><button id="reset" title="重建自由场景并清除所有待爆物" hidden>↻ <span>重建</span></button></aside><div id="round-guidance" class="round-guidance"><strong id="objective-progress">建筑拆除0%</strong><span id="next-goal"></span></div><div class="aim-hint" id="aim-hint">＋ 点击建筑瞄准，然后发射或放置</div><aside id="tool-rail" class="tool-rail panel" data-collapsed="false"><button id="tool-rail-toggle" class="tool-rail-toggle" aria-expanded="true" aria-controls="tool-rail-content" aria-label="收起本轮工具栏"><span class="rail-expanded-title">本轮工具</span><span id="rail-current" class="rail-current"></span><span class="rail-toggle-copy">工具</span><span id="rail-chevron" aria-hidden="true">‹</span></button><div id="tool-rail-content"><div class="console-status"><span id="ammo">携带余量</span><span id="ammo-status"></span></div><div class="weapon-group">${weapons.map((id,i)=>`<button data-weapon="${id}" class="weapon${id==='charge'?' selected':''}"><span class="key">${i+1}</span><span class="weapon-icon ${id}">${icon(id)}</span><span><b>${names[id]}</b><small id="${id}-label">可使用</small><strong class="inventory-count" id="inventory-${id}">×0</strong></span></button>`).join('')}</div></div></aside><section id="operation-panel" class="operation-panel panel" aria-label="投放与引爆操作"><div class="experiment-controls"><div class="control-group"><span id="delivery-label">投放</span><div id="delivery" class="segmented-control" role="group" aria-labelledby="delivery-label" aria-describedby="control-note"><button type="button" data-delivery="quick" aria-pressed="true">发射</button><button type="button" data-delivery="place" aria-pressed="false">放置</button></div></div><div class="control-group"><span id="trigger-label">引爆</span><div id="trigger" class="segmented-control" role="group" aria-labelledby="trigger-label" aria-describedby="control-note"><button type="button" data-trigger="automatic" aria-pressed="true">自动</button><button type="button" data-trigger="remote" aria-pressed="false">遥控</button></div></div><p id="control-note" class="control-note">发射后自动引爆</p><label class="power"><span>威力 <strong id="power-value">100%</strong></span><input id="power" aria-label="武器威力" type="range" min="25" max="100" value="100"/></label></div><div class="action-buttons"><button id="fire" class="primary" disabled>发射 <small>SPACE</small></button><button id="detonate" disabled>引爆待爆物 0</button></div></section><div class="bottom-line"><span>拖动旋转 · 滚轮缩放 · 点击瞄准 · 空格发射</span><span id="save-status">本机自动保存</span></div></section>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<dialog id="completion-dialog" class="results-dialog panel"><span class="eyebrow">EXPERIMENT COMPLETE</span><h2 id="completion-title">本轮实验完成</h2><p id="result-map" class="result-map">木屋庭院</p><div class="result-metrics"><div><span>建筑拆除</span><strong id="result-damage">0<small>%</small></strong></div><div class="result-research"><span>本轮研究 <b id="result-earned">+0</b></span><span>累计研究 <b id="result-total">0</b></span></div><div class="result-meter"><i id="result-meter-fill"></i></div></div><p id="round-summary"></p><div id="result-unlocks" class="result-unlocks"></div><div class="completion-actions"><button id="retry-map" class="primary">再次挑战</button><button id="change-result-scene" class="blue-button">更换场景</button><button id="result-home" class="blue-button">返回主页</button></div><button id="observe-scene" class="text-button">查看现场 ↗</button></dialog>
<dialog id="navigation-dialog" class="panel"><span class="eyebrow">LEAVE EXPERIMENT?</span><h2>先结束当前实验？</h2><p>不会直接丢弃现场。确认后将引爆所有待爆物，等待爆炸与坍塌结束，再保留研究并离开。</p><div class="dialog-actions"><button id="confirm-leave" class="primary">引爆、结束并离开</button><button id="cancel-leave" class="blue-button">继续观察</button></div></dialog>
<dialog id="settings-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">EXPERIMENT SETTINGS</span><h2>实验设置</h2><label class="setting-row">静音<input id="mute" type="checkbox"/></label><p>爆炸与木块音效使用CC0素材。</p><label class="setting-row">减少动态效果<input id="reduce-motion" type="checkbox"/></label><p>降低模拟速度，便于观察破坏。</p><button class="done primary">返回</button></form></dialog>
<dialog id="capacity-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭容量说明">×</button><div class="capacity-scroll"><h2>携带容量</h2><p id="capacity-current">当前容量：6格</p><div id="capacity-cards" class="capacity-cards"></div><div id="capacity-tiers" class="capacity-tiers"></div><p>研究永久保留，达标自动扩容。新容量从下一轮配装生效；再次挑战仍沿用上一轮配置。</p></div><button class="done primary">知道了</button></form></dialog>
<dialog id="research-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭">×</button><h2>研究解锁</h2><p>研究永久保留，不用于消费。新工具从下一轮起生效。</p><ul class="research-list"><li>0 RP <b>手榴弹 · 1格</b></li><li>40 RP <b>火箭弹 · 2格</b></li><li>90 RP <b>遥控爆破包 · 2格</b></li><li>120 RP <b>双跨仓库 · 容量8格</b></li><li>240 RP <b>回声震荡器 · 高架连廊</b></li><li>420 RP <b>分裂球 · 叠层塔楼 · 容量10格</b></li><li>620 RP <b>穿行球 · 悬臂观景台</b></li><li>900 RP <b>街区冲击弹 · 街区</b></li><li>1400 RP <b>城市核爆弹 · 城市</b></li></ul><button class="done blue-button">知道了</button></form></dialog></main>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const dialog=(id:string)=>$<HTMLDialogElement>(id);
const audio=createAudio(), mainWorld=createStructuralGameWorld(), freeWorld=createStructuralGameWorld({free:true}), navigation=createNavigation();
let world=mainWorld, sandbox=false, mainSession=false;
let savePending=0,saveRevision=0,saveError:string|null=null,persistenceReadFailed=false;
let transitioning=false, lastStructuralEvent=0;
let eventCursor:{epoch:number;index:number}|undefined;
const seenStructuralEvents=new Set<string>();
const emptyLoadout=():Loadout=>Object.fromEntries(weapons.map(id=>[id,0])) as Loadout;
let selectedScene:MapId='courtyard', setupLoadout:Loadout={...emptyLoadout(),charge:6};
let freeSetupLoadout:Loadout={...emptyLoadout(),charge:1},freeRoundTools:WeaponId[]=['charge'];
let toolRailExpanded=!matchMedia('(max-width:650px), (max-height:500px)').matches;
let previewMap:MapId|null=null, previewActive=false;
let target:Vec3|null=null, weapon:WeaponId='charge', power=100, paused=false, slow=false, reducedMotion=false;
let delivery:'quick'|'place'='quick', trigger:TriggerMode='automatic';
let timer:ReturnType<typeof setTimeout>, shot=0, previousResearch=0, physics:ProjectilePhysics|null=null;
let lastFinishEvidence:{flow:string;paused:boolean;activeEffects:boolean;projectiles:number;detonations:{id:string;reason:string}[]}|null=null;
const flow=createExperimentFlow(), detonations:Detonation[]=[];
function toast(text:string){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('visible'),3600);}
try{const prior=await loadGameSave() as import('./contracts').WorldSnapshot|null;if(prior){if(!await mainWorld.restore(prior)){persistenceReadFailed=true;toast('存档校验未通过，原数据保留，本次不会覆盖保存。');}else {mainSession=!mainWorld.migrationPending&&!mainWorld.getRound().settled;selectedScene=mainWorld.getObjective().mapId;if(mainWorld.migrationPending)toast('旧研究与解锁已保留。地形系统升级，请重新配装开始；旧版存档仍保留。');}}}catch{persistenceReadFailed=true;toast('存档暂未读出，原数据不会覆盖。请刷新重试。');}
previousResearch=mainResearch();
let scene:SceneApi;
try{scene=createScene($('scene'),{onAim(point){if(navigation.snapshot.screen!=='playing'||flow.state==='ending')return;target=point;scene.setTarget(point);render();$('aim-hint').textContent=delivery==='place'?'表面已选定，点击放置布置当前工具。':'瞄准已就绪，点击发射或按空格。';},onFrame(dt){if(transitioning||!physics||!['playing','results'].includes(navigation.snapshot.screen))return;const before=physics.getProjectiles(),priorCount=before.length;for(const e of physics.step(dt))detonate(e);const after=physics.getProjectiles();for(const parent of before.filter(p=>p.weapon==='split'&&p.stage==='parent'))if(after.some(p=>p.id.startsWith(parent.id+':child:')))audio.playWeaponEvent({id:parent.id,epoch:world.epoch,weapon:'split',kind:'split',stage:'parent',position:parent.position});scene.setProjectiles(after);scene.setVoxels(world.getVoxels());processStructuralEvents();if(priorCount!==after.length)render();checkSettlement();}});scene.setMap(world.getObjective().mapId);scene.setVoxels(world.getVoxels());}
catch(error){app.innerHTML='<div class="startup-error"><h1>暂时无法开启三维实验场</h1><p>请使用支持WebGL2的浏览器。已保存研究未被清除。</p><button onclick="location.reload()">重新尝试</button></div>';throw error;}
async function bindPhysics(){
 physics?.dispose();physics=null;
 await world.activate();
 const host=world.physicsHost;if(!host)throw new Error('Structural world is not active');
 physics=await createProjectilePhysics({host});
 physics.setMap?.(world.getObjective().mapId);
 audio.resetEpoch(world.epoch);seenStructuralEvents.clear();const existing=world.eventsSince();eventCursor=existing.cursor;for(const e of existing.events)seenStructuralEvents.add(e.id);lastStructuralEvent=existing.cursor.index;
 physics.syncVoxels(world.getVoxels(),world.epoch);
}
await bindPhysics();
function processStructuralEvents(){
 const batch=world.eventsSince(eventCursor);eventCursor=batch.cursor;const events=batch.events;
 for(const e of events){if(seenStructuralEvents.has(e.id))continue;seenStructuralEvents.add(e.id);
  if(e.kind==='impact'||e.kind==='detach'){const cell=e.targetId!==undefined?world.getVoxel(e.targetId):null;const material=cell?.role==='terrain'?'soil':cell?.role==='road'?'road':cell?.material;scene.playStructuralEvent?.({...e,material,intensity:e.damage,scale:e.kind==='impact'?Math.min(3,Math.sqrt(e.damage??1)):1});}
  if(e.kind==='impact')audio.play('wood-impact',.45);
 }
 if(events.length){lastStructuralEvent=batch.cursor.index;const research=mainResearch();if(!sandbox&&research!==previousResearch){const unlocks=crossedUnlocks(previousResearch,research);if(unlocks.length)toast(`新解锁：${unlocks.join(' / ')}。下轮生效。`);previousResearch=research;save();}render();}
}

function mainResearch(){return mainWorld.getResearch();}
function activeRoundTools():WeaponId[]{return sandbox?[...freeRoundTools]:selectedToolTypes(world.getRound().loadout??emptyLoadout());}
function normalizeWeapon(){const carried=activeRoundTools();if(!carried.length)return;const usable=(id:WeaponId)=>sandbox||(world.getRound().remaining?.[id]??0)>0;if(!carried.includes(weapon)||!usable(weapon))weapon=carried.find(usable)??carried[0];}
function unlocked(id:WeaponId){return activeRoundTools().includes(id)&&toolAvailable(id,sandbox?mainResearch():world.getRound().startResearch,false);}
function selectedRemaining(){return sandbox?Infinity:world.getRound().remaining?.[weapon]??0;}
function totalRemaining(){return sandbox?Infinity:weapons.reduce((sum,id)=>sum+(world.getRound().remaining?.[id]??0),0);}
function loadoutCost(){return weapons.reduce((sum,id)=>sum+setupLoadout[id]*weaponCost(id),0);}
function syncWorld(){previewActive=false;scene.setMap(world.getObjective().mapId);physics?.setMap?.(world.getObjective().mapId);scene.setTrajectory(null);scene.setVoxels(world.getVoxels());physics?.syncVoxels(world.getVoxels(),world.epoch);scene.setProjectiles(physics?.getProjectiles()??[]);}
function save(){
 if(sandbox)return;
 if(persistenceReadFailed){$('save-status').textContent='原存档读取异常，本次不覆盖保存';return;}
 if(requiresLoadoutReselection(mainWorld.getRound()))return;if(!mainSession&&!mainWorld.getRound().settled)return;
 try{const snapshot=mainWorld.getSnapshot(),revision=++saveRevision;savePending++;saveError=null;$('save-status').textContent='正在保存现场…';
 void saveGameSnapshot(snapshot).then(()=>{if(revision===saveRevision)saveError=null;}).catch(error=>{if(revision===saveRevision)saveError=String(error);console.warn('Scene save unavailable',error);}).finally(()=>{savePending--;if(!savePending)$('save-status').textContent=saveError?'当前浏览器无法保存现场，请勿关闭页面':'研究与现场已保存';});
 }catch(error){saveError=String(error);$('save-status').textContent='现场暂未保存，请勿关闭页面';}
}

function setScreen(next:GameScreen,mode:GameMode=navigation.snapshot.mode){navigation.request(next,mode,false);render();}
function renderSetup(){
 const research=mainResearch(),free=navigation.snapshot.mode==='free',capacity=capacityForResearch(research),cost=loadoutCost();
 const selection=free?freeSetupLoadout:setupLoadout,typeCount=selectedToolTypeCount(selection),legacy=!free&&requiresLoadoutReselection(mainWorld.getRound());
 $('setup-title').textContent=free?'自由模式':'主模式';$('setup-research').textContent=String(research);
 $('loadout-title').textContent=free?'选择本轮工具':'携带配置';$('loadout-caption').textContent=free?'共享主模式解锁 · 所选工具无限使用':'按格数配装 · 研究不会被消耗';
 $('selection-limit').textContent=`本轮工具 ${typeCount} / ${MAX_SELECTED_TOOL_TYPES} 种${typeCount>=MAX_SELECTED_TOOL_TYPES?' · 减少至0可更换类型':''}`;
 $('selection-limit').classList.toggle('at-limit',typeCount>=MAX_SELECTED_TOOL_TYPES);
 $('legacy-reselection').hidden=!legacy;$('legacy-reselection').textContent='旧实验超过3种工具，研究与剩余弹药已保留。调整至最多3种后，明确开始新一轮；返回主页不会覆盖旧实验。';
 $('scene-choice-caption').textContent=free?'自由选择场景，建筑完整重建':'每次开始实验，建筑完整重建';
 $('selected-scene-name').textContent=MAPS[selectedScene].name;$('selected-scene-kicker').textContent=mapDescriptions[selectedScene].kicker;
 if(!previewActive||previewMap!==selectedScene){scene.setMap(selectedScene);scene.clearEffects();scene.setTarget(null);scene.setProjectiles([]);scene.setVoxels(previewGameVoxels(selectedScene));previewMap=selectedScene;previewActive=true;}
 $('setup-center-copy').textContent=free?'选好本轮工具，尽情观察每一次坍塌。':'这一轮，准备怎样拆？';
 document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(b=>{const id=b.dataset.scene as MapId,locked=!mapAvailable(id,research,free);b.disabled=locked;b.classList.toggle('selected',id===selectedScene);b.classList.toggle('locked',locked);b.setAttribute('aria-pressed',String(id===selectedScene));b.querySelector('.scene-state')!.textContent=locked?`${MAPS[id].research} RP`:id===selectedScene?'已选择':'选择场景';$('map-hint-'+id).textContent=locked?`主模式累计${MAPS[id].research}研究解锁`:mapDescriptions[id].detail;});
 for(const id of weapons){
  const open=toolAvailable(id,research,false),row=document.querySelector<HTMLElement>(`[data-loadout="${id}"]`)!;
  row.classList.toggle('locked',!open);row.classList.toggle('chosen',selection[id]>0);$('loadout-'+id).textContent=String(setupLoadout[id]);
  $('loadout-hint-'+id).textContent=open?(free?'所选工具 · 无限弹药':`${weaponCost(id)}格 / 枚`):`${TOOLS[id].research} RP解锁 · ${weaponCost(id)}格 / 枚`;
  row.querySelector<HTMLElement>('.stepper')!.hidden=free;
  const toggle=row.querySelector<HTMLButtonElement>('[data-free-tool]')!;toggle.hidden=!free;toggle.setAttribute('aria-pressed',String(freeSetupLoadout[id]>0));toggle.textContent=!open?'未解锁':freeSetupLoadout[id]>0?'✓ 已选':'选择';toggle.disabled=!open||(!freeSetupLoadout[id]&&!canSelectToolType(freeSetupLoadout,id));
  document.querySelectorAll<HTMLButtonElement>(`[data-adjust="${id}"]`).forEach(b=>b.disabled=!open||(b.dataset.delta==='1'?cost+weaponCost(id)>capacity||!canSelectToolType(setupLoadout,id):setupLoadout[id]<=0));
 }
 $('capacity-section').hidden=free;$('free-mode-note').hidden=!free;$('capacity-value').textContent=`${cost} / ${capacity}`;
 $('capacity-meter').innerHTML=Array.from({length:capacity},(_,i)=>`<i class="${i<cost?'filled':''}"></i>`).join('');
 $('capacity-note').textContent=research<120?'累计120研究 → 8格 · 累计420研究 → 10格':research<420?'累计420研究：携带容量 8 → 10 格':'容量10格 · 当前最高等级';
 $<HTMLButtonElement>('start-experiment').disabled=transitioning||!(free?validateToolSelection(freeSetupLoadout,research):validateLoadout(setupLoadout,research));
 $('start-experiment').innerHTML=(legacy?'重新配装并开始':'开始实验')+' <span>↗</span>';
 $('start-caption').textContent=free?'先选1至3种工具，再进入无限弹药实验':typeCount>MAX_SELECTED_TOOL_TYPES?'请先减少工具类型至最多3种':cost===0?'至少携带一枚工具才能开始':'新解锁工具从下一轮起可携带';
}
function renderToolRail(){
 const active=activeRoundTools(),count=sandbox?'∞':String(world.getRound().remaining?.[weapon]??0);
 const rail=$('tool-rail'),toggle=$('tool-rail-toggle');
 rail.dataset.collapsed=String(!toolRailExpanded);rail.toggleAttribute('collapsed',!toolRailExpanded);
 toggle.setAttribute('aria-expanded',String(toolRailExpanded));toggle.setAttribute('aria-label',toolRailExpanded?'收起本轮工具栏':`展开本轮工具栏，当前${names[weapon]}，${count==='∞'?'无限弹药':'剩余'+count+'枚'}`);
 $('tool-rail-content').hidden=!toolRailExpanded;$('rail-chevron').textContent=toolRailExpanded?'‹':'›';
 $('rail-current').innerHTML=`<span class="weapon-icon ${weapon}">${icon(weapon)}</span><b>${names[weapon]}</b><strong>${count==='∞'?'∞':'×'+count}</strong>`;
 document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>{const id=b.dataset.weapon as WeaponId;b.hidden=!active.includes(id);b.querySelector('.key')!.textContent=String(active.indexOf(id)+1);});
}

function render(){
 const policy=deliveryPolicy(weapon,delivery,trigger);delivery=policy.delivery;trigger=policy.trigger;
 const nav=navigation.snapshot,playing=nav.screen==='playing'||nav.screen==='results';
 if(!playing&&!transitioning&&physics&&world.pending()===0){physics.dispose();physics=null;world.suspend();}
 document.querySelector('.game')!.setAttribute('data-screen',nav.screen);
 $('home-screen').hidden=nav.screen!=='home';$('setup-screen').hidden=nav.screen!=='setup';$('game-screen').hidden=!playing;
 $('home-research-value').textContent=String(mainResearch());$('main-entry-title').textContent=mainSession&&!mainWorld.getRound().settled?'继续主模式':'主模式';
 if(nav.screen==='setup')renderSetup();
 const o=world.getObjective(),r=world.getRound(),research=mainResearch(),pct=Math.round(o.fraction*100),armed=physics?.getProjectiles().filter(p=>p.trigger==='remote').length??0;
 $('damage').innerHTML=`${pct}<small>%</small>`;$('damage-bar').style.width=`${pct}%`;$('game-research').textContent=`${research} RP`;$('objective-progress').textContent=`建筑拆除 ${pct}%`;$('next-goal').textContent=sandbox?'自由模式 · 无限弹药，不计研究':nextGoal(research,false,o.mapId);
 const carried=weapons.reduce((sum,id)=>sum+(r.loadout?.[id]??0)*weaponCost(id),0),remainingSlots=weapons.reduce((sum,id)=>sum+(r.remaining?.[id]??0)*weaponCost(id),0);
 $('ammo').textContent=sandbox?'自由实验 · ∞ 无限弹药':`携带余量 ${remainingSlots} / ${carried} 格`;
 $('ammo-status').textContent=!sandbox&&totalRemaining()===0?'弹药已用完，可继续观察或引爆':flow.state==='ending'?'正在等待爆炸与坍塌结束…':sandbox?'所有武器解锁以主模式为准':'新解锁工具于下一轮生效';
 document.querySelector('.console-status')?.classList.toggle('empty',!sandbox&&totalRemaining()===0);
 $('finish-round').textContent=flow.state==='ending'?'等待实验结束…':r.settled&&!sandbox?'查看本轮结果':sandbox?'结束自由实验':'结束本轮';$<HTMLButtonElement>('finish-round').disabled=flow.state==='ending';
 $('reset').hidden=!sandbox;$<HTMLButtonElement>('reset').disabled=flow.state==='ending';$<HTMLButtonElement>('game-home').disabled=flow.state==='ending';$<HTMLButtonElement>('change-scene').disabled=flow.state==='ending';
 $('map-title').textContent=MAPS[o.mapId].name;$('mode-label').textContent=sandbox?'自由模式':'主模式';
 document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>{const id=b.dataset.weapon as WeaponId,open=unlocked(id),count=r.remaining?.[id]??0;b.classList.toggle('locked',!open);b.classList.toggle('empty',!sandbox&&count===0);b.classList.toggle('selected',id===weapon);b.setAttribute('aria-pressed',String(id===weapon));b.disabled=!open||(!sandbox&&count===0)||flow.state==='ending';$('inventory-'+id).textContent=sandbox&&open?'∞':`×${count}`;$(id+'-label').textContent=open?sandbox?'无限弹药':`${weaponCost(id)}格 / 枚`:toolAvailable(id,research,false)?'下轮可携带':`${TOOLS[id].research} RP解锁`;});
 $('detonate').textContent=physics?.getProjectiles().some(p=>p.weapon==='phase'&&p.trigger==='remote')?`引爆 / 激活 ${armed}`:`引爆待爆物 ${armed}`;$<HTMLButtonElement>('detonate').disabled=!armed||paused||flow.state==='ending';$('detonate').classList.toggle('armed',armed>0);
 $('fire').innerHTML=(delivery==='place'?'放置':'发射')+' <small>SPACE</small>';
 $<HTMLButtonElement>('fire').disabled=!playing||!physics||!target||paused||!flow.canAct()||selectedRemaining()<=0||!unlocked(weapon)||(delivery==='place'&&!scene?.getAimSurface());
 document.querySelectorAll<HTMLButtonElement>('[data-delivery]').forEach(b=>{const chosen=b.dataset.delivery===delivery;b.setAttribute('aria-pressed',String(chosen));b.disabled=b.dataset.delivery==='quick'&&!policy.canLaunch;});
 document.querySelectorAll<HTMLButtonElement>('[data-trigger]').forEach(b=>{const chosen=b.dataset.trigger===trigger;b.setAttribute('aria-pressed',String(chosen));b.disabled=b.dataset.trigger==='automatic'&&!policy.canChooseTrigger;});
 $('control-note').textContent=weapon==='phase'?(delivery==='place'?'穿行球 · 遥控释放，沿途最多命中3处结构':trigger==='remote'?'穿行球 · 12秒内遥控激活，沿真实路径穿行':'穿行球 · 自动激活，沿途最多命中3处结构'):weapon==='echo'?'回声震荡器 · 放置后遥控触发三次脉冲':weapon==='shock'?'爆破包仅支持表面放置 · 遥控引爆':delivery==='place'?'放置后固定遥控引爆':trigger==='remote'?'发射后由你统一遥控引爆':weapon==='charge'?'发射后3秒自动引爆':'碰撞后自动引爆';
 renderToolRail();
}
function select(id:WeaponId){if(!sandbox&&(world.getRound().remaining?.[id]??0)<=0)return;if(!unlocked(id)){toast(toolAvailable(id,mainResearch(),false)?'已解锁，下轮准备时可携带。':'请在主模式积累研究解锁此工具。');return;}weapon=id;audio.play('ui-click',.7);render();}
function launchCommand():ProjectileCommand{return {id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,origin:scene.getLaunchOrigin(target!),target:{...target!},weapon,power:power/100,trigger};}
function fire(){
 if(transitioning||navigation.snapshot.screen!=='playing'||!target||!physics||!flow.canAct()||selectedRemaining()<=0||!unlocked(weapon)||document.querySelector('dialog[open]'))return;
 if(paused){toast('继续模拟后即可操作。');return;}
 let accepted=false;let eventId='';
 if(delivery==='place'){const surface=scene.getAimSurface();if(!surface)return;eventId=`${world.epoch}-${Date.now()}-${shot++}`;accepted=physics.attach({id:eventId,epoch:world.epoch,surface,power:power/100,weapon});}
 else {const command=launchCommand();eventId=command.id;accepted=physics.launch(command);}
 if(!accepted){toast('当前投放位置已变化，请重新选择。');render();return;}
 audio.playWeaponEvent({id:eventId,epoch:world.epoch,weapon,kind:delivery==='place'?'place':'launch',position:target});
 if(!sandbox)world.recordShot(weapon);scene.setProjectiles(physics.getProjectiles());save();render();
 $('aim-hint').textContent=weapon==='phase'?(delivery==='place'?'穿行球已放置。遥控激活后沿表面向内释放。':trigger==='remote'?'穿行球正在飞行，12秒内遥控激活后沿当前路径穿行。':'穿行球已激活，沿真实轨迹最多命中3处结构。'):delivery==='place'||trigger==='remote'?'遥控弹已布置。可继续安排，最后统一引爆。':weapon==='charge'?'手榴弹飞行中，3秒后在实际位置爆炸。':'弹体飞行中，碰撞后引爆。';
}
function detonate(event:Detonation){
 if(event.epoch!==world.epoch)return;
 const result=world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power,reward:!sandbox});if(!result.accepted)return;
 detonations.push({...event,position:{...event.position}});if(detonations.length>256)detonations.shift();syncWorld();scene.playStructuralEvent?.({id:event.id,epoch:event.epoch,position:event.position,kind:'detonation',tool:event.weapon,scale:TOOLS[event.weapon].radius*Math.sqrt(event.power)});audio.playWeaponEvent({id:event.id,epoch:event.epoch,weapon:event.weapon,kind:event.weapon==='phase'?'contact':'detonate',stage:event.stage,position:event.position});
 if(!sandbox){const research=mainResearch();const unlocks=crossedUnlocks(previousResearch,research);if(unlocks.length)toast(`新解锁：${unlocks.join(' / ')}。下轮生效，结算可查看。`);previousResearch=research;save();}render();
}
function detonateAll(){if(!physics)return;const parents=physics.getProjectiles().filter(p=>p.weapon==='split'&&p.stage==='parent');for(const e of physics.detonateAttached())detonate(e);const after=physics.getProjectiles();for(const parent of parents)if(after.some(p=>p.id.startsWith(parent.id+':child:')))audio.playWeaponEvent({id:parent.id,epoch:world.epoch,weapon:'split',kind:'split',stage:'parent',position:parent.position});scene.setProjectiles(after);render();}
function fillSummary(){
 const result=world.finishRound(),research=mainResearch(),r=world.getRound();flow.settled();save();
 $('result-map').textContent=MAPS[world.getObjective().mapId].name;$('result-damage').innerHTML=`${Math.round(result.destruction*100)}<small>%</small>`;$('result-earned').textContent=`+${result.researchEarned}`;$('result-total').textContent=String(research);$('result-meter-fill').style.width=`${Math.round(result.destruction*100)}%`;$('round-summary').textContent=`使用 ${result.used} / ${result.budget} 格携带容量。研究已保留。再次挑战沿用本轮配置；更换场景可重新配装。`;
 const unlocks=crossedUnlocks(r.startResearch,research);$('result-unlocks').replaceChildren();
 if(unlocks.length){const title=document.createElement('strong');title.textContent='本轮新解锁 · 下轮生效';const list=document.createElement('ul');for(const label of unlocks){const item=document.createElement('li');item.textContent=label;list.append(item);}$('result-unlocks').append(title,list);}else $('result-unlocks').textContent='少量破坏也是进展。下一轮换一种拆法。';
 return result;
}
function showSummary(){fillSummary();setScreen('results','main');if(!dialog('completion-dialog').open)dialog('completion-dialog').showModal();render();}
function checkSettlement(){
 if(!physics||!flow.shouldSettle(Math.max(world.pending(),physics.getPendingWorkCount?.()??physics.getProjectiles().length),scene.hasActiveEffects()))return;
 if(sandbox){flow.settled();world.finishRound();if(navigation.snapshot.waiting){navigation.settle();render();}else prepare('free');return;}
 if(navigation.snapshot.waiting){const result=fillSummary();navigation.settle();render();toast(`本轮已结束，获得 ${result.researchEarned} 研究，进度已保存。`);}else showSummary();
}
function updateTime(){scene.setTimeScale(paused?0:slow?.25:1);$('pause').classList.toggle('active',paused);$('slow').classList.toggle('active',slow);$('pause').innerHTML=paused?'▶ <span>继续</span>':'Ⅱ <span>暂停</span>';render();}
function beginFinish(){if(flow.state==='ending')return;flow.requestFinish();paused=false;slow=false;updateTime();detonateAll();render();lastFinishEvidence={flow:flow.state,paused,activeEffects:scene.hasActiveEffects(),projectiles:physics?.getProjectiles().length??0,detonations:detonations.map(e=>({id:e.id,reason:e.reason}))};checkSettlement();}
function requestNavigation(next:GameScreen){
 const protect=(navigation.snapshot.screen==='playing')&&flow.state!=='settled';
 if(!navigation.request(next,sandbox?'free':'main',protect)){if(!dialog('navigation-dialog').open)dialog('navigation-dialog').showModal();return;}
 render();
}
function clearTransient(){audio.resetEpoch(world.epoch);physics?.reset?.();flow.reset();scene.clearEffects();scene.setTrajectory(null);target=null;paused=false;slow=reducedMotion;detonations.length=0;lastFinishEvidence=null;scene.setTarget(null);syncWorld();updateTime();$('aim-hint').textContent='＋ 点击建筑瞄准，然后发射或放置';}
function prepare(mode:GameMode,map:MapId=selectedScene){selectedScene=map;if(mode==='main'&&!mapAvailable(selectedScene,mainResearch()))selectedScene='courtyard';setScreen('setup',mode);}
async function enterMain(){if(transitioning)return;if(requiresLoadoutReselection(mainWorld.getRound())){setupLoadout={...mainWorld.getRound().loadout!};prepare('main',mainWorld.getObjective().mapId);toast('旧实验数据已保留，请将携带工具调整到最多3种后开始新一轮。');return;}if(mainSession&&!mainWorld.getRound().settled){transitioning=true;physics?.dispose();physics=null;world.suspend();world=mainWorld;sandbox=false;await bindPhysics();transitioning=false;normalizeWeapon();setScreen('playing','main');clearTransient();toast('已继续原实验，剩余弹药与研究保持不变。');}else prepare('main',mainWorld.getObjective().mapId);}
async function startExperiment(){if(transitioning)return;
 const free=navigation.snapshot.mode==='free';
 if(!(free?validateToolSelection(freeSetupLoadout,mainResearch()):validateLoadout(setupLoadout,mainResearch())))return;
 transitioning=true;physics?.dispose();physics=null;world.suspend();render();
 if(free){freeRoundTools=selectedToolTypes(freeSetupLoadout);world=freeWorld;sandbox=true;await world.loadMap(selectedScene,true);}else{if(!await mainWorld.startRound(selectedScene,{...setupLoadout})){transitioning=false;await bindPhysics();toast('配置不合法，请检查容量与研究解锁。');render();return;}world=mainWorld;sandbox=false;mainSession=true;}
 await bindPhysics();transitioning=false;
 weapon=free?freeRoundTools[0]??'charge':weapons.find(id=>(world.getRound().remaining?.[id]??0)>0)??'charge';delivery='quick';trigger='automatic';setScreen('playing',free?'free':'main');clearTransient();previousResearch=mainResearch();save();render();
}
function guarded(action:()=>Promise<void>){return ()=>{void action().catch(error=>{transitioning=false;console.error(error);toast('场景暂未完成载入，原研究仍保留。请返回准备页重试。');render();});};}
$('mode-main').onclick=guarded(enterMain);$('mode-free').onclick=()=>{if(!transitioning)prepare('free');};$('setup-back').onclick=()=>{if(!transitioning)setScreen('home');};$('start-experiment').onclick=guarded(startExperiment);
$('game-home').onclick=()=>requestNavigation('home');$('change-scene').onclick=()=>{selectedScene=world.getObjective().mapId;requestNavigation('setup');};
$('confirm-leave').onclick=()=>{if(navigation.confirmFinish()){dialog('navigation-dialog').close();beginFinish();}};$('cancel-leave').onclick=()=>{navigation.cancel();dialog('navigation-dialog').close();};dialog('navigation-dialog').addEventListener('cancel',()=>navigation.cancel());
$('finish-round').onclick=()=>{if(!sandbox&&world.getRound().settled){showSummary();return;}beginFinish();};
$('fire').onclick=fire;$('detonate').onclick=()=>{if(!paused&&flow.canAct())detonateAll();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-delivery]')))b.onclick=()=>{delivery=b.dataset.delivery as typeof delivery;render();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-trigger]')))b.onclick=()=>{trigger=b.dataset.trigger as TriggerMode;render();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-weapon]')))b.onclick=()=>select(b.dataset.weapon as WeaponId);
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scene]')))b.onclick=()=>{if(transitioning)return;selectedScene=b.dataset.scene as MapId;renderSetup();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-adjust]')))b.onclick=()=>{const id=b.dataset.adjust as WeaponId,next=setupLoadout[id]+Number(b.dataset.delta);if(next<0||!toolAvailable(id,mainResearch(),false)||(next>setupLoadout[id]&&!canSelectToolType(setupLoadout,id)))return;const candidate={...setupLoadout,[id]:next};if(weapons.reduce((n,w)=>n+candidate[w]*weaponCost(w),0)>capacityForResearch(mainResearch()))return;setupLoadout=candidate;renderSetup();};
$('tool-rail-toggle').onclick=()=>{toolRailExpanded=!toolRailExpanded;renderToolRail();};
matchMedia('(max-width:650px), (max-height:500px)').addEventListener('change',event=>{toolRailExpanded=!event.matches;renderToolRail();});
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-free-tool]')))b.onclick=()=>{const id=b.dataset.freeTool as WeaponId;if(!toolAvailable(id,mainResearch(),false))return;if(!freeSetupLoadout[id]&&!canSelectToolType(freeSetupLoadout,id))return;freeSetupLoadout={...freeSetupLoadout,[id]:freeSetupLoadout[id]?0:1};renderSetup();};
$('power').addEventListener('input',e=>{power=Number((e.target as HTMLInputElement).value);$('power-value').textContent=`${power}%`;});
$('reset').onclick=async()=>{if(transitioning||!sandbox||flow.state==='ending')return;transitioning=true;physics?.dispose();physics=null;await world.reset();await bindPhysics();transitioning=false;clearTransient();toast('自由场景已完整重建，所有待爆物已清除。主模式研究不变。');};
$('pause').onclick=()=>{if(flow.state==='ending')return;paused=!paused;updateTime();};$('slow').onclick=()=>{if(flow.state==='ending')return;slow=!slow;updateTime();};$('camera').onclick=()=>scene.resetCamera();
for(const id of ['settings','home-settings'])$(id).onclick=()=>{if(flow.state!=='ending')dialog('settings-dialog').showModal();};$('home-research').onclick=()=>dialog('research-dialog').showModal();
$('mute').addEventListener('change',e=>audio.setMuted((e.target as HTMLInputElement).checked));$('reduce-motion').addEventListener('change',e=>{reducedMotion=(e.target as HTMLInputElement).checked;scene.setReducedMotion(reducedMotion);slow=reducedMotion;updateTime();});
$('capacity-help').onclick=()=>{const research=mainResearch(),capacity=capacityForResearch(research),next=CAPACITY_TIERS.find(t=>t.capacity>capacity);$('capacity-current').textContent=`当前 ${capacity} 格 · 累计研究 ${research} RP`;$('capacity-cards').innerHTML=`<article class="capacity-tier current"><span class="pack-symbol">${backpackIcon()}</span><div><strong>${capacity} <small>格</small></strong><p>✓ 已解锁 · 当前容量</p></div></article>${next?`<article class="capacity-tier next"><span class="pack-symbol">${backpackIcon(true)}</span><div><strong>${next.capacity} <small>格</small></strong><p>累计 ${next.research} 研究</p><progress max="${next.research}" value="${research}"></progress><small>${research} / ${next.research} · 还需 ${next.research-research}</small></div></article>`:'<article class="capacity-tier max"><span>✦</span><strong>已达最高容量</strong><p>当前所有容量升级均已解锁</p></article>'}`;$('capacity-tiers').innerHTML=CAPACITY_TIERS.map(t=>`<span class="${research>=t.research?'achieved':''}">${t.capacity}格 · ${t.research===0?'初始容量':`${t.research} RP`} ${research>=t.research?'✓':''}</span>`).join('');dialog('capacity-dialog').showModal();};
function closeCompletion(){dialog('completion-dialog').close();}
async function retryExperiment(){if(transitioning)return;
 if(!physics||!mainWorld.getRound().settled)return;
 const previousLoadout=mainWorld.getRound().loadout;if(!previousLoadout){toast('原配置暂不可用，请选择更换场景重新配装。');return;}
 const map=mainWorld.getObjective().mapId,loadout={...previousLoadout};
 if(requiresLoadoutReselection(mainWorld.getRound())){closeCompletion();setupLoadout={...loadout};prepare('main',map);toast('原配置超过3种工具，请重新选择。研究和旧实验已保留。');return;}transitioning=true;physics.dispose();physics=null;world.suspend();if(!await mainWorld.startRound(map,loadout)){transitioning=false;await bindPhysics();toast('原配置暂不可用，请选择更换场景重新配装。');return;}
 world=mainWorld;sandbox=false;await bindPhysics();transitioning=false;mainSession=true;selectedScene=map;setupLoadout={...loadout};
 weapon=weapons.find(id=>(loadout[id]??0)>0)??'charge';delivery='quick';trigger='automatic';
 closeCompletion();setScreen('playing','main');clearTransient();previousResearch=mainResearch();save();render();
 toast('已重建同一场景，沿用上一轮携带配置。研究已保留。');
}
$('retry-map').onclick=guarded(retryExperiment);$('change-result-scene').onclick=()=>{closeCompletion();prepare('main',world.getObjective().mapId);};$('result-home').onclick=()=>{closeCompletion();setScreen('home','main');};$('observe-scene').onclick=()=>{closeCompletion();setScreen('playing','main');};dialog('completion-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCompletion();setScreen('playing','main');});
window.addEventListener('keydown',e=>{if(navigation.snapshot.screen!=='playing'||(e.target as HTMLElement)?.matches('input,textarea,select,button')||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();fire();}const index=Number(e.code.replace('Digit',''))-1;const active=activeRoundTools();if(Number.isInteger(index)&&active[index])select(active[index]);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});render();
// Content discovery is separate from the gameplay save and never changes progression.
try{const key='hepingmoniqi.content-seen.v06',seen=JSON.parse(localStorage.getItem(key)??'[]') as string[],available=[...['echo','split','phase','heavy','nova'].filter(id=>toolAvailable(id as WeaponId,mainResearch())),...['bridge','tower','cantilever','neighborhood','city'].filter(id=>mapAvailable(id as MapId,mainResearch())),...(mainResearch()>=420?['capacity10']:[])],fresh=available.filter(id=>!seen.includes(id));if(fresh.length){toast('现有研究已解锁：'+fresh.map(id=>id==='capacity10'?'10格容量':id in TOOLS?TOOLS[id as WeaponId].name:MAPS[id as MapId].name).join('、')+'。下一轮配装可用。');localStorage.setItem(key,JSON.stringify([...new Set([...seen,...fresh])]));}}catch{/* Optional discovery notice must not affect saves. */}

// Read-only diagnostic snapshots, never a gameplay mutation API.
Object.assign(window,{__heping:{audio:()=>audio.getDiagnostics(),saveStatus:()=>({pending:savePending,error:saveError,readFailed:persistenceReadFailed}),scene:()=>scene.getDiagnostics(),sceneDiagnostics:()=>scene.getDiagnostics(),project:(point:Vec3)=>scene.projectPoint(point),snapshot:()=>world.getSnapshot(),voxels:()=>world.getVoxels(),mainSnapshot:()=>mainWorld.getSnapshot(),objective:()=>world.getObjective(),round:()=>world.getRound(),projectiles:()=>physics?.getProjectiles()??[],pendingWork:()=>Math.max(world.pending(),physics?.getPendingWorkCount?.()??physics?.getProjectiles().length??0),structuralEvents:()=>world.events(),structuralPending:()=>world.pending(),physicsLifecycle:()=>({activeWorlds:world.physicsHost?1:0,projectileBound:physics!==null,transitioning}),aimSurface:()=>scene.getAimSurface(),lastDetonations:()=>detonations.map(e=>({...e,position:{...e.position}})),preview:()=>null,get flow(){return flow.state;},get activeEffects(){return scene.hasActiveEffects();},get renderedProjectiles(){return scene.getRenderedProjectileCount();},get sandbox(){return sandbox;},get physicsReady(){return !transitioning&&(physics!==null||!['playing','results'].includes(navigation.snapshot.screen));},get target(){return target?{...target}:null;},get weapon(){return weapon;},get screen(){return navigation.snapshot.screen;},get navigation(){return navigation.snapshot;},get mode(){return navigation.snapshot.mode;},get inventory(){return sandbox?null:{...world.getRound().remaining};},get mainResearch(){return mainResearch();},get selectedScene(){return selectedScene;},get setupLoadout(){return {...setupLoadout};},get freeSetupLoadout(){return {...freeSetupLoadout};},get roundTools(){return activeRoundTools();},get toolRailExpanded(){return toolRailExpanded;},get previewMap(){return previewActive?previewMap:null;},get unlimitedAmmo(){return sandbox;},get lastFinishEvidence(){return lastFinishEvidence?structuredClone(lastFinishEvidence):null;}}});

}
void boot().catch(error=>{console.error(error);const node=document.querySelector('#app');if(node)node.innerHTML='<section class="startup-error"><h1>实验场暂未载入</h1><p>原存档仍保留。请刷新后重试。</p><button onclick="location.reload()">重新加载</button></section>';});
