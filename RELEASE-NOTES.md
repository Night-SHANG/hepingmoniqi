# E0 v0.2 physical-projectile update

## Implemented
- Visible Rapier rigid-body projectiles, gravity and continuous collision detection. Aiming determines the initial flight path only; detonation uses the body's actual position.
- Pulse/shock detonate on contact. Delayed charges bounce and detonate after three simulated seconds from launch. Pause freezes both motion and fuse; quarter-speed slows both.
- Destruction removes live colliders. Repeated shots can pass through missing roof geometry and collide lower down.
- 1897 authoritative voxels: cottage, trees, fences, planters, workbench, crates and logs. Per-object support-collapse prevents nearby props from supporting one another accidentally.
- Legacy cottage saves migrate to the expanded courtyard without losing damage or earned research. Reset and sandbox transitions invalidate in-flight rounds.
- Bounded active-projectile and solver budgets; finite lifetime for misses. Low-frame-rate timing regression fixed with bounded fixed-step catchup and hidden-tab clock reset.
- Bundled licensed Chinese UI font subset avoids missing glyphs on systems without Chinese fonts.

## Verified final revision

Commit: 5bbc2ba7dd0c9a00629a6a65bd7e2af2269cca7c.
Real-browser run: https://github.com/Night-SHANG/hepingmoniqi/actions/runs/39900851540

- 24 domain and real Rapier tests; TypeScript and production build passed.
- Actual Chrome WebGL, real pointer aiming and fire controls, visible in-frame projectile bodies, no instant damage, repeated roof shot hitting lower live geometry.
- Delayed charge detonates at age 3.0 at its actual position; pause freezes it, reset invalidates it without late damage.
- Actual front-fence shot removed fence voxel 10371.
- Browser-local persistence, research-preserving reset and sandbox separation passed.
- Desktop and mobile-landscape captures, unobstructed controls, no page JavaScript errors.
- Font subset includes all 219 Chinese characters used by the current source; screenshots show readable Chinese.
- Low-FPS body/fuse equality verified at 1/2/5/10 fps versus 120 fps. Software browser screenshots verify function and appearance, not Android hardware performance.

## Boundaries
This is the first courtyard slice, not the eight-chapter game. Ground, grass, roads, lake and mountains are still non-destructible background. Debris is cosmetic animation; only launched rounds are rigid bodies. No real explosive engineering is modelled. Browser plus Android is the target direction, but no APK is included. Real touch-device performance, sustained frame-time/memory budgets and subjective speaker listening remain unverified.

Fully extract the ZIP, then use START-WINDOWS.bat with Python 3 installed, or python3 serve.py on macOS/Linux. Keep the server window open. Direct file:// opening is unsupported. Saves belong to the current browser and origin. The Windows launcher is supplied but not Windows-device-tested.
