# E0 first-playable release notes

Runtime revision: f4e0dcd7a0f24b6308766b47b6345c3aaef6a4cd.
Verification: https://github.com/Night-SHANG/hepingmoniqi/actions/runs/39893173987

## Implemented
One 1096-voxel cottage in a landscaped courtyard. Three fictional destruction tools; local damage and support-connectivity collapse; permanent research and tool unlocks; reset retaining growth; separate sandbox; orbit camera and short-click aiming; pause/slow motion; browser-local saving; CC0 audio with mute and bounded overlap. Dark-blue/orange interface follows the supplied visual direction, without claiming the concept artwork's detail level.

## Verified
- 10 domain tests and TypeScript/production build passed.
- Real Chromium WebGL canvas: 835 quantized colors across 20,334 bright center-region samples.
- Pointer drag did not aim or fire. An actual pointer-selected shot removed 9 voxels.
- Reload preserved damage and research; reset restored the cottage while retaining research.
- Sandbox shot removed 144 voxels; returning to growth restored its original state.
- Desktop 1440×900 and landscape 844×390 captures inspected.
- Settings, reset, pause and fire controls remain within the viewport and unobstructed on the landscape layout.
- No page JavaScript errors or horizontal overflow in this acceptance pass.
- Python launcher's local HTTP response verified. Windows launcher automation is supplied but not Windows-device-tested.

## Boundaries
This is the first cottage slice, not the eight-chapter game. Flying fragments are visual animation, not rigid-body or real explosive engineering simulation. Browser+Android is the target direction, but no APK or Android-device performance claim is made. Real touch devices, sustained frame-time/memory budgets and subjective speaker listening remain unverified. Current samples are short stylized CC0 sounds, not authentic nuclear recordings.

Opening index.html directly is not supported. Use the included local HTTP launcher; keep its command window open while playing. Saves belong to the current browser and origin.
