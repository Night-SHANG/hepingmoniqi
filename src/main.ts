import './style.css';
import { createAudio } from './audio';
import { createWorld } from './domain';
import { createScene } from './scene';
import { createProjectilePhysics } from './physics';
import type { SceneApi, Vec3, WeaponId, WorldSnapshot, ProjectilePhysics, Detonation } from './contracts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="game"><div id="scene" aria-label="可旋转的三维小屋试验场"></div>
<header class="top"><div class="brand"><span class="cube">◈</span><div><h1>核平模拟器</h1><p>从小屋到宇宙 <span>DESTRUCTION SANDBOX</span></p></div></div><div class="stats"><div class="stat destruction"><span>◉ 破坏程度</span><strong id="damage">0<small>%</small></strong><i><b id="damage-bar"></b></i></div><div class="stat"><span>◇ 研究进度</span><strong id="research">0</strong><i><b id="research-bar"></b></i></div></div></header>
<section class="location"><b>E0</b><div><h2>小屋试验场 <span>/ 木屋庭院</span></h2><p><span class="green-dot"></span><span id="mode-label">成长模式</span> · 无人实验场</p></div></section>
<div class="intro" id="intro"><span>实验 001</span><h3>从一面墙开始</h3><p>拖动观察庭院，点选房屋、树木或庭院物件。<br>发射实体弹丸，观察飞行与碰撞。</p><button id="dismiss-intro">知道了 <span>↗</span></button></div>
<aside class="tools"><button id="pause" title="暂停模拟">Ⅱ <span>暂停</span></button><button id="slow" title="慢动作">◷ <span>0.25×</span></button><button id="camera" title="重置镜头">⌾ <span>镜头</span></button><button id="reset" title="重建小屋，保留研究进度">↻ <span>重建</span></button><button id="settings" title="设置">⚙ <span>设置</span></button></aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="aim-hint" id="aim-hint"><span>＋</span> 点选庭院物件，设置瞄准点</div>
<footer class="console"><div class="weapon-group"><button data-weapon="pulse" class="weapon selected"><span class="key">1</span><span class="weapon-icon">◉</span><span><b>脉冲弹</b><small>触碰即爆 · ∞</small></span></button><button data-weapon="charge" class="weapon"><span class="key">2</span><span class="weapon-icon">▦</span><span><b>延时弹</b><small id="charge-label">研究 35 解锁</small></span></button><button data-weapon="shock" class="weapon"><span class="key">3</span><span class="weapon-icon">✦</span><span><b>冲击弹</b><small id="shock-label">研究 100 解锁</small></span></button></div><label class="power"><span>威力 <strong id="power-value">100%</strong></span><input id="power" aria-label="武器威力" type="range" min="25" max="100" value="100"/><small>精细实验 <span>全力释放</span></small></label><button id="fire" disabled><span>✺</span> 发 射 <small>SPACE</small></button></footer>
<div class="bottom-line"><span>拖动旋转 · 滚轮缩放 · 点击瞄准 · 空格发射</span><span id="save-status">本机自动保存</span></div>
<dialog id="settings-dialog"><form method="dialog"><button class="close" aria-label="关闭">×</button><span class="eyebrow">EXPERIMENT SETTINGS</span><h2>实验设置</h2><label class="setting-row">自由沙盒 <input id="sandbox" type="checkbox"/></label><p>提前体验全部三种工具，不增加成长研究。</p><label class="setting-row">静音 <input id="mute" type="checkbox"/></label><p>爆炸与木块音效使用已核验的 CC0 素材。</p><label class="setting-row">减少动态效果 <input id="reduce-motion" type="checkbox"/></label><p>以慢动作观察破坏，降低动态变化速度。</p><button class="done">返回实验</button></form></dialog>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = createAudio();
const world = createWorld();
const saveKey = 'hepingmoniqi.first-playable.v1';
let target: Vec3 | null = null;
let weapon: WeaponId = 'pulse';
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
try { const raw = localStorage.getItem(saveKey); if (raw) { const prior = JSON.parse(raw); if (!world.restore(prior)) toast('存档不兼容，已保留原数据并开启新实验。'); else if (prior.schemaVersion !== 2) toast('旧实验已恢复，新增庭院物件可破坏；研究保留。'); } } catch { toast('存档暂不可用，本次实验仍可继续。'); }
previousResearch = world.getSnapshot().research;
let scene: SceneApi;
try { scene = createScene($('scene'), { onAim(point) { target = point; scene.setTarget(point); if(physics) $('fire').removeAttribute('disabled'); $('aim-hint').innerHTML = '<span>＋</span> 瞄准点已就绪 · 按空格或发射'; $('intro').classList.add('hidden'); }, onFrame(dt) { if(!physics) return; for(const event of physics.step(dt)) detonate(event); scene.setProjectiles(physics.getProjectiles()); } });
scene.setVoxels(world.getVoxels());
} catch (error) { app.innerHTML = '<div class="startup-error"><span>◇</span><h1>暂时无法开启三维实验场</h1><p>此浏览器未能建立 WebGL2 图形环境。请启用浏览器硬件加速，或换用支持 WebGL2 的浏览器。</p><p>你的已保存研究进度未被清除。</p><button onclick="location.reload()">重新尝试</button></div>'; throw error; }

