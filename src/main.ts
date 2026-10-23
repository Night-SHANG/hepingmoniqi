import './style.css';
import {toolAvailable,nextGoal} from './gameplay';
import { createAudio } from './audio';
import { createWorld } from './domain';
import { createScene } from './scene';
import { createProjectilePhysics } from './physics';
import type { SceneApi, Vec3, WeaponId, WorldSnapshot, ProjectilePhysics, Detonation, MapId } from './contracts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="game"><div id="scene" aria-label="可旋转的三维小屋试验场"></div>
<header class="top"><div class="brand"><span class="cube">◈</span><div><h1>核平模拟器</h1><p>从小屋到宇宙 <span>DESTRUCTION SANDBOX</span></p></div></div><div class="stats"><div class="stat destruction"><span>◉ 建筑拆除</span><strong id="damage">0<small>%</small></strong><i><b id="damage-bar"></b></i></div><div class="stat"><span>◇ 研究进度</span><strong id="research">0</strong><i><b id="research-bar"></b></i></div></div></header>
<section class="location"><b>E0</b><div><h2 id="map-title">小屋试验场 <span>/ 木屋庭院</span></h2><p><span class="green-dot"></span><span id="mode-label">成长模式</span> · 无人实验场</p></div></section>
<section class="mission"><div><b>本局目标</b><strong id="objective-progress">建筑拆除 0% / 70%</strong></div><p id="next-goal"></p><nav><button id="map-courtyard">木屋庭院</button><button id="map-warehouse" disabled>仓库 · 完成庭院解锁</button></nav></section>
<div class="intro" id="intro"><span>实验 001</span><h3>从手榴弹开始</h3><p>把建筑拆到70%，开启下一张地图。<br>先试手榴弹，再解锁火箭和遥控包。</p><button id="dismiss-intro">知道了 <span>↗</span></button></div>
<aside class="tools"><button id="pause" title="暂停模拟">Ⅱ <span>暂停</span></button><button id="slow" title="慢动作">◷ <span>0.25×</span></button><button id="camera" title="重置镜头">⌾ <span>镜头</span></button><button id="reset" title="重建小屋，保留研究进度">↻ <span>重建</span></button><button id="settings" title="设置">⚙ <span>设置</span></button></aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="aim-hint" id="aim-hint"><span>＋</span> 点选庭院物件，设置瞄准点</div>
<footer class="console"><div class="weapon-group"><button data-weapon="charge" class="weapon selected"><span class="key">1</span><span class="weapon-icon">▦</span><span><b>手榴弹</b><small>投掷 · 3秒延时</small></span></button><button data-weapon="pulse" class="weapon"><span class="key">2</span><span class="weapon-icon">➤</span><span><b>火箭弹</b><small id="pulse-label">研究40解锁</small></span></button><button data-weapon="shock" class="weapon"><span class="key">3</span><span class="weapon-icon">▰</span><span><b>遥控爆破包</b><small id="shock-label">研究90解锁</small></span></button></div><label class="power"><span>威力 <strong id="power-value">100%</strong></span><input id="power" aria-label="武器威力" type="range" min="25" max="100" value="100"/><small>精细实验 <span>全力释放</span></small></label><div class="action-buttons"><button id="fire" disabled>投 掷 <small>SPACE</small></button><button id="detonate" disabled>引爆已放置 · 0</button></div></footer>
<div class="bottom-line"><span>拖动旋转 · 滚轮缩放 · 点击瞄准 · 空格发射</span><span id="save-status">本机自动保存</span></div>
<dialog id="completion-dialog"><span class="eyebrow">EXPERIMENT COMPLETE</span><h2 id="completion-title">建筑目标完成</h2><p>目标建筑已拆除70%，不需要清理树木和围栏。</p><div class="completion-actions"><button id="next-map">前往双跨仓库</button><button id="retry-map">重试本图</button><button id="continue-free">继续自由破坏</button></div></dialog>
<dialog id="settings-dialog"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">EXPERIMENT SETTINGS</span><h2>实验设置</h2><label class="setting-row">自由沙盒 <input id="sandbox" type="checkbox"/></label><p>提前体验全部三种工具，不增加成长研究。</p><label class="setting-row">静音 <input id="mute" type="checkbox"/></label><p>爆炸与木块音效使用已核验的 CC0 素材。</p><label class="setting-row">减少动态效果 <input id="reduce-motion" type="checkbox"/></label><p>以慢动作观察破坏，降低动态变化速度。</p><button class="done">返回实验</button></form></dialog>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = createAudio();
const world = createWorld();
const saveKey = 'hepingmoniqi.first-playable.v1';
let target: Vec3 | null = null;
let weapon: WeaponId = 'charge';
let power = 100;
let paused = false;
let slow = false;
let sandbox = false;
let growSnapshot: WorldSnapshot | null = null;
let timer: ReturnType<typeof setTimeout>;
let shot = 0;
let previousResearch = 0;
let physics: ProjectilePhysics | null = null;
const detonations: Detonation[] = [];
function toast(text: string) { $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(timer); timer = setTimeout(() => $('toast').classList.remove('visible'), 3400); }
try { const raw = localStorage.getItem(saveKey); if (raw) { const prior = JSON.parse(raw); if (!world.restore(prior)) toast('存档不兼容，已保留原数据并开启新实验。'); else if (prior.schemaVersion !== 3) toast('旧实验已恢复，研究保留；现在只统计建筑目标。'); } } catch { toast('存档暂不可用，本次实验仍可继续。'); }
previousResearch = world.getSnapshot().research;
let scene: SceneApi;
try { scene = createScene($('scene'), { onAim(point) { target = point; scene.setTarget(point); render(); $('aim-hint').innerHTML = '<span>＋</span> 瞄准点已就绪 · 按空格或发射'; $('intro').classList.add('hidden'); }, onFrame(dt) { if(!physics) return; for(const event of physics.step(dt)) detonate(event); scene.setProjectiles(physics.getProjectiles()); } });
scene.setVoxels(world.getVoxels());
} catch (error) { app.innerHTML = '<div class="startup-error"><span>◇</span><h1>暂时无法开启三维实验场</h1><p>此浏览器未能建立 WebGL2 图形环境。请启用浏览器硬件加速，或换用支持 WebGL2 的浏览器。</p><p>你的已保存研究进度未被清除。</p><button onclick="location.reload()">重新尝试</button></div>'; throw error; }

