# v0.4 finite-ammo destruction experiments

User explicitly opted out of waiting for ordinary design choices. Extend existing Three/Rapier implementation, do not restart it.

Defaults: six shared rounds per main-mode attempt, restored on deliberate retry/new map. Research from any building damage; no compulsory70%/100% pass and no automatic modal/pause. Warehouse unlock120 research. Free mode selects either building with unlimited ammunition/placements, but weapon unlocks come from saved main progression and free damage cannot advance research.

Control dimensions: place directly (armed remote), preview and confirm a real simulated flight, or quick fire; automatic contact/fuse or manual remote trigger for launched rounds. Placement includes valid ground. UI confirms trajectory without spending ammunition; successful execution spends one. Active-ordnance and cosmetic effects finish before a player-requested settlement opens. Waiting for settlement triggers existing armed remote ordnance once, then blocks new shots until settled. Never freeze the explosion to show results.

File boundaries: lead contracts/main/style/config/integration; economy worker domain/gameplay and tests; physics worker physics and tests; scene worker scene trajectory/dynamic instancing/effect status; QA worker newv04 browser script. Preserve historicalv03 tests but replace incompatible gameplay assertions with new explicit requirements, retain physical invariants.

Checks: budget exhaustion/reload preservation/retry refill; low-damage research/unlock path; free main-lock isolation; preview actual matching; remote launch/placement/manual detonation; >8 and >48 packages remain visible/real; no auto modal/pause at70%; explicit settlement waits events/effects; reset cancels pending events; real desktop/mobile screenshots. Cloud GitHub standardUbuntu browser route only.
