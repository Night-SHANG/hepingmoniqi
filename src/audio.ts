import { AUDIO_MASTER_GAIN, createAudioPolicy, type AudioAdmission, type LegacyAudioName, type WeaponAudioEvent } from './audio-policy.js';
export type { WeaponAudioEvent } from './audio-policy.js';

/** Sample playback only. No oscillator, resynthesis, pitch shifting or simulation-time audio clock. */
export function createAudio() {
 const policy = createAudioPolicy();
 const doc = typeof document === 'undefined' ? undefined : document;
 const buffers = new Map<string, Promise<AudioBuffer>>();
 const playing = new Map<number, { source: AudioBufferSourceNode; gain: GainNode; startAt: number }>();
 const played: { voiceId: number; eventId: string; eventKey: string; sample: string; startAt: number; started: boolean }[] = [];
 const failures: string[] = [];
 let context: AudioContext | undefined;
 let master: GainNode | undefined;
 let revision = 0;
 let disposed = false;
 const samples = ['ui-click', 'blast', 'wood-impact', 'grenade-release', 'grenade-bounce', 'grenade-blast',
  'rocket-launch', 'rocket-blast', 'remote-arm', 'remote-trigger', 'remote-blast', 'echo-prime', 'echo-pulse',
  'split-release', 'split-burst-short', 'split-burst-long', 'pierce-launch', 'pierce-contact', 'pierce-collapse',
  'city-explosion-body', 'city-distant-low', 'cosmic-engine-bed', 'cosmic-transition'];
 const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;
 const fail = (message: string) => { failures.push(message); if (failures.length > 32) failures.shift(); };
 function ensureContext() {
  if (disposed) return;
  if (context) return context;
  const Constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return;
  try {
   context = new Constructor({ latencyHint: 'interactive' });
   master = context.createGain(); master.gain.value = AUDIO_MASTER_GAIN; master.connect(context.destination);
   return context;
  } catch { fail('audio-context-unavailable'); return; }
 }
 function load(sample: string, ctx: AudioContext) {
  const cached = buffers.get(sample);
  if (cached) return cached;
  const promise = fetch(`${import.meta.env?.BASE_URL ?? './'}audio/${sample}.wav`)
   .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); })
   .then(bytes => ctx.decodeAudioData(bytes));
  buffers.set(sample, promise);
  void promise.catch(() => { buffers.delete(sample); });
  return promise;
 }
 function updateStarted() {
  if (context?.state !== 'running') return;
  for (const record of played) if (playing.has(record.voiceId) && record.startAt <= context.currentTime) record.started = true;
 }
 function removeVoice(voiceId: number, halt = false) {
  updateStarted();
  const instance = playing.get(voiceId);
  playing.delete(voiceId);
  if (instance) {
   instance.source.onended = null;
   if (halt) { try { instance.source.stop(); } catch { /* Already ended. */ } }
   instance.source.disconnect(); instance.gain.disconnect();
  }
  policy.finish(voiceId);
 }
 function rebalance() {
  if (!context) return;
  for (const voice of policy.getDiagnostics().activeVoices) {
   const gain = playing.get(voice.voiceId)?.gain.gain;
   if (gain) gain.setTargetAtTime(voice.gain, context.currentTime, 0.015);
  }
 }
 function stop() {
  revision++;
  for (const id of [...playing.keys()]) removeVoice(id, true);
  policy.stop();
 }
 function synchronizeVisibility() {
  const hidden = doc?.hidden ?? false;
  if (hidden) stop();
  policy.setBackgrounded(hidden);
 }
 function unlock() {
  if (disposed || doc?.hidden || policy.getDiagnostics().muted) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => fail('audio-unlock-blocked'));
  for (const sample of samples) void load(sample, ctx).catch(() => fail(`sample-load:${sample}`));
 }
 function dispatch(admission: AudioAdmission) {
  for (const id of admission.stoppedVoiceIds) removeVoice(id, true);
  rebalance();
  if (!admission.voices.length) return false;
  const ctx = ensureContext();
  if (!ctx || !master) { for (const voice of admission.voices) policy.finish(voice.voiceId); return false; }
  const requestRevision = revision;
  // Buffers are preloaded on user gesture. One batch start aligns all layers of an event.
  const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  void Promise.all([resume, ...admission.voices.map(voice => load(voice.sample, ctx).catch(() => {
   if (!disposed && requestRevision === revision) fail(`sample-load:${voice.sample}`);
   return null;
  }))]).then(results => {
   if (disposed || requestRevision !== revision) return;
   if (ctx.state !== 'running' || doc?.hidden || policy.getDiagnostics().muted) {
    for (const voice of admission.voices) policy.finish(voice.voiceId);
    return;
   }
   // Never leave only the 25 Hz auxiliary city layer if the main body failed.
   if (!results[1]) { for (const voice of admission.voices) policy.finish(voice.voiceId); rebalance(); return; }
   const batchStart = ctx.currentTime;
   for (let i = 0; i < admission.voices.length; i++) {
    const request = admission.voices[i];
    if (!results[i + 1]) { policy.finish(request.voiceId); continue; }
    const voice = policy.getDiagnostics().activeVoices.find(active => active.voiceId === request.voiceId);
    if (!voice) continue; // Evicted, reset or stopped while the file was decoding.
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = results[i + 1] as AudioBuffer;
    gain.gain.value = voice.gain;
    source.connect(gain); gain.connect(master!);
    const startAt = batchStart + voice.delaySeconds;
    playing.set(voice.voiceId, { source, gain, startAt });
    source.onended = () => { removeVoice(voice.voiceId); rebalance(); };
    try {
     source.start(startAt);
     played.push({ voiceId: voice.voiceId, eventId: voice.eventId, eventKey: voice.eventKey, sample: voice.sample, startAt, started: voice.delaySeconds === 0 });
     if (played.length > 256) played.shift();
    } catch { removeVoice(voice.voiceId, true); fail(`sample-start:${voice.sample}`); }
   }
  }).catch(() => {
   if (disposed || requestRevision !== revision) return;
   for (const voice of admission.voices) { removeVoice(voice.voiceId, true); fail(`sample-play:${voice.sample}`); }
   rebalance();
  });
  return true;
 }
 function play(name: LegacyAudioName, volume = 1) {
  if (disposed) return false;
  synchronizeVisibility();
  return dispatch(policy.legacy(name, volume, now()));
 }
 function playWeaponEvent(event: WeaponAudioEvent) {
  if (disposed) return false;
  synchronizeVisibility();
  return dispatch(policy.accept(event, now()));
 }
 function resetEpoch(epoch: number) {
  if (!Number.isFinite(epoch)) return;
  stop(); policy.resetEpoch(epoch); played.length = 0; failures.length = 0;
 }
 function setMuted(value: boolean) {
  if (value) stop();
  policy.setMuted(value);
 }
 function getDiagnostics() {
  updateStarted();
  const snapshot = policy.getDiagnostics();
  const started = played.filter(record => record.started);
  return Object.freeze({ ...snapshot, contextState: context?.state ?? 'unavailable',
   activeVoices: Object.freeze(snapshot.activeVoices.map(voice => {
    const instance = playing.get(voice.voiceId);
    return Object.freeze({ ...voice, state: !instance ? 'loading' : instance.startAt > (context?.currentTime ?? 0) ? 'scheduled' : 'playing' });
   })),
   playedEventIds: Object.freeze([...new Set(started.map(record => record.eventId))]),
   playedEventKeys: Object.freeze([...new Set(started.map(record => record.eventKey))]),
   playedSampleIds: Object.freeze(started.map(record => record.sample)),
   failures: Object.freeze([...failures]),
  });
 }
 function dispose() {
  if (disposed) return;
  stop(); disposed = true;
  doc?.removeEventListener('visibilitychange', synchronizeVisibility);
  doc?.removeEventListener('pointerdown', unlock, true);
  doc?.removeEventListener('keydown', unlock, true);
  if (context) void context.close().catch(() => {});
  buffers.clear();
 }
 doc?.addEventListener('visibilitychange', synchronizeVisibility);
 doc?.addEventListener('pointerdown', unlock, true);
 doc?.addEventListener('keydown', unlock, true);
 synchronizeVisibility();
 return { play, playWeaponEvent, setMuted, stop, resetEpoch, getDiagnostics, dispose };
}