void createProjectilePhysics().then(engine => { physics=engine; physics.syncVoxels(world.getVoxels(),world.epoch); render(); }).catch(error => { console.error('Projectile physics initialization failed',error); toast('物理系统加载失败，请刷新重试。'); $('fire').setAttribute('disabled',''); });
function syncWorld() { scene.setVoxels(world.getVoxels()); physics?.syncVoxels(world.getVoxels(),world.epoch); scene.setProjectiles(physics?.getProjectiles() ?? []); }

function save() { if (sandbox) return; try { localStorage.setItem(saveKey, JSON.stringify(world.getSnapshot())); $('save-status').textContent = '已保存到此浏览器'; } catch { $('save-status').textContent = '未保存 · 浏览器存储不可用'; } }
function unlocked(id: WeaponId) { return toolAvailable(id,world.getSnapshot().research,sandbox); }
function render() {
 const s=world.getSnapshot(),o=world.getObjective(),pct=Math.round(o.fraction*100);
 $('damage').innerHTML=`${pct}<small>%</small>`;$('damage-bar').style.width=`${pct}%`;
 $('research').textContent=String(s.research);$('research-bar').style.width=`${Math.min(100,s.research/90*100)}%`;
 $('objective-progress').textContent=`建筑拆除 ${pct}% / 70%`;
 $('next-goal').textContent=sandbox?'自由模式 · 全部工具可用，不计成长':nextGoal(s.research,o.complete,o.mapId);
 $('map-title').textContent=o.mapId==='courtyard'?'小屋试验场 / 木屋庭院':'双跨仓库 / 拆除实验';
 $('map-courtyard').classList.toggle('active',o.mapId==='courtyard');$('map-warehouse').classList.toggle('active',o.mapId==='warehouse');
 const warehouseOpen=sandbox||o.completedMaps.includes('courtyard');($('map-warehouse') as HTMLButtonElement).disabled=!warehouseOpen;
 $('map-warehouse').textContent=warehouseOpen?'双跨仓库':'仓库 · 完成庭院解锁';
 $('pulse-label').textContent=unlocked('pulse')?'直击 · 碰撞即爆':'研究40解锁';$('shock-label').textContent=unlocked('shock')?'贴附 · 手动引爆':'研究90解锁';
 document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b=>{b.classList.toggle('locked',!unlocked(b.dataset.weapon as WeaponId));b.classList.toggle('selected',b.dataset.weapon===weapon);});
 const count=physics?.getProjectiles().filter(p=>p.state==='attached').length??0;
 $('detonate').textContent=`引爆已放置 · ${count}`;($('detonate') as HTMLButtonElement).disabled=!count||paused;
 $('detonate').classList.toggle('shown',weapon==='shock'||count>0);
 $('fire').innerHTML=weapon==='shock'?'贴 附 <small>SPACE</small>':weapon==='charge'?'投 掷 <small>SPACE</small>':'发 射 <small>SPACE</small>';
 ($('fire') as HTMLButtonElement).disabled=!physics||!target||(weapon==='shock'&&!scene?.getAimSurface());
}
function select(id:WeaponId){if(!unlocked(id)){toast(id==='pulse'?'建筑破坏累计40研究后解锁火箭弹':'建筑破坏累计90研究后解锁遥控包');return;}weapon=id;audio.play('ui-click',.7);render();}
function fire() {
 if (!target || !physics || $('settings-dialog').hasAttribute('open') || $('completion-dialog').hasAttribute('open')) return;
 if (paused) { toast('模拟已暂停，继续后即可发射。'); return; }
 const id=`${world.epoch}-${Date.now()}-${shot++}`;
 let accepted=false;
 if(weapon==='shock'){
  const surface=scene.getAimSurface();if(!surface){toast('请选择仍存在的建筑或物件表面，不能贴在空洞或地面。');return;}
  accepted=physics.attach({id,epoch:world.epoch,surface,power:power/100});
 }else accepted=physics.launch({id,epoch:world.epoch,origin:scene.getLaunchOrigin(target),target:{...target},weapon,power:power/100});
 if(!accepted){toast(weapon==='shock'?'无法贴附：请换一处表面，或先引爆已有爆破包。':'空中弹丸已达上限，稍候再试。');return;}
 scene.setProjectiles(physics.getProjectiles());render();
 $('aim-hint').innerHTML=weapon==='shock'?'<span>▰</span> 已贴附 · 点击“引爆已放置” · 附着面消失则失效':weapon==='charge'?'<span>◷</span> 手榴弹已投出 · 3秒后在实际位置爆炸':'<span>↗</span> 火箭飞行中 · 触碰实体后引爆';
}

