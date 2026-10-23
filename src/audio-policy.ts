/** Pure event selection and admission policy. All audio is existing CC0 PCM samples. */
export type AudioWeaponId = 'charge' | 'pulse' | 'shock' | 'echo' | 'split' | 'phase' | 'heavy' | 'nova';
export type AudioEventKind = 'launch' | 'place' | 'detonate' | 'split' | 'contact';
export type LegacyAudioName = 'ui-click' | 'blast' | 'wood-impact';
export interface WeaponAudioEvent {
 id: string;
 epoch: number;
 weapon: AudioWeaponId;
 kind: AudioEventKind;
 stage?: string | number;
 position?: { x: number; y: number; z: number };
}
export type AudioGroup = 'main' | 'pulse' | 'tail' | 'launch' | 'detail' | 'ui';
export interface AudioCue {
 sample: string;
 group: AudioGroup;
 priority: number;
 gain: number;
 delaySeconds: number;
}
export interface AudioVoice extends AudioCue {
 voiceId: number;
 eventId: string;
 eventKey: string;
 kind: AudioEventKind | 'legacy';
 weapon?: AudioWeaponId;
 epoch: number;
 admittedAt: number;
 baseGain: number;
}
export interface AudioAdmission {
 voices: readonly Readonly<AudioVoice>[];
 stoppedVoiceIds: number[];
 reason?: 'duplicate' | 'stale-epoch' | 'silent' | 'muted' | 'background' | 'budget' | 'throttled' | 'invalid';
}
export const MAX_AUDIO_VOICES = 6;
export const AUDIO_MASTER_GAIN = 0.85;
const GROUP_LIMIT: Record<AudioGroup, number> = { main: 3, pulse: 3, tail: 2, launch: 2, detail: 1, ui: 1 };
const cue = (sample: string, group: AudioGroup, priority: number, gain: number, delaySeconds = 0): AudioCue => ({ sample, group, priority, gain, delaySeconds });

/** Main identity is always the first cue; secondary layers never replace it. */
export function selectWeaponCues(event: WeaponAudioEvent): AudioCue[] {
 if (event.kind === 'detonate') {
  switch (event.weapon) {
   case 'charge': return [cue('grenade-blast', 'main', 80, 0.85)];
   case 'pulse': return [cue('rocket-blast', 'main', 80, 0.85)];
   case 'shock': return [cue('remote-blast', 'main', 80, 0.8), cue('remote-trigger', 'ui', 15, 0.16)];
   case 'echo': return [cue('echo-pulse', 'pulse', 75, 0.62)];
   case 'split': return event.stage === 'parent' ? [cue('split-release', 'launch', 40, 0.45)] : [cue('split-burst-short', 'pulse', 70, 0.5)];
   case 'phase': return [cue('pierce-collapse', 'main', 75, 0.7)];
   case 'heavy': return [cue('split-burst-long', 'main', 90, 0.9)];
   case 'nova': return [cue('city-explosion-body', 'main', 100, 0.85), cue('city-distant-low', 'tail', 95, 0.32, 0.35)];
  }
 }
 if (event.kind === 'launch' || event.kind === 'place') {
  const samples: Record<AudioWeaponId, string> = {
   charge: 'grenade-release', pulse: 'rocket-launch', shock: 'remote-arm', echo: 'echo-prime',
   split: 'split-release', phase: 'pierce-launch', heavy: 'cosmic-transition', nova: 'cosmic-engine-bed',
  };
  return samples[event.weapon] ? [cue(samples[event.weapon], 'launch', 40, event.weapon === 'nova' ? 0.28 : 0.45)] : [];
 }
 if (event.kind === 'split' && event.weapon === 'split') return [cue('split-release', 'launch', 40, 0.45)];
 if (event.kind === 'contact') {
  if (event.weapon === 'charge') return [cue('grenade-bounce', 'detail', 20, 0.32)];
  if (event.weapon === 'phase') return [cue('pierce-contact', 'detail', 30, 0.45)];
 }
 return [];
}

