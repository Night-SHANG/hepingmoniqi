import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAudioPolicy, selectWeaponCues, type AudioWeaponId, type WeaponAudioEvent } from './audio-policy.js';

const event = (id: string, weapon: AudioWeaponId = 'charge', kind: WeaponAudioEvent['kind'] = 'detonate', epoch = 1): WeaponAudioEvent => ({ id, epoch, weapon, kind });

test('all eight tools have different primary detonation samples, not retuned copies of the generic blast', () => {
 const weapons: AudioWeaponId[] = ['charge', 'pulse', 'shock', 'echo', 'split', 'phase', 'heavy', 'nova'];
 const primary = weapons.map(weapon => selectWeaponCues(event('shot', weapon))[0]?.sample);
 assert.equal(primary.length, 8);
 assert.equal(new Set(primary).size, 8);
 assert.ok(primary.every(Boolean));
 assert.equal(primary[0], 'grenade-blast');
 assert.equal(primary[1], 'rocket-blast');
 assert.equal(primary[6], 'split-burst-long');
 assert.equal(primary[7], 'city-explosion-body');
 const manifest = JSON.parse(readFileSync(new URL('../public/audio/SOURCES.json', import.meta.url), 'utf8'));
 const sourceHashes = primary.map(sample => manifest.assets.find((asset: { file: string }) => asset.file === `${sample}.wav`).inputSha256);
 assert.equal(new Set(sourceHashes).size, 8, 'Renaming the same source must not masquerade as eight identities');
});

test('city event keeps an audible body and a quieter delayed supplemental tail without a simulation timer', () => {
 const cues = selectWeaponCues(event('city', 'nova'));
 assert.equal(cues.length, 2);
 assert.equal(cues[0].sample, 'city-explosion-body');
 assert.equal(cues[0].delaySeconds, 0);
 assert.equal(cues[1].sample, 'city-distant-low');
 assert.ok(cues[1].delaySeconds > 0 && cues[1].gain < cues[0].gain);
});

test('events use their own semantics; split parent does not manufacture a child blast, phase contact is not a generic blast', () => {
 assert.equal(selectWeaponCues(event('launch', 'pulse', 'launch'))[0].sample, 'rocket-launch');
 assert.equal(selectWeaponCues(event('place', 'shock', 'place'))[0].sample, 'remote-arm');
 assert.equal(selectWeaponCues(event('split', 'split', 'split'))[0].sample, 'split-release');
 assert.equal(selectWeaponCues({ ...event('parent', 'split'), stage: 'parent' })[0].sample, 'split-release');
 assert.equal(selectWeaponCues(event('touch', 'phase', 'contact'))[0].sample, 'pierce-contact');
 assert.deepEqual(selectWeaponCues(event('touch', 'nova', 'contact')), []);
});

test('id plus kind dedup survives playback end, while distinct pulse IDs and a new epoch remain playable', () => {
 const policy = createAudioPolicy(1);
 const launch = policy.accept(event('one', 'charge', 'launch'), 0);
 assert.equal(launch.voices.length, 1);
 assert.equal(policy.accept(event('one', 'charge', 'launch'), 1).reason, 'duplicate');
 const blast = policy.accept(event('one'), 2);
 assert.equal(blast.voices.length, 1);
 assert.deepEqual(blast.stoppedVoiceIds, [launch.voices[0].voiceId]);
 policy.finish(blast.voices[0].voiceId);
 assert.equal(policy.accept(event('one'), 3).reason, 'duplicate');
 assert.equal(policy.accept(event('pulse-1', 'echo'), 4).voices.length, 1);
 assert.equal(policy.accept(event('pulse-2', 'echo'), 4.5).voices.length, 1);
 policy.resetEpoch(2);
 assert.equal(policy.accept(event('one'), 5).reason, 'stale-epoch');
 assert.equal(policy.accept(event('one', 'charge', 'detonate', 2), 6).voices.length, 1);
});

test('low priority contacts and UI cannot steal a city main body or its tail at the global six-voice ceiling', () => {
 const policy = createAudioPolicy(1);
 const city = policy.accept(event('city', 'nova'), 0).voices;
 policy.accept(event('heavy', 'heavy'), 0);
 policy.accept(event('main'), 0);
 policy.accept(event('echo-1', 'echo'), 0);
 policy.accept(event('echo-2', 'echo'), 0);
 assert.equal(policy.getDiagnostics().activeVoices.length, 6);
 assert.equal(policy.accept(event('touch', 'phase', 'contact'), 1).voices.length, 0);
 assert.equal(policy.legacy('ui-click', 1, 1).voices.length, 0);
 const active = policy.getDiagnostics().activeVoices.map(voice => voice.voiceId);
 assert.ok(city.every(voice => active.includes(voice.voiceId)));
});