function detonate(event: Detonation) {
 if(event.epoch!==world.epoch)return;
 const beforeObjective=world.getObjective();
 const result=world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power});
 if(!result.accepted)return;
 detonations.push({...event,position:{...event.position}}); if(detonations.length>32)detonations.shift();
 syncWorld(); scene.playDamage(result,event.position,event.weapon);
 audio.play('blast',event.weapon==='shock'?1:.8);
 if(result.newlyDestroyed)setTimeout(()=>audio.play('wood-impact',.75),120);
 render();
 if(!sandbox){const s=world.getSnapshot();if(previousResearch<90&&s.research>=90)toast('遥控爆破包已解锁 · 贴附后手动引爆');else if(previousResearch<40&&s.research>=40)toast('火箭弹已解锁 · 按2切换');previousResearch=s.research;save();
  if(!beforeObjective.complete&&world.getObjective().complete){paused=true;updateTime();$('completion-title').textContent=world.getObjective().mapId==='courtyard'?'庭院目标完成 · 仓库已解锁':'仓库目标完成';$('next-map').hidden=world.getObjective().mapId==='warehouse';($('completion-dialog') as HTMLDialogElement).showModal();}
 }
 $('aim-hint').innerHTML='<span>＋</span> 可以继续发射 · 空洞不再阻挡弹丸';
}
$('fire').addEventListener('click', fire);
$('detonate').onclick=()=>{if(!physics||paused)return;for(const event of physics.detonateAttached())detonate(event);scene.setProjectiles(physics.getProjectiles());render();};
document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b => b.addEventListener('click', () => select(b.dataset.weapon as WeaponId)));
$('power').addEventListener('input', e => { power = Number((e.target as HTMLInputElement).value); $('power-value').textContent = `${power}%`; });
function updateTime() { scene.setTimeScale(paused ? 0 : slow ? 0.25 : 1); $('pause').classList.toggle('active',paused); $('slow').classList.toggle('active',slow); $('pause').innerHTML = paused ? '▶ <span>继续</span>' : 'Ⅱ <span>暂停</span>'; render(); }
$('pause').onclick = () => { paused = !paused; updateTime(); };
$('slow').onclick = () => { slow = !slow; updateTime(); };
$('camera').onclick = () => scene.resetCamera();
$('reset').onclick = () => { world.reset(); syncWorld(); detonations.length=0; target = null; scene.setTarget(null); $('fire').setAttribute('disabled',''); $('aim-hint').innerHTML = '<span>＋</span> 庭院已重建 · 重新选择瞄准点'; render(); save(); toast('庭院已重建，成长研究保留。'); };
$('dismiss-intro').onclick = () => $('intro').classList.add('hidden');
$('settings').onclick = () => ($('settings-dialog') as HTMLDialogElement).showModal();
$('sandbox').addEventListener('change',e => { sandbox = (e.target as HTMLInputElement).checked; if (sandbox) { growSnapshot = world.getSnapshot(); world.reset(); } else if (growSnapshot) { world.restore(growSnapshot); growSnapshot = null; } weapon='charge'; target=null; scene.setTarget(null); $('fire').setAttribute('disabled',''); syncWorld(); detonations.length=0; $('aim-hint').innerHTML = '<span>＋</span> 点选庭院物件，设置瞄准点'; $('mode-label').textContent=sandbox?'自由沙盒 · 不记录成长':'成长模式'; render(); toast(sandbox?'沙盒已开启，全部工具可用。':'已返回成长实验。'); });
$('mute').addEventListener('change',e => audio.setMuted((e.target as HTMLInputElement).checked));
$('reduce-motion').addEventListener('change',e => { slow=(e.target as HTMLInputElement).checked; updateTime(); });
window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.matches('input,textarea,select') || $('settings-dialog').hasAttribute('open') || $('completion-dialog').hasAttribute('open')) return; if (e.code === 'Space') { e.preventDefault(); fire(); } if (e.code === 'Digit1') select('charge'); if (e.code === 'Digit2') select('pulse'); if (e.code === 'Digit3') select('shock'); });
function enterMap(id:MapId){if(!world.loadMap(id,sandbox)){toast('先完成庭院建筑拆除70%，即可解锁仓库。');return;}paused=false;target=null;detonations.length=0;scene.setTarget(null);syncWorld();updateTime();render();save();}
$('map-courtyard').onclick=()=>enterMap('courtyard');$('map-warehouse').onclick=()=>enterMap('warehouse');
function closeCompletion(){($('completion-dialog') as HTMLDialogElement).close();paused=false;updateTime();}
$('completion-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCompletion();});
$('next-map').onclick=()=>{closeCompletion();enterMap('warehouse');};
$('retry-map').onclick=()=>{closeCompletion();$('reset').click();};
$('continue-free').onclick=()=>{closeCompletion();if(!sandbox){growSnapshot=world.getSnapshot();sandbox=true;($('sandbox') as HTMLInputElement).checked=true;$('mode-label').textContent='自由沙盒 · 不记录成长';}render();};
document.addEventListener('visibilitychange' , () => { if (document.hidden) save(); });
render();
// Read-only diagnostic state for browser acceptance checks; no hidden gameplay shortcuts.
Object.assign(window, { __heping: { snapshot: () => world.getSnapshot(), objective:()=>world.getObjective(), projectiles: () => physics?.getProjectiles() ?? [], lastDetonations: () => detonations.map(e=>({...e,position:{...e.position}})), get physicsReady() {return physics!==null;}, get target() { return target; }, get weapon() { return weapon; } } });