void createProjectilePhysics().then(engine => { physics=engine; physics.syncVoxels(world.getVoxels(),world.epoch); if(target) $('fire').removeAttribute('disabled'); }).catch(error => { console.error('Projectile physics initialization failed',error); toast('物理系统加载失败，请刷新重试。'); $('fire').setAttribute('disabled',''); });
function syncWorld() { scene.setVoxels(world.getVoxels()); physics?.syncVoxels(world.getVoxels(),world.epoch); scene.setProjectiles(physics?.getProjectiles() ?? []); }

function save() { if (sandbox) return; try { localStorage.setItem(saveKey, JSON.stringify(world.getSnapshot())); $('save-status').textContent = '已保存到此浏览器'; } catch { $('save-status').textContent = '未保存 · 浏览器存储不可用'; } }
function unlocked(id: WeaponId) { return sandbox || id === 'pulse' || world.getSnapshot().research >= (id === 'charge' ? 35 : 100); }
function render() { const s = world.getSnapshot(); const pct = s.totalCount ? Math.round(s.destroyedCount / s.totalCount * 100) : 0; $('damage').innerHTML = `${pct}<small>%</small>`; $('damage-bar').style.width = `${pct}%`; $('research').textContent = String(Math.floor(s.research)); $('research-bar').style.width = `${Math.min(100,s.research)}%`; $('charge-label').textContent = unlocked('charge') ? '发射后 3 秒 · ∞' : '研究 35 解锁'; $('shock-label').textContent = unlocked('shock') ? '触碰即爆 · 范围' : '研究 100 解锁'; document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b => { b.classList.toggle('locked', !unlocked(b.dataset.weapon as WeaponId)); b.classList.toggle('selected', b.dataset.weapon === weapon); }); }
function select(id: WeaponId) { if (!unlocked(id)) { toast(id === 'charge' ? '累计 35 研究进度后解锁延时弹' : '累计 100 研究进度后解锁冲击弹'); return; } weapon = id; audio.play('ui-click',0.7); render(); }
function fire() {
 if (!target || !physics || $('settings-dialog').hasAttribute('open')) return;
 if (paused) { toast('模拟已暂停，继续后即可发射。'); return; }
 const accepted=physics.launch({id:`${world.epoch}-${Date.now()}-${shot++}`,epoch:world.epoch,origin:scene.getLaunchOrigin(target),target:{...target},weapon,power:power/100});
 if(!accepted){toast('空中弹丸已达上限，稍候再发射。');return;}
 scene.setProjectiles(physics.getProjectiles());
 $('aim-hint').innerHTML=weapon==='charge'?'<span>◷</span> 延时弹已发射 · 3 秒后在实际位置引爆':'<span>↗</span> 弹丸飞行中 · 触碰实体后引爆';
}
function detonate(event: Detonation) {
 if(event.epoch!==world.epoch)return;
 const before=world.getSnapshot();
 const result=world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power});
 if(!result.accepted)return;
 detonations.push({...event,position:{...event.position}}); if(detonations.length>32)detonations.shift();
 syncWorld(); scene.playDamage(result,event.position,event.weapon);
 audio.play('blast',event.weapon==='shock'?1:.8);
 if(result.newlyDestroyed)setTimeout(()=>audio.play('wood-impact',.75),120);
 render();
 if(!sandbox){const s=world.getSnapshot();if(previousResearch<100&&s.research>=100)toast('新工具已解锁：冲击弹 · 按 3 切换');else if(previousResearch<35&&s.research>=35)toast('新工具已解锁：延时弹 · 按 2 切换');else if(!before.firstRewardClaimed&&s.firstRewardClaimed)toast('实验目标达成！可继续破坏或重建庭院。');previousResearch=s.research;save();}
 $('aim-hint').innerHTML='<span>＋</span> 可以继续发射 · 空洞不再阻挡弹丸';
}
$('fire').addEventListener('click', fire);
document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b => b.addEventListener('click', () => select(b.dataset.weapon as WeaponId)));
$('power').addEventListener('input', e => { power = Number((e.target as HTMLInputElement).value); $('power-value').textContent = `${power}%`; });
function updateTime() { scene.setTimeScale(paused ? 0 : slow ? 0.25 : 1); $('pause').classList.toggle('active',paused); $('slow').classList.toggle('active',slow); $('pause').innerHTML = paused ? '▶ <span>继续</span>' : 'Ⅱ <span>暂停</span>'; }
$('pause').onclick = () => { paused = !paused; updateTime(); };
$('slow').onclick = () => { slow = !slow; updateTime(); };
$('camera').onclick = () => scene.resetCamera();
$('reset').onclick = () => { world.reset(); syncWorld(); detonations.length=0; target = null; scene.setTarget(null); $('fire').setAttribute('disabled',''); $('aim-hint').innerHTML = '<span>＋</span> 庭院已重建 · 重新选择瞄准点'; render(); save(); toast('庭院已重建，成长研究保留。'); };
$('dismiss-intro').onclick = () => $('intro').classList.add('hidden');
$('settings').onclick = () => ($('settings-dialog') as HTMLDialogElement).showModal();
$('sandbox').addEventListener('change',e => { sandbox = (e.target as HTMLInputElement).checked; if (sandbox) { growSnapshot = world.getSnapshot(); world.reset(); } else if (growSnapshot) { world.restore(growSnapshot); growSnapshot = null; } weapon='pulse'; target=null; scene.setTarget(null); $('fire').setAttribute('disabled',''); syncWorld(); detonations.length=0; $('aim-hint').innerHTML = '<span>＋</span> 点选庭院物件，设置瞄准点'; $('mode-label').textContent=sandbox?'自由沙盒 · 不记录成长':'成长模式'; render(); toast(sandbox?'沙盒已开启，全部工具可用。':'已返回成长实验。'); });
$('mute').addEventListener('change',e => audio.setMuted((e.target as HTMLInputElement).checked));
$('reduce-motion').addEventListener('change',e => { slow=(e.target as HTMLInputElement).checked; updateTime(); });
window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.matches('input,textarea,select') || $('settings-dialog').hasAttribute('open')) return; if (e.code === 'Space') { e.preventDefault(); fire(); } if (e.code === 'Digit1') select('pulse'); if (e.code === 'Digit2') select('charge'); if (e.code === 'Digit3') select('shock'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
render();
// Read-only diagnostic state for browser acceptance checks; no hidden gameplay shortcuts.
Object.assign(window, { __heping: { snapshot: () => world.getSnapshot(), projectiles: () => physics?.getProjectiles() ?? [], lastDetonations: () => detonations.map(e=>({...e,position:{...e.position}})), get physicsReady() {return physics!==null;}, get target() { return target; }, get weapon() { return weapon; } } });