test('new main events displace a low priority voice, not the oldest protected tail', () => {
 const policy = createAudioPolicy(1);
 const city = policy.accept(event('city', 'nova'), 0).voices;
 const ui = policy.legacy('ui-click', 1, 1).voices[0];
 policy.accept(event('launch-1', 'pulse', 'launch'), 2);
 policy.accept(event('launch-2', 'echo', 'launch'), 3);
 policy.accept(event('detail', 'phase', 'contact'), 4);
 const heavy = policy.accept(event('heavy', 'heavy'), 5);
 assert.equal(heavy.voices.length, 1);
 assert.deepEqual(heavy.stoppedVoiceIds, [ui.voiceId]);
 assert.equal(policy.getDiagnostics().activeVoices.length, 6);
 assert.ok(city.every(voice => policy.getDiagnostics().activeVoices.some(active => active.voiceId === voice.voiceId)));
});

test('group budget bounds simultaneous split children and attenuates their shared pulse group', () => {
 const policy = createAudioPolicy(1);
 for (let i = 0; i < 3; i++) assert.equal(policy.accept(event(`child-${i}`, 'split'), 0).voices.length, 1);
 assert.equal(policy.accept(event('child-4', 'split'), 0).voices.length, 0);
 const voices = policy.getDiagnostics().activeVoices;
 assert.equal(voices.length, 3);
 assert.ok(voices.every(voice => voice.gain < 0.5));
 assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= 0.9);
 policy.finish(voices[0].voiceId);
 assert.equal(policy.accept(event('child-5', 'split'), 1).voices.length, 1);
});

test('contact throttling, muted/background events, and reset never queue old sounds for later', () => {
 const policy = createAudioPolicy(1);
 assert.equal(policy.accept(event('contact-1', 'phase', 'contact'), 0).voices.length, 1);
 assert.equal(policy.accept(event('contact-2', 'phase', 'contact'), 0.01).voices.length, 0);
 policy.setMuted(true);
 assert.equal(policy.getDiagnostics().activeVoices.length, 0);
 assert.equal(policy.accept(event('muted'), 1).voices.length, 0);
 policy.setMuted(false);
 assert.equal(policy.accept(event('muted'), 2).reason, 'duplicate');
 policy.setBackgrounded(true);
 assert.equal(policy.accept(event('hidden'), 3).voices.length, 0);
 policy.setBackgrounded(false);
 assert.equal(policy.accept(event('hidden'), 4).reason, 'duplicate');
 policy.accept(event('pending', 'nova'), 5);
 policy.resetEpoch(2);
 assert.equal(policy.getDiagnostics().activeVoices.length, 0);
 assert.equal(policy.getDiagnostics().acceptedEventKeys.length, 0);
});

test('diagnostics are detached and readonly; invalid volume is silent rather than exceeding the safe gain', () => {
 const policy = createAudioPolicy(1);
 const accepted = policy.accept(event('one'), 0).voices[0];
 const snapshot = policy.getDiagnostics();
 assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.activeVoices) && Object.isFrozen(snapshot.activeVoices[0]));
 assert.equal(policy.legacy('wood-impact', NaN, 1).voices.length, 0);
 assert.equal(policy.legacy('wood-impact', Infinity, 1).voices.length, 0);
 const wood = policy.legacy('wood-impact', 20, 1).voices[0];
 assert.ok(wood.gain > 0 && wood.gain <= 1);
 policy.stop();
 assert.equal(snapshot.activeVoices[0].voiceId, accepted.voiceId);
 assert.equal(snapshot.activeVoices.length, 1);
 assert.equal(policy.getDiagnostics().activeVoices.length, 0);
});

