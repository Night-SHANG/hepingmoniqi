# E0 v0.3 courtyard and warehouse progression

## Implemented
- A named building objective: demolish 70% of the building. Trees, fences and other props remain destructible but are not mandatory cleanup and grant no research.
- Start with a spinning, bouncing grenade. Building damage unlocks the directional rocket at 40 research and the attached manual remote package at 90 research.
- Three original silhouettes: segmented grenade shell with cap/lever, pointed rocket body with fins and exhaust, strapped flat package with status light.
- Packages attach only to live voxel faces. They never auto-detonate; use the manual detonator. Losing the host invalidates the package.
- Courtyard completion opens a result screen and unlocks a separate twin-bay warehouse. Retry retains growth; free mode isolates damage and rewards from growth saves.
- Strict legacy save migration retains earned research. Old transient projectiles are never restored.

## Verification status
Local 43 tests and TypeScript/production build pass. Native Three/Rapier preflight completes the courtyard in 17 mixed-tool shots and warehouse in four remote shots; this is deterministic automated targeting, not a claim of typical player completion time. Real Chrome WebGL verification for revision cd59370aa266d9919b3882af37775559f36736bd passed at https://github.com/Night-SHANG/hepingmoniqi/actions/runs/39903928429 .

The real-input suite confirmed the same 17-shot courtyard and four-shot warehouse path, building-only completion, all unlocks, manual package detonation/no automatic fuse, retry and reload persistence, isolated free mode, and mobile control access. All prior roof-hole, pause, reset and yard-collision browser regressions also passed. Visual-only polish adds original toolbar silhouettes, bounded high-contrast rocket geometry and rear colors, thin model outlines, and an offset attached-package check-mark annotation. The annotation is a depth-free UI overlay; the physical body remains correctly depth-tested and aligned. No gameplay or physics changed.

Final runtime revision: 68f644328c82cb21590648473899978274392bc5. Focused actual default-camera weapon captures, 43 tests and build passed at https://github.com/Night-SHANG/hepingmoniqi/actions/runs/39906204745 . The earlier full gameplay run remains the evidence for unchanged progression and physics. Final visual inspection confirms the grenade shell, brighter rocket rear/fins, attached-package marker and original tool icons; rocket side-profile detail is naturally limited when viewed along its real flight axis.

## Boundaries
Two compact E0 maps, not the complete city/planet concept. Background ground, water and distant terrain cannot be excavated. Debris remains cosmetic. This is a browser build, not an Android APK. Real device performance and subjective audio listening are not verified.

---
## Preserved previous release evidence

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
