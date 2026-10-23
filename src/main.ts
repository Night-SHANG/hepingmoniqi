import './style.css';
import { createExperimentFlow } from './experiment-flow';
import { toolAvailable, nextGoal, capacityForResearch, weaponCost, validateLoadout, crossedUnlocks, deliveryPolicy } from './gameplay';
import { createNavigation } from './navigation';
import type { GameMode, GameScreen } from './navigation';
import { createAudio } from './audio';
import { createWorld } from './domain';
import { createScene } from './scene';
import { createProjectilePhysics } from './physics';
import type { SceneApi, Vec3, WeaponId, ProjectilePhysics, Detonation, MapId, ProjectileCommand, TriggerMode, Loadout } from './contracts';

const weapons:WeaponId[]=['charge','pulse','shock'];
const names:Record<WeaponId,string>={charge:'手榴弹',pulse:'火箭弹',shock:'遥控爆破包'};
const symbols:Record<WeaponId,string>={charge:'◈',pulse:'➤',shock:'▣'};
const weaponIcons:Record<WeaponId,string>={
 charge:'<path d="M12 5h8v5h-8zM21 5h4v13h-3V9h-1z" fill="currentColor"/><path d="M9 11h14l3 8-4 10H10L6 19zM8 17h16M9 23h14M13 11v17M19 11v17" fill="none" stroke="currentColor" stroke-width="2"/>',
 pulse:'<path d="m26 3 3 10-7-3z" fill="currentColor"/><path d="m21 9 4 4-13 13-5-5zM10 17l-6 2 2 5M17 24l-2 6-5-2M6 26l-3 3m7-3-4 4" fill="none" stroke="currentColor" stroke-width="2"/>',
 shock:'<rect x="3" y="8" width="26" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8v18M23 8v18" stroke="currentColor" stroke-width="3"/><rect x="13" y="12" width="6" height="6" fill="currentColor"/><path d="M16 8V3h7" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const icon=(id:WeaponId)=>`<svg viewBox="0 0 32 32" aria-hidden="true">${weaponIcons[id]}</svg>`;
const buildingIcon='<svg viewBox="0 0 110 70" aria-hidden="true"><path d="m10 32 43-24 46 24-45 25z" fill="#ef8a30"/><path d="M17 34v26l37 10V47z" fill="#916132"/><path d="m54 47 37-15v28L54 70z" fill="#b48345"/><path d="M29 43v15m12-11v14m23-14v13m15-18v13" stroke="#ffd093" stroke-width="6"/><path d="m10 32 43-24 46 24-45 15z" fill="none" stroke="#ffd6a6" stroke-width="2"/></svg>';
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<main class="game" data-screen="home"><div id="scene" aria-label="可旋转的真实三维实验场"></div><div class="screen-shade"></div>
<section id="home-screen" class="screen home-screen"><div class="home-panel panel"><div class="edition"><span class="status-dot"></span>体素拆除实验室 <span>V0.5.1</span></div><div class="game-logo"><span>核平</span>模拟器</div><p class="home-tagline">从一间小屋开始。<br>选好工具，亲手拆出下一种可能。</p><div class="home-modes"><button id="mode-main" class="mode-card primary"><span class="mode-index">01 / RESEARCH</span><strong id="main-entry-title">主模式</strong><small>携带配置 · 拆除建筑 · 累积研究</small><span class="mode-arrow">↗</span></button><button id="mode-free" class="mode-card"><span class="mode-index">02 / SANDBOX</span><strong>自由模式</strong><small>任选场景 · 无限弹药 · 不计研究</small><span class="mode-arrow">↗</span></button></div><div class="home-bottom"><button id="home-research">◇ 研究 <b id="home-research-value">0</b></button><button id="home-settings">⚙ 设置</button></div><p class="home-save">研究自动保存至此浏览器</p></div><div class="home-scene-note"><span>LIVE VOXEL WORLD</span><strong>体素破坏实验</strong><p>真实三维场景 · 弹道碰撞 · 结构坍塌</p></div></section>
<section id="setup-screen" class="screen setup-screen" hidden><header class="setup-header"><button id="setup-back" class="blue-button">← 返回主页</button><div><span class="eyebrow">PREPARE YOUR EXPERIMENT</span><h1 id="setup-title">主模式</h1></div><div class="research-badge">累计研究 <strong id="setup-research">0</strong><small>RP</small></div></header><div class="setup-columns"><aside class="scene-panel panel"><div class="panel-title"><span>01</span><h2>选择场景</h2></div><p class="panel-caption" id="scene-choice-caption">每次开始实验，建筑完整重建</p><div class="scene-choices"><button data-scene="courtyard" class="scene-card selected"><span class="building-picture cottage-picture">${buildingIcon}<span>WOOD / STONE</span></span><div><strong>木屋庭院</strong><small>小型建筑 · 从这里开始</small><span class="scene-state">已选择</span></div></button><button data-scene="warehouse" class="scene-card"><span class="building-picture warehouse-picture">${buildingIcon}<span>TWIN BAY</span></span><div><strong>双跨仓库</strong><small id="warehouse-lock">主模式累计120研究解锁</small><span class="scene-state">120 RP</span></div></button></div><div class="scene-footnote"><span>◈</span><p>场景与工具分别选择。<br>少量破坏也会留下研究成果。</p></div></aside><div class="setup-center"><span id="selected-scene-kicker">COURTYARD / E0</span><h2 id="selected-scene-name">木屋庭院</h2><p id="setup-center-copy">这一轮，准备怎样拆？</p></div><aside class="loadout-panel panel"><div class="panel-title"><span>02</span><h2 id="loadout-title">携带配置</h2></div><p class="panel-caption" id="loadout-caption">按格数配装，研究不会被消耗</p><div class="loadout-rows">${weapons.map(id=>`<div class="loadout-row" data-loadout="${id}"><span class="loadout-icon ${id}">${icon(id)}</span><div class="loadout-name"><strong>${names[id]}</strong><small id="loadout-hint-${id}">${weaponCost(id)}格 / 枚</small></div><div class="stepper"><button data-adjust="${id}" data-delta="-1" aria-label="减少${names[id]}">−</button><output id="loadout-${id}">0</output><button data-adjust="${id}" data-delta="1" aria-label="增加${names[id]}" class="add">＋</button></div><span class="free-unlock" id="free-unlock-${id}" hidden>已解锁</span></div>`).join('')}</div><div id="capacity-section" class="capacity-section"><div><span class="capacity-title">携带容量 <button id="capacity-help" type="button" aria-label="查看携带容量升级条件" aria-haspopup="dialog">ⓘ</button></span><strong id="capacity-value">6 / 6</strong></div><div id="capacity-meter" class="capacity-meter"></div><p id="capacity-note">累计120研究：携带容量 6 → 8 格</p></div><div id="free-mode-note" class="free-mode-note" hidden><strong>∞ 无限弹药</strong><p>所有场景均可自由选择。<br>共享主模式武器解锁，不获得研究。</p></div><button id="start-experiment" class="primary start-button">开始实验 <span>↗</span></button><p class="start-caption" id="start-caption">新解锁工具从下一轮起可携带</p></aside></div></section>
<section id="game-screen" class="screen game-screen" hidden><header class="top"><div class="location panel"><span class="location-mark">◈</span><div><h1 id="map-title">木屋庭院</h1><p><span id="mode-label">主模式</span> <span class="location-slash">/</span> <span id="game-research">0 RP</span></p></div></div><div class="round-status"><div class="damage-panel panel"><span>建筑拆除</span><strong id="damage">0<small>%</small></strong><i><b id="damage-bar"></b></i></div><button id="finish-round" class="blue-button">结束本轮</button></div></header><nav class="game-navigation"><button id="game-home">← 主页</button><button id="change-scene">更换场景 / 配置</button></nav><aside class="tools"><button id="pause" title="暂停模拟">Ⅱ <span>暂停</span></button><button id="camera" title="重置镜头">⌾ <span>镜头</span></button><button id="slow" title="慢动作">▷ <span>慢速</span></button><button id="settings" title="实验设置">⚙ <span>设置</span></button><button id="reset" title="重建自由场景并清除所有待爆物" hidden>↻ <span>重建</span></button></aside><div id="round-guidance" class="round-guidance"><strong id="objective-progress">建筑拆除0%</strong><span id="next-goal"></span></div><div class="aim-hint" id="aim-hint">＋ 点击建筑瞄准，然后发射或放置</div><footer class="console panel"><div class="console-status"><span id="ammo">携带容量6 / 6</span><span id="ammo-status">新解锁工具于下一轮生效</span></div><div class="console-main"><div class="weapon-group">${weapons.map((id,i)=>`<button data-weapon="${id}" class="weapon${id==='charge'?' selected':''}"><span class="key">${i+1}</span><span class="weapon-icon ${id}">${icon(id)}</span><span><b>${names[id]}</b><small id="${id}-label">可使用</small><strong class="inventory-count" id="inventory-${id}">×0</strong></span></button>`).join('')}</div><div class="experiment-controls"><div class="control-group"><span id="delivery-label">投放</span><div id="delivery" class="segmented-control" role="group" aria-labelledby="delivery-label" aria-describedby="control-note"><button type="button" data-delivery="quick" aria-pressed="true">发射</button><button type="button" data-delivery="place" aria-pressed="false">放置</button></div></div><div class="control-group"><span id="trigger-label">引爆</span><div id="trigger" class="segmented-control" role="group" aria-labelledby="trigger-label" aria-describedby="control-note"><button type="button" data-trigger="automatic" aria-pressed="true">自动</button><button type="button" data-trigger="remote" aria-pressed="false">遥控</button></div></div><p id="control-note" class="control-note">发射后自动引爆</p><label class="power"><span>威力 <strong id="power-value">100%</strong></span><input id="power" aria-label="武器威力" type="range" min="25" max="100" value="100"/></label></div><div class="action-buttons"><button id="fire" class="primary" disabled>发射 <small>SPACE</small></button><button id="detonate" disabled>引爆待爆物 0</button></div></div></footer><div class="bottom-line"><span>拖动旋转 · 滚轮缩放 · 点击瞄准 · 空格发射</span><span id="save-status">本机自动保存</span></div></section>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<dialog id="completion-dialog" class="results-dialog panel"><span class="eyebrow">EXPERIMENT COMPLETE</span><h2 id="completion-title">本轮实验完成</h2><p id="result-map" class="result-map">木屋庭院</p><div class="result-metrics"><div><span>建筑拆除</span><strong id="result-damage">0<small>%</small></strong></div><div class="result-research"><span>本轮研究 <b id="result-earned">+0</b></span><span>累计研究 <b id="result-total">0</b></span></div><div class="result-meter"><i id="result-meter-fill"></i></div></div><p id="round-summary"></p><div id="result-unlocks" class="result-unlocks"></div><div class="completion-actions"><button id="retry-map" class="primary">再次挑战</button><button id="change-result-scene" class="blue-button">更换场景</button><button id="result-home" class="blue-button">返回主页</button></div><button id="observe-scene" class="text-button">查看现场 ↗</button></dialog>
<dialog id="navigation-dialog" class="panel"><span class="eyebrow">LEAVE EXPERIMENT?</span><h2>先结束当前实验？</h2><p>不会直接丢弃现场。确认后将引爆所有待爆物，等待爆炸与坍塌结束，再保留研究并离开。</p><div class="dialog-actions"><button id="confirm-leave" class="primary">引爆、结束并离开</button><button id="cancel-leave" class="blue-button">继续观察</button></div></dialog>
<dialog id="settings-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">EXPERIMENT SETTINGS</span><h2>实验设置</h2><label class="setting-row">静音<input id="mute" type="checkbox"/></label><p>爆炸与木块音效使用CC0素材。</p><label class="setting-row">减少动态效果<input id="reduce-motion" type="checkbox"/></label><p>降低模拟速度，便于观察破坏。</p><button class="done primary">返回</button></form></dialog>
<dialog id="capacity-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭容量说明">×</button><span class="eyebrow">LOADOUT CAPACITY</span><h2>携带容量升级</h2><p id="capacity-current">当前容量：6格</p><ul class="research-list capacity-upgrades"><li><span>6格 · 初始容量</span><b>已解锁</b></li><li><span>8格 · 累计120研究</span><b id="capacity-eight-state">未解锁</b></li><li><span>10格 / 12格</span><b>后续开放</b></li></ul><p>研究永久保留，不用于消费。升级后可在下一轮配装时增加携带量；再次挑战仍沿用上一轮配置。</p><button class="done blue-button">知道了</button></form></dialog>
<dialog id="research-dialog" class="panel"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">PERMANENT RESEARCH</span><h2>研究解锁</h2><p>研究永久保留，不用于消费。新工具从下一轮起生效。</p><ul class="research-list"><li>0 RP <b>手榴弹 · 1格</b></li><li>40 RP <b>火箭弹 · 2格</b></li><li>90 RP <b>遥控爆破包 · 2格</b></li><li>120 RP <b>双跨仓库 · 容量8格</b></li></ul><button class="done blue-button">知道了</button></form></dialog></main>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const dialog=(id:string)=>$<HTMLDialogElement>(id);
const audio=createAudio(), mainWorld=createWorld(), freeWorld=createWorld(), navigation=createNavigation();
let world=mainWorld, sandbox=false, mainSession=false;
const saveKey='hepingmoniqi.first-playable.v1';
let selectedScene:MapId='courtyard', setupLoadout:Loadout={charge:6,pulse:0,shock:0};
let target:Vec3|null=null, weapon:WeaponId='charge', power=100, paused=false, slow=false, reducedMotion=false;
let delivery:'quick'|'place'='quick', trigger:TriggerMode='automatic';
let timer:ReturnType<typeof setTimeout>, shot=0, previousResearch=0, physics:ProjectilePhysics|null=null;
let lastFinishEvidence:{flow:string;paused:boolean;activeEffects:boolean;projectiles:number;detonations:{id:string;reason:string}[]}|null=null;
const flow=createExperimentFlow(), detonations:Detonation[]=[];
function toast(text:string){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('visible'),3600);}
try{const raw=localStorage.getItem(saveKey);if(raw){const prior=JSON.parse(raw);if(!mainWorld.restore(prior))toast('存档不兼容，已保留原数据并开启新实验。');else {mainSession=!mainWorld.getRound().settled;selectedScene=mainWorld.getObjective().mapId;if(prior.schemaVersion!==5)toast('旧研究与剩余弹药已保留，请继续实验。');}}}catch{toast('存档暂不可用，本轮仍可继续。');}
previousResearch=mainResearch();
let scene:SceneApi;
try{scene=createScene($('scene'),{onAim(point){if(navigation.snapshot.screen!=='playing'||flow.state==='ending')return;target=point;scene.setTarget(point);render();$('aim-hint').textContent=delivery==='place'?'表面已选定，点击放置布置当前工具。':'瞄准已就绪，点击发射或按空格。';},onFrame(dt){if(!physics)return;for(const e of physics.step(dt))detonate(e);scene.setProjectiles(physics.getProjectiles());checkSettlement();}});scene.setVoxels(world.getVoxels());}
catch(error){app.innerHTML='<div class="startup-error"><h1>暂时无法开启三维实验场</h1><p>请使用支持WebGL2的浏览器。已保存研究未被清除。</p><button onclick="location.reload()">重新尝试</button></div>';throw error;}
void createProjectilePhysics().then(engine=>{physics=engine;physics.syncVoxels(world.getVoxels(),world.epoch);render();}).catch(error=>{console.error(error);toast('物理系统加载失败，请刷新重试。');});
function mainResearch(){return mainWorld.getSnapshot().research;}
function unlocked(id:WeaponId){return toolAvailable(id,sandbox?mainResearch():world.getRound().startResearch,false);}
function selectedRemaining(){return sandbox?Infinity:world.getRound().remaining?.[weapon]??0;}
function totalRemaining(){return sandbox?Infinity:weapons.reduce((sum,id)=>sum+(world.getRound().remaining?.[id]??0),0);}
function loadoutCost(){return weapons.reduce((sum,id)=>sum+setupLoadout[id]*weaponCost(id),0);}
function syncWorld(){scene.setTrajectory(null);scene.setVoxels(world.getVoxels());physics?.syncVoxels(world.getVoxels(),world.epoch);scene.setProjectiles(physics?.getProjectiles()??[]);}
function save(){if(!mainSession&&!mainWorld.getRound().settled)return;try{localStorage.setItem(saveKey,JSON.stringify(mainWorld.getSnapshot()));$('save-status').textContent='研究与配置已保存';}catch{$('save-status').textContent='浏览器存储不可用';}}
function setScreen(next:GameScreen,mode:GameMode=navigation.snapshot.mode){navigation.request(next,mode,false);render();}
function renderSetup(){
 const research=mainResearch(), free=navigation.snapshot.mode==='free',capacity=capacityForResearch(research),cost=loadoutCost();
 $('setup-title').textContent=free?'自由模式':'主模式';$('setup-research').textContent=String(research);
 $('loadout-title').textContent=free?'可用工具':'携带配置';$('loadout-caption').textContent=free?'共享主模式解锁，每种工具无限使用':'按格数配装，研究不会被消耗';
 $('scene-choice-caption').textContent=free?'独立选择任意场景，无需研究门槛':'每次开始实验，建筑完整重建';
 $('selected-scene-name').textContent=selectedScene==='courtyard'?'木屋庭院':'双跨仓库';$('selected-scene-kicker').textContent=selectedScene==='courtyard'?'COURTYARD / E0':'TWIN WAREHOUSE / E1';
 $('setup-center-copy').textContent=free?'没有配额，尽情观察每一次坍塌。':'这一轮，准备怎样拆？';
 document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(b=>{const id=b.dataset.scene as MapId,locked=id==='warehouse'&&!free&&research<120;b.disabled=locked;b.classList.toggle('selected',id===selectedScene);b.classList.toggle('locked',locked);b.querySelector('.scene-state')!.textContent=locked?'120 RP':id===selectedScene?'已选择':'选择场景';});
 $('warehouse-lock').textContent=free?'自由开放 · 双跨结构':research<120?'主模式累计120研究解锁':'双跨结构 · 更大挑战';
 for(const id of weapons){const open=toolAvailable(id,research,false),row=document.querySelector<HTMLElement>(`[data-loadout="${id}"]`)!;row.classList.toggle('locked',!open);$('loadout-'+id).textContent=String(setupLoadout[id]);$('loadout-hint-'+id).textContent=open?`${weaponCost(id)}格 / 枚`:`${id==='pulse'?40:90} RP解锁 · ${weaponCost(id)}格 / 枚`;row.querySelector<HTMLElement>('.stepper')!.hidden=free;$('free-unlock-'+id).hidden=!free;$('free-unlock-'+id).textContent=open?'∞':'未解锁';document.querySelectorAll<HTMLButtonElement>(`[data-adjust="${id}"]`).forEach(b=>b.disabled=!open||(b.dataset.delta==='1'?cost+weaponCost(id)>capacity:setupLoadout[id]<=0));}
 $('capacity-section').hidden=free;$('free-mode-note').hidden=!free;$('capacity-value').textContent=`${cost} / ${capacity}`;$('capacity-meter').innerHTML=Array.from({length:capacity},(_,i)=>`<i class="${i<cost?'filled':''}"></i>`).join('');$('capacity-note').textContent=research<120?'累计120研究：携带容量 6 → 8 格':'已达120研究：容量 6 → 8 格（当前上限）';
 $<HTMLButtonElement>('start-experiment').disabled=!physics||(!free&&!validateLoadout(setupLoadout,research));$('start-caption').textContent=free?'仅练习与观察，不影响主模式研究':cost===0?'至少携带一枚工具才能开始':'新解锁工具从下一轮起可携带';
}
function render(){
 const policy=deliveryPolicy(weapon,delivery,trigger);delivery=policy.delivery;trigger=policy.trigger;
 const nav=navigation.snapshot,playing=nav.screen==='playing'||nav.screen==='results';
 document.querySelector('.game')!.setAttribute('data-screen',nav.screen);
 $('home-screen').hidden=nav.screen!=='home';$('setup-screen').hidden=nav.screen!=='setup';$('game-screen').hidden=!playing;
 $('home-research-value').textContent=String(mainResearch());$('main-entry-title').textContent=mainSession&&!mainWorld.getRound().settled?'继续主模式':'主模式';
 if(nav.screen==='setup')renderSetup();
 const o=world.getObjective(),r=world.getRound(),research=mainResearch(),pct=Math.round(o.fraction*100),armed=physics?.getProjectiles().filter(p=>p.state==='attached'||p.trigger==='remote').length??0;
 $('damage').innerHTML=`${pct}<small>%</small>`;$('damage-bar').style.width=`${pct}%`;$('game-research').textContent=`${research} RP`;$('objective-progress').textContent=`建筑拆除 ${pct}%`;$('next-goal').textContent=sandbox?'自由模式 · 无限弹药，不计研究':nextGoal(research,false,o.mapId);
 const carried=weapons.reduce((sum,id)=>sum+(r.loadout?.[id]??0)*weaponCost(id),0),remainingSlots=weapons.reduce((sum,id)=>sum+(r.remaining?.[id]??0)*weaponCost(id),0);
 $('ammo').textContent=sandbox?'自由实验 · ∞ 无限弹药':`携带余量 ${remainingSlots} / ${carried} 格`;
 $('ammo-status').textContent=!sandbox&&totalRemaining()===0?'弹药已用完，可继续观察或引爆':flow.state==='ending'?'正在等待爆炸与坍塌结束…':sandbox?'所有武器解锁以主模式为准':'新解锁工具于下一轮生效';
 document.querySelector('.console-status')?.classList.toggle('empty',!sandbox&&totalRemaining()===0);
 $('finish-round').textContent=flow.state==='ending'?'等待实验结束…':r.settled&&!sandbox?'查看本轮结果':sandbox?'结束自由实验':'结束本轮';$<HTMLButtonElement>('finish-round').disabled=flow.state==='ending';
 $('reset').hidden=!sandbox;$<HTMLButtonElement>('reset').disabled=flow.state==='ending';$<HTMLButtonElement>('game-home').disabled=flow.state==='ending';$<HTMLButtonElement>('change-scene').disabled=flow.state==='ending';
 $('map-title').textContent=o.mapId==='courtyard'?'木屋庭院':'双跨仓库';$('mode-label').textContent=sandbox?'自由模式':'主模式';
 document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>{const id=b.dataset.weapon as WeaponId,open=unlocked(id),count=r.remaining?.[id]??0;b.classList.toggle('locked',!open);b.classList.toggle('empty',!sandbox&&count===0);b.classList.toggle('selected',id===weapon);b.setAttribute('aria-pressed',String(id===weapon));$('inventory-'+id).textContent=sandbox&&open?'∞':`×${count}`;$(id+'-label').textContent=open?sandbox?'无限弹药':`${weaponCost(id)}格 / 枚`:toolAvailable(id,research,false)?'下轮可携带':`${id==='pulse'?40:90} RP解锁`;});
 $('detonate').textContent=`引爆待爆物 ${armed}`;$<HTMLButtonElement>('detonate').disabled=!armed||paused||flow.state==='ending';$('detonate').classList.toggle('armed',armed>0);
 $('fire').innerHTML=(delivery==='place'?'放置':'发射')+' <small>SPACE</small>';
 $<HTMLButtonElement>('fire').disabled=!playing||!physics||!target||paused||!flow.canAct()||selectedRemaining()<=0||!unlocked(weapon)||(delivery==='place'&&!scene?.getAimSurface());
 document.querySelectorAll<HTMLButtonElement>('[data-delivery]').forEach(b=>{const chosen=b.dataset.delivery===delivery;b.setAttribute('aria-pressed',String(chosen));b.disabled=b.dataset.delivery==='quick'&&!policy.canLaunch;});
 document.querySelectorAll<HTMLButtonElement>('[data-trigger]').forEach(b=>{const chosen=b.dataset.trigger===trigger;b.setAttribute('aria-pressed',String(chosen));b.disabled=b.dataset.trigger==='automatic'&&!policy.canChooseTrigger;});
 $('control-note').textContent=weapon==='shock'?'爆破包仅支持表面放置 · 遥控引爆':delivery==='place'?'放置后固定遥控引爆':trigger==='remote'?'发射后由你统一遥控引爆':weapon==='charge'?'发射后3秒自动引爆':'碰撞后自动引爆';
}
function select(id:WeaponId){if(!unlocked(id)){toast(toolAvailable(id,mainResearch(),false)?'已解锁，下轮准备时可携带。':'请在主模式积累研究解锁此工具。');return;}weapon=id;audio.play('ui-click',.7);render();}
function launchCommand():ProjectileCommand{return {id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,origin:scene.getLaunchOrigin(target!),target:{...target!},weapon,power:power/100,trigger};}
function fire(){
 if(navigation.snapshot.screen!=='playing'||!target||!physics||!flow.canAct()||selectedRemaining()<=0||!unlocked(weapon)||document.querySelector('dialog[open]'))return;
 if(paused){toast('继续模拟后即可操作。');return;}
 let accepted=false;
 if(delivery==='place'){const surface=scene.getAimSurface();if(!surface)return;accepted=physics.attach({id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,surface,power:power/100,weapon});}
 else accepted=physics.launch(launchCommand());
 if(!accepted){toast('当前投放位置已变化，请重新选择。');render();return;}
 if(!sandbox)world.recordShot(weapon);scene.setProjectiles(physics.getProjectiles());save();render();
 $('aim-hint').textContent=delivery==='place'||trigger==='remote'?'遥控弹已布置。可继续安排，最后统一引爆。':weapon==='charge'?'手榴弹飞行中，3秒后在实际位置爆炸。':'弹体飞行中，碰撞后引爆。';
}
function detonate(event:Detonation){
 if(event.epoch!==world.epoch)return;
 const result=world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power,reward:!sandbox});if(!result.accepted)return;
 detonations.push({...event,position:{...event.position}});if(detonations.length>256)detonations.shift();syncWorld();scene.playDamage(result,event.position,event.weapon);audio.play('blast',event.weapon==='shock'?1:.8);
 if(result.newlyDestroyed){const epoch=world.epoch;setTimeout(()=>{if(world.epoch===epoch)audio.play('wood-impact',.75);},120);}
 if(!sandbox){const research=mainResearch();const unlocks=crossedUnlocks(previousResearch,research);if(unlocks.length)toast(`新解锁：${unlocks.join(' / ')}。下轮生效，结算可查看。`);previousResearch=research;save();}render();
}
function detonateAll(){if(!physics)return;for(const e of physics.detonateAttached())detonate(e);scene.setProjectiles(physics.getProjectiles());render();}
function fillSummary(){
 const result=world.finishRound(),research=mainResearch(),r=world.getRound();flow.settled();save();
 $('result-map').textContent=world.getObjective().mapId==='courtyard'?'木屋庭院':'双跨仓库';$('result-damage').innerHTML=`${Math.round(result.destruction*100)}<small>%</small>`;$('result-earned').textContent=`+${result.researchEarned}`;$('result-total').textContent=String(research);$('result-meter-fill').style.width=`${Math.round(result.destruction*100)}%`;$('round-summary').textContent=`使用 ${result.used} / ${result.budget} 格携带容量。研究已保留。再次挑战沿用本轮配置；更换场景可重新配装。`;
 const unlocks=crossedUnlocks(r.startResearch,research);$('result-unlocks').replaceChildren();
 if(unlocks.length){const title=document.createElement('strong');title.textContent='本轮新解锁 · 下轮生效';const list=document.createElement('ul');for(const label of unlocks){const item=document.createElement('li');item.textContent=label;list.append(item);}$('result-unlocks').append(title,list);}else $('result-unlocks').textContent='少量破坏也是进展。下一轮换一种拆法。';
 return result;
}
function showSummary(){fillSummary();setScreen('results','main');if(!dialog('completion-dialog').open)dialog('completion-dialog').showModal();render();}
function checkSettlement(){
 if(!physics||!flow.shouldSettle(physics.getProjectiles().length,scene.hasActiveEffects()))return;
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
function clearTransient(){flow.reset();scene.clearEffects();scene.setTrajectory(null);target=null;paused=false;slow=reducedMotion;detonations.length=0;lastFinishEvidence=null;scene.setTarget(null);syncWorld();updateTime();$('aim-hint').textContent='＋ 点击建筑瞄准，然后发射或放置';}
function prepare(mode:GameMode,map:MapId=selectedScene){selectedScene=map;if(mode==='main'&&selectedScene==='warehouse'&&mainResearch()<120)selectedScene='courtyard';setScreen('setup',mode);}
function enterMain(){if(mainSession&&!mainWorld.getRound().settled){world=mainWorld;sandbox=false;setScreen('playing','main');clearTransient();toast('已继续原实验，剩余弹药与研究保持不变。');}else prepare('main',mainWorld.getObjective().mapId);}
function startExperiment(){
 const free=navigation.snapshot.mode==='free';
 if(!physics||(!free&&!validateLoadout(setupLoadout,mainResearch())))return;
 if(free){world=freeWorld;sandbox=true;world.loadMap(selectedScene,true);}else{if(!mainWorld.startRound(selectedScene,{...setupLoadout})){toast('配置不合法，请检查容量与研究解锁。');return;}world=mainWorld;sandbox=false;mainSession=true;}
 weapon=weapons.find(id=>free?toolAvailable(id,mainResearch(),false):(world.getRound().remaining?.[id]??0)>0)??'charge';delivery='quick';trigger='automatic';setScreen('playing',free?'free':'main');clearTransient();previousResearch=mainResearch();save();render();
}
$('mode-main').onclick=enterMain;$('mode-free').onclick=()=>prepare('free');$('setup-back').onclick=()=>setScreen('home');$('start-experiment').onclick=startExperiment;
$('game-home').onclick=()=>requestNavigation('home');$('change-scene').onclick=()=>{selectedScene=world.getObjective().mapId;requestNavigation('setup');};
$('confirm-leave').onclick=()=>{if(navigation.confirmFinish()){dialog('navigation-dialog').close();beginFinish();}};$('cancel-leave').onclick=()=>{navigation.cancel();dialog('navigation-dialog').close();};dialog('navigation-dialog').addEventListener('cancel',()=>navigation.cancel());
$('finish-round').onclick=()=>{if(!sandbox&&world.getRound().settled){showSummary();return;}beginFinish();};
$('fire').onclick=fire;$('detonate').onclick=()=>{if(!paused&&flow.canAct())detonateAll();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-delivery]')))b.onclick=()=>{delivery=b.dataset.delivery as typeof delivery;render();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-trigger]')))b.onclick=()=>{trigger=b.dataset.trigger as TriggerMode;render();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-weapon]')))b.onclick=()=>select(b.dataset.weapon as WeaponId);
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scene]')))b.onclick=()=>{selectedScene=b.dataset.scene as MapId;renderSetup();};
for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-adjust]')))b.onclick=()=>{const id=b.dataset.adjust as WeaponId,next=setupLoadout[id]+Number(b.dataset.delta);if(next<0||!toolAvailable(id,mainResearch(),false))return;const candidate={...setupLoadout,[id]:next};if(weapons.reduce((n,w)=>n+candidate[w]*weaponCost(w),0)>capacityForResearch(mainResearch()))return;setupLoadout=candidate;renderSetup();};
$('power').addEventListener('input',e=>{power=Number((e.target as HTMLInputElement).value);$('power-value').textContent=`${power}%`;});
$('reset').onclick=()=>{if(!sandbox||flow.state==='ending')return;world.reset();clearTransient();toast('自由场景已完整重建，所有待爆物已清除。主模式研究不变。');};
$('pause').onclick=()=>{if(flow.state==='ending')return;paused=!paused;updateTime();};$('slow').onclick=()=>{if(flow.state==='ending')return;slow=!slow;updateTime();};$('camera').onclick=()=>scene.resetCamera();
for(const id of ['settings','home-settings'])$(id).onclick=()=>{if(flow.state!=='ending')dialog('settings-dialog').showModal();};$('home-research').onclick=()=>dialog('research-dialog').showModal();
$('mute').addEventListener('change',e=>audio.setMuted((e.target as HTMLInputElement).checked));$('reduce-motion').addEventListener('change',e=>{reducedMotion=(e.target as HTMLInputElement).checked;slow=reducedMotion;updateTime();});
$('capacity-help').onclick=()=>{const research=mainResearch();$('capacity-current').textContent=`当前容量：${capacityForResearch(research)}格 · 累计研究 ${research} RP`;$('capacity-eight-state').textContent=research>=120?'已解锁':`还需 ${120-research} 研究`;dialog('capacity-dialog').showModal();};
function closeCompletion(){dialog('completion-dialog').close();}
function retryExperiment(){
 if(!physics||!mainWorld.getRound().settled)return;
 const previousLoadout=mainWorld.getRound().loadout;if(!previousLoadout){toast('原配置暂不可用，请选择更换场景重新配装。');return;}
 const map=mainWorld.getObjective().mapId,loadout={...previousLoadout};
 if(!mainWorld.startRound(map,loadout)){toast('原配置暂不可用，请选择更换场景重新配装。');return;}
 world=mainWorld;sandbox=false;mainSession=true;selectedScene=map;setupLoadout={...loadout};
 weapon=weapons.find(id=>(loadout[id]??0)>0)??'charge';delivery='quick';trigger='automatic';
 closeCompletion();setScreen('playing','main');clearTransient();previousResearch=mainResearch();save();render();
 toast('已重建同一场景，沿用上一轮携带配置。研究已保留。');
}
$('retry-map').onclick=retryExperiment;$('change-result-scene').onclick=()=>{closeCompletion();prepare('main',world.getObjective().mapId);};$('result-home').onclick=()=>{closeCompletion();setScreen('home','main');};$('observe-scene').onclick=()=>{closeCompletion();setScreen('playing','main');};dialog('completion-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCompletion();setScreen('playing','main');});
window.addEventListener('keydown',e=>{if(navigation.snapshot.screen!=='playing'||(e.target as HTMLElement)?.matches('input,textarea,select,button')||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();fire();}if(e.code==='Digit1')select('charge');if(e.code==='Digit2')select('pulse');if(e.code==='Digit3')select('shock');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});render();
// Read-only diagnostic snapshots, never a gameplay mutation API.
Object.assign(window,{__heping:{snapshot:()=>world.getSnapshot(),mainSnapshot:()=>mainWorld.getSnapshot(),objective:()=>world.getObjective(),round:()=>world.getRound(),projectiles:()=>physics?.getProjectiles()??[],lastDetonations:()=>detonations.map(e=>({...e,position:{...e.position}})),preview:()=>null,get flow(){return flow.state;},get activeEffects(){return scene.hasActiveEffects();},get renderedProjectiles(){return scene.getRenderedProjectileCount();},get sandbox(){return sandbox;},get physicsReady(){return physics!==null;},get target(){return target?{...target}:null;},get weapon(){return weapon;},get screen(){return navigation.snapshot.screen;},get navigation(){return navigation.snapshot;},get mode(){return navigation.snapshot.mode;},get inventory(){return sandbox?null:{...world.getRound().remaining};},get mainResearch(){return mainResearch();},get selectedScene(){return selectedScene;},get setupLoadout(){return {...setupLoadout};},get unlimitedAmmo(){return sandbox;},get lastFinishEvidence(){return lastFinishEvidence?structuredClone(lastFinishEvidence):null;}}});