test('every shipped PCM sample matches its provenance and remains at or below -18 dBFS sample peak', () => {
 const manifest = JSON.parse(readFileSync(new URL('../public/audio/SOURCES.json', import.meta.url), 'utf8'));
 assert.ok(manifest.assets.length >= 20);
 for (const asset of manifest.assets) {
  const file = readFileSync(new URL(`../public/audio/${asset.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256, asset.file);
  assert.equal(asset.license, 'CC0-1.0', asset.file);
  assert.ok(asset.inputSha256.length === 64, asset.file);
  let peak = 0;
  for (let offset = 12; offset + 8 <= file.length;) {
   const name = file.toString('ascii', offset, offset + 4); const length = file.readUInt32LE(offset + 4);
   if (name === 'data') for (let n = offset + 8; n < offset + 8 + length; n += 2) peak = Math.max(peak, Math.abs(file.readInt16LE(n)) / 32768);
   offset += 8 + length + (length % 2);
  }
  assert.ok(peak > 0 && 20 * Math.log10(peak) <= -18, `${asset.file}: ${20 * Math.log10(peak)} dBFS`);
 }
});

test('runtime can be created without browser globals and exposes silent read-only diagnostics', async () => {
 const { createAudio } = await import('./audio.js');
 const audio = createAudio();
 audio.resetEpoch(1);
 audio.playWeaponEvent(event('headless'));
 assert.equal(audio.getDiagnostics().activeVoices.length, 0);
 assert.equal(audio.getDiagnostics().contextState, 'unavailable');
 audio.stop();
 audio.dispose();
});

// These small doubles stand in only for the browser/device boundary; selection,
// lifecycle, async cancellation, diagnostics and mixing code remain the real implementation.
async function withAudioDevice(run: (fixture: { doc: EventTarget & { hidden: boolean }; contexts: any[]; requests: { url: string; resolve: (response: any) => void; reject: (reason?: any) => void }[] }) => Promise<void>) {
 const prior = new Map(['document', 'AudioContext', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
 const doc = Object.assign(new EventTarget(), { hidden: false });
 const contexts: any[] = [];
 const requests: { url: string; resolve: (response: any) => void; reject: (reason?: any) => void }[] = [];
 class DeviceContext {
  state = 'running'; currentTime = 0; destination = {}; sources: any[] = [];
  constructor() { contexts.push(this); }
  createGain() { return { gain: { value: 1, setTargetAtTime(value: number) { this.value = value; } }, connect() {}, disconnect() {} }; }
  createBufferSource() {
   const source = { buffer: null, onended: null as null | (() => void), stopped: false, started: false, startAt: 0,
    connect() {}, disconnect() {}, start(at: number) { this.startAt = at; this.started = true; }, stop() { this.stopped = true; },
   };
   this.sources.push(source); return source;
  }
  async decodeAudioData() { return { duration: 4 }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
 }
 Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
 Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: DeviceContext });
 Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (url: string) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) });
 try { await run({ doc, contexts, requests }); } finally {
  for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
 }
}
const decodedResponse = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
const drain = () => new Promise<void>(resolve => setImmediate(resolve));

test('mute cancels both loading event layers so late decoding cannot resurrect a sound', async () => withAudioDevice(async ({ contexts, requests }) => {
 const { createAudio } = await import('./audio.js'); const audio = createAudio(); audio.resetEpoch(1);
 try {
  audio.playWeaponEvent(event('city', 'nova'));
  assert.equal(audio.getDiagnostics().activeVoices.length, 2);
  audio.setMuted(true);
  for (const request of requests) request.resolve(decodedResponse);
  await drain();
  assert.equal(audio.getDiagnostics().activeVoices.length, 0);
  assert.deepEqual(audio.getDiagnostics().playedEventIds, []);
  assert.equal(contexts[0].sources.length, 0);
 } finally { audio.dispose(); }
}));

test('played city body naturally ends separately from the tail; backgrounding stops the remaining tail', async () => withAudioDevice(async ({ doc, contexts, requests }) => {
 const { createAudio } = await import('./audio.js'); const audio = createAudio(); audio.resetEpoch(1);
 try {
  audio.playWeaponEvent(event('city', 'nova'));
  for (const request of requests) request.resolve(decodedResponse);
  await drain();
  assert.deepEqual(audio.getDiagnostics().playedSampleIds, ['city-explosion-body']);
  assert.equal(audio.getDiagnostics().activeVoices[1].state, 'scheduled');
  contexts[0].currentTime = 0.5;
  assert.deepEqual(audio.getDiagnostics().playedSampleIds, ['city-explosion-body', 'city-distant-low']);
  contexts[0].sources[0].onended();
  assert.equal(audio.getDiagnostics().activeVoices.length, 1);
  assert.equal(audio.getDiagnostics().activeVoices[0].sample, 'city-distant-low');
  assert.equal(contexts[0].sources[1].stopped, false);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.getDiagnostics().activeVoices.length, 0);
  assert.equal(contexts[0].sources[1].stopped, true);
 } finally { audio.dispose(); }
}));

test('reset cancels late load failures as well as audio, keeping the new epoch diagnostics clean', async () => withAudioDevice(async ({ requests }) => {
 const { createAudio } = await import('./audio.js'); const audio = createAudio(); audio.resetEpoch(1);
 try {
  audio.playWeaponEvent(event('old'));
  audio.resetEpoch(2);
  requests[0].reject(new Error('late old-epoch network failure'));
  await drain();
  assert.equal(audio.getDiagnostics().epoch, 2);
  assert.deepEqual(audio.getDiagnostics().failures, []);
  assert.deepEqual(audio.getDiagnostics().playedEventIds, []);
 } finally { audio.dispose(); }
}));

test('missing auxiliary city tail does not silence the main body or create an unhandled rejection', async () => withAudioDevice(async ({ requests }) => {
 const { createAudio } = await import('./audio.js'); const audio = createAudio(); audio.resetEpoch(1);
 try {
  audio.playWeaponEvent(event('city', 'nova'));
  requests.find(request => request.url.endsWith('city-explosion-body.wav'))!.resolve(decodedResponse);
  requests.find(request => request.url.endsWith('city-distant-low.wav'))!.reject(new Error('missing optional tail'));
  await drain();
  assert.deepEqual(audio.getDiagnostics().playedSampleIds, ['city-explosion-body']);
  assert.equal(audio.getDiagnostics().activeVoices.length, 1);
  assert.ok(audio.getDiagnostics().failures.includes('sample-load:city-distant-low'));
 } finally { audio.dispose(); }
}));