export function createAudioPolicy(initialEpoch = 0) {
 let epoch = initialEpoch;
 let muted = false;
 let backgrounded = false;
 let sequence = 0;
 let lastDetailAt = -Infinity;
 const active = new Map<number, AudioVoice>();
 const seen = new Set<string>();
 const accepted: string[] = [];
 const dropped: string[] = [];
 const history = (list: string[], value: string) => { list.push(value); if (list.length > 256) list.shift(); };
 const freezeVoice = (voice: AudioVoice) => Object.freeze({ ...voice });
 function rebalance() {
  const counts = new Map<AudioGroup, number>();
  for (const voice of active.values()) counts.set(voice.group, (counts.get(voice.group) ?? 0) + 1);
  for (const voice of active.values()) {
   // Simultaneous pulse/child voices share a group budget, not three full-volume blasts.
   voice.gain = voice.baseGain / (voice.group === 'pulse' ? Math.sqrt(counts.get(voice.group) ?? 1) : 1);
  }
 }
 function finish(voiceId: number) { active.delete(voiceId); rebalance(); }
 function stop() { active.clear(); lastDetailAt = -Infinity; }
 function admit(cues: AudioCue[], event: Omit<AudioVoice, keyof AudioCue | 'voiceId' | 'admittedAt' | 'baseGain'>, now: number): AudioAdmission {
  const stoppedVoiceIds: number[] = [];
  const admitted: number[] = [];
  if (muted) return { voices: [], stoppedVoiceIds, reason: 'muted' };
  if (backgrounded) return { voices: [], stoppedVoiceIds, reason: 'background' };
  if (!cues.length) return { voices: [], stoppedVoiceIds, reason: 'silent' };
  if (cues.every(sound => sound.group === 'detail') && now - lastDetailAt < 0.08) return { voices: [], stoppedVoiceIds, reason: 'throttled' };
  // Stop only this projectile's own launch/flight when it actually detonates.
  if (event.kind === 'detonate') for (const voice of active.values()) {
   if (voice.eventId === event.eventId && voice.group === 'launch') { active.delete(voice.voiceId); stoppedVoiceIds.push(voice.voiceId); }
  }
  for (const sound of cues) {
   const group = [...active.values()].filter(voice => voice.group === sound.group);
   const needsGroupSlot = group.length >= GROUP_LIMIT[sound.group];
   if (needsGroupSlot || active.size >= MAX_AUDIO_VOICES) {
    const candidates = (needsGroupSlot ? group : [...active.values()])
     .filter(voice => voice.priority < sound.priority)
     .sort((a, b) => a.priority - b.priority || a.admittedAt - b.admittedAt || a.voiceId - b.voiceId);
    if (!candidates.length) continue;
    active.delete(candidates[0].voiceId); stoppedVoiceIds.push(candidates[0].voiceId);
   }
   const voiceId = ++sequence;
   active.set(voiceId, { ...event, ...sound, voiceId, admittedAt: now, baseGain: sound.gain });
   admitted.push(voiceId);
   if (sound.group === 'detail') lastDetailAt = now;
  }
  rebalance();
  const voices = admitted.flatMap(id => { const voice = active.get(id); return voice ? [freezeVoice(voice)] : []; });
  if (voices.length) history(accepted, event.eventKey); else history(dropped, event.eventKey);
  return { voices, stoppedVoiceIds, ...(voices.length ? {} : { reason: 'budget' as const }) };
 }
 function accept(event: WeaponAudioEvent, now = 0): AudioAdmission {
  if (!event.id || !Number.isFinite(event.epoch) || !Number.isFinite(now)) return { voices: [], stoppedVoiceIds: [], reason: 'invalid' };
  if (event.epoch !== epoch) return { voices: [], stoppedVoiceIds: [], reason: 'stale-epoch' };
  const eventKey = JSON.stringify([event.epoch, event.id, event.kind]);
  if (seen.has(eventKey)) return { voices: [], stoppedVoiceIds: [], reason: 'duplicate' };
  // Remember suppressed events too: unmuting/background return must not replay them.
  seen.add(eventKey);
  return admit(selectWeaponCues(event), { eventId: event.id, eventKey, epoch, kind: event.kind, weapon: event.weapon }, now);
 }
 function legacy(name: LegacyAudioName, volume = 1, now = 0): AudioAdmission {
  if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(now)) return { voices: [], stoppedVoiceIds: [], reason: 'silent' };
  const gain = Math.min(volume, 1);
  const sound = name === 'blast' ? cue('blast', 'main', 80, gain * 0.85)
   : name === 'wood-impact' ? cue('wood-impact', 'detail', 10, gain * 0.4) : cue('ui-click', 'ui', 5, gain * 0.5);
  const id = `legacy-${++sequence}`;
  return admit([sound], { eventId: id, eventKey: id, epoch, kind: 'legacy' }, now);
 }
 function resetEpoch(value: number) {
  if (!Number.isFinite(value)) return;
  stop(); epoch = value; seen.clear(); accepted.length = 0; dropped.length = 0;
 }
 function getDiagnostics() {
  return Object.freeze({ epoch, muted, backgrounded, maxVoices: MAX_AUDIO_VOICES,
   activeVoices: Object.freeze([...active.values()].map(freezeVoice)),
   acceptedEventKeys: Object.freeze([...accepted]), droppedEventKeys: Object.freeze([...dropped]),
  });
 }
 return { accept, legacy, finish, stop, resetEpoch, getDiagnostics,
  setMuted(value: boolean) { muted = value; if (value) stop(); },
  setBackgrounded(value: boolean) { backgrounded = value; if (value) stop(); },
 };
}
