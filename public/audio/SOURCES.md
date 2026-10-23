# v08 sampled audio: provenance, mixing, and acceptance

All 23 runtime WAV files are existing CC0-1.0 recordings/sound effects from the already verified source collection. No paid API, new synthesis, retuning, EQ, time stretching, or source trimming was used. Every sample retains its complete duration. Source archives and research evidence pages are deliberately not included in the shipped runtime folder.

SOURCES.json contains original author/page, original source SHA-256, research preview SHA-256 where applicable, final runtime SHA-256, duration, measured peak, and all attenuation steps. LICENSE.txt gives the license and credits. The earlier three runtime files retain their original and prior-runtime hashes.

## Event identities

| Stable weapon ID | Accepted launch/place | Primary real event | Secondary layer |
| --- | --- | --- | --- |
| charge | grenade-release | grenade-blast | grenade-bounce is reserved; no current main-program contact call |
| pulse | rocket-launch | rocket-blast | none |
| shock | remote-arm | remote-blast | quiet remote-trigger confirmation |
| echo | echo-prime | echo-pulse for each real pulse ID | no extra generic explosion |
| split | split-release | split-burst-short for each real child ID | split-release once on a real parent split |
| phase | pierce-launch | pierce-contact on the currently connected real contact events | pierce-collapse is reserved; no current final-exhaustion call |
| heavy | cosmic-transition | split-burst-long | none |
| nova | cosmic-engine-bed | city-explosion-body | quiet city-distant-low after 0.35 seconds |

The eight tools currently use different original files for their primary real-event feedback; phase uses contact feedback rather than a final-exhaustion sound. grenade-bounce and pierce-collapse are shipped, tested API candidates only: neither is currently triggered by main.ts. Their presence in the sample set or policy tests is not evidence of in-game playback. heavy is a fictional neighborhood-scale tool and nova is a fictional city-scale tool; neither the gameplay nor these samples represent a real weapon or a nuclear recording.

The city primary has a 4.042-second full-duration body with audible-frequency content (source power-spectrum centroid approximately 1,014 Hz; 17.5% below 200 Hz). The 5.143-second supplemental distant sample is predominantly around 25 Hz and may be inaudible on small speakers. It is deliberately quiet and never used alone if the main sample fails. The primary body itself carries the audible tail. These numbers are objective analysis, not subjective listening approval.

## Runtime contract

- createAudio().play('ui-click' | 'blast' | 'wood-impact', volume), setMuted(boolean), and stop() remain compatible.
- resetEpoch(world.epoch) at initialization and any world reset/restore/map transition. It cancels scheduled and loading playback, clears epoch dedup and diagnostics, and rejects stale-epoch events.
- playWeaponEvent({ id, epoch, weapon, kind, stage?, position? }) accepts launch, place, detonate, split, and contact. IDs identify real events, not render frames. Each echo pulse and each split child needs its own ID. Dedup is epoch + ID + kind, intentionally not stage.
- Main integration owns the meaning of the events. A failed/declined launch must not emit a launch event. Phase currently routes its real events to contact. The detonate-to-pierce-collapse mapping is reserved for a future actual final-exhaustion event and is not currently called. Charge contact-to-grenade-bounce is likewise reserved and not currently called. A split parent can use split; detonate with stage='parent' also selects the release instead of a child blast.
- position is accepted for API compatibility, but this version does not claim positional spatialization.
- First pointer/key gesture primes and resumes Web Audio. All samples are decoded once and cached. Failed file loads are contained, never an unhandled playback rejection.
- Audio uses real AudioContext time, not simulation delta. Simulation pause and natural round settlement must not call stop(): a real started tail is allowed to finish. Mute, hidden document, explicit stop, epoch reset, and disposal do cancel every pending or active voice. Returning from the background never replays old events.
- getDiagnostics() is a frozen snapshot with epoch, contextState, activeVoices (ID/event/sample/group/gain/loading-or-scheduled-or-playing), accepted/dropped keys, playedEventIds, playedEventKeys, playedSampleIds, and failures. Played means playback was started/scheduled and reached its start time, not a claim that a person heard it. Diagnostic histories are bounded; event dedup lasts through the epoch.

## Voice and peak budgets

At most six voices are reserved, scheduled or playing in total. Group limits are main=3, pulse=3, tail=2, launch=2, detail=1, UI=1. Higher-priority main events can evict lower-priority sounds; low-priority contact/UI cannot steal a main body or its tail. Equal priority does not blindly replace the oldest. A projectile's own launch instance ends when its actual detonation arrives. Contact events are throttled to at most one per 80 ms. Concurrent pulse/child voices share inverse-square-root group gain.

Every shipped PCM16 WAV is at or below -18.10 dBFS sample peak. Per-voice gain never exceeds 1; the master is 0.85. Even the conservative six-fully-coherent-waveform sample-sum upper bound is about -3.95 dBFS. This is a headroom calculation, not a device-volume, hearing-safety, or true-peak guarantee. Individual source/preview gains are already baked in and must not be applied again.

## Verified and not verified

Automated tests check selection, eight distinct identities, event dedup, new epochs, priority eviction, six-voice and group limits, child attenuation, lifecycle cancellation while decoding, independent body/tail completion, missing-tail resilience, readonly diagnostics, all 23 exact file hashes, and all PCM sample peaks. No browser is needed for these tests; transport tests use a small device-boundary double, not simulated gameplay events. Policy unit tests do not establish that every supported candidate event is emitted by the main program.

No subjective listening has been performed. User-device playback, headphone/small-speaker/low-volume A/B, acoustic comfort, and a captured real-game true-peak mix remain release acceptance checks. Do not label this sound mix "listened to", "comfortable", or "hearing safe" based on the automated checks.

## Original publishers

- Kenney Sci-fi Sounds: https://kenney.nl/assets/sci-fi-sounds
- Kenney Impact Sounds: https://kenney.nl/assets/impact-sounds
- rubberduck, 50 CC0 Sci-Fi SFX: https://opengameart.org/content/50-cc0-sci-fi-sfx
- EZduzziteh, Explosions: https://opengameart.org/content/explosions-4
- NenadSimic, Muffled Distant Explosion: https://opengameart.org/content/muffled-distant-explosion
- Dustyroom, Free Casual Game Sounds: https://dustyroom.com/free-casual-game-sounds/
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
