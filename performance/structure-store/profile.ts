// Isolated storage A/B. Runs each arm in a fresh Node process, never builds a Rapier world.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CompactStructures } from './compact-structures.ts';
import { sparseStructureFixture } from '../support-ab/sparse-structure-fixture.ts';

const snapshot = () => {
  const { heapUsed, arrayBuffers, external, rss } = process.memoryUsage();
  return { heapUsed, arrayBuffers, external, rss, processLifetimeMaxRss: process.resourceUsage().maxRSS * 1024 };
};
const gcSnapshot = () => { for (let i = 0; i < 3; i++) global.gc!(); return snapshot(); };
type Memory = ReturnType<typeof snapshot>;
const delta = (a: Memory, b: Memory) => ({ heapUsed: b.heapUsed - a.heapUsed, arrayBuffers: b.arrayBuffers - a.arrayBuffers,
  heapPlusArrayBuffers: b.heapUsed + b.arrayBuffers - a.heapUsed - a.arrayBuffers, external: b.external - a.external, rss: b.rss - a.rss });
const timed = <T>(fn: () => T) => { const start = performance.now(), value = fn(); return { value, ms: performance.now() - start }; };

function warmup() { const warm = sparseStructureFixture('lab'); const compact = new CompactStructures(warm.cells); assert.ok(compact.cell(warm.cells[0].id)); }

async function arm(kind: 'source' | 'compact') {
  if (!global.gc) throw new Error('Run with --expose-gc to establish source-released retained memory.');
  // Same bounded warmup in both fresh-process arms, then discard and collect.
  warmup();
  await nextTurn();
  const baseline = gcSnapshot();
  let source: ReturnType<typeof sparseStructureFixture> | null;
  const start = performance.now(); source = sparseStructureFixture('city');
  const generationMs = performance.now() - start, generationCheckpointBeforeGc = snapshot();
  const allocations = { ...source.allocations }, sourceRetainedAfterGc = gcSnapshot();
  assert.equal(source.cells.length, 53113);
  assert.equal(new Set(source.cells.filter(c => c.role === 'building').map(c => c.objectId)).size, 36);
  if (kind === 'source') {
    const firstId = source.cells[0].id, lastId = source.cells.at(-1)!.id;
    // Retain source until the final post-GC snapshot. Do not count generation Maps as retained.
    await nextTurn();
    const retainedAfterGc = gcSnapshot(); assert.equal(source.cells.length, 53113);
    return { kind, cellCount: 53113, firstId, lastId, allocations, generationMs,
      memory: { baseline, generationCheckpointBeforeGc, sourceRetainedAfterGc, retainedAfterGc, retainedDelta: delta(baseline, retainedAfterGc) },
      representativeSourceReleased: false, retainedSourceCells: 53113 };
  }
  // Weak refs can be checked only after an event-loop turn: within the creation job they are kept alive.
  const weakSource = [new WeakRef(source.cells), new WeakRef(source.cells[0]), new WeakRef(source.cells[26556]), new WeakRef(source.cells[53112])];
  const build = timed(() => new CompactStructures(source!.cells));
  const afterBuildBeforeSourceRelease = snapshot();
  source = null;
  await nextTurn();
  const retainedAfterGc = gcSnapshot();
  assert.ok(weakSource.every(ref => ref.deref() === undefined), 'The source array and sampled Cell objects must be collectible.');
  const pristine = build.value.diagnostics();
  assert.equal(pristine.typedBytes, 2496311); assert.equal(pristine.changedCells, 0);
  const edits = timed(() => {
    for (let i = 0; i < 2000; i++) {
      const id = build.value.idAtIndex((i * 7919) % build.value.cellCount)!;
      build.value.damage(id, 1 / 13);
      if (i % 40 === 0) build.value.promote(id, `piece-${i}`, { x: i / 4, y: 3.25, z: -i / 8 }, { x: 0, y: 0, z: 0, w: 1 }, 'dynamic');
    }
  });
  await nextTurn();
  const afterSparseEdits = gcSnapshot(), changed = build.value.diagnostics();
  assert.equal(changed.changedCells, 2000); assert.equal(changed.poseRecords, 50);
  const dirtyQuery = timed(() => build.value.dirtySince(0)); assert.equal(dirtyQuery.value.ids.length, 2000);
  // Keep store strongly reachable until all readings are complete.
  assert.equal(build.value.cell(build.value.idAtIndex(0)!)!.id, 2049339);
  return { kind, cellCount: 53113, allocations, generationMs, buildMs: build.ms, editMs: edits.ms,
    dirtyQueryMs: dirtyQuery.ms, representativeSourceReleased: true, retainedSourceCells: 0, pristine, changed,
    memory: { baseline, generationCheckpointBeforeGc, sourceRetainedAfterGc, afterBuildBeforeSourceRelease,
      retainedAfterGc, afterSparseEdits, retainedDelta: delta(baseline, retainedAfterGc), sparseEditsDelta: delta(retainedAfterGc, afterSparseEdits) } };
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'source' || mode === 'compact') { console.log(JSON.stringify(await arm(mode))); return; }
  const runs: (Awaited<ReturnType<typeof arm>> & { repeat: number })[] = [];
  for (let repeat = 0; repeat < 3; repeat++) for (const kind of ['source', 'compact']) {
    const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], kind], { encoding: 'utf8' });
    if (child.status !== 0) throw new Error(`${kind} failed (${child.status}): ${child.stderr}\n${child.stdout}`);
    runs.push({ repeat: repeat + 1, ...JSON.parse(child.stdout) });
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = (kind: string) => {
    const selected = runs.filter(run => run.kind === kind);
    return { retainedHeapBytes: median(selected.map(run => run.memory.retainedDelta.heapUsed)),
      retainedArrayBufferBytes: median(selected.map(run => run.memory.retainedDelta.arrayBuffers)),
      retainedHeapPlusArrayBufferBytes: median(selected.map(run => run.memory.retainedDelta.heapPlusArrayBuffers)),
      generationMs: median(selected.map(run => run.generationMs)),
      ...(kind === 'compact' ? { buildMs: median(selected.filter(run => run.kind === 'compact').map(run => run.buildMs)), sparseEditHeapBytes: median(selected.filter(run => run.kind === 'compact').map(run => run.memory.sparseEditsDelta.heapUsed)) } : {}) };
  };
  const source = summary('source'), compact = summary('compact');
  console.log(JSON.stringify({ scope: 'Full 53113-cell city aboveground storage only; 36 buildings; no ground Cell generation, physics, render, startup or FPS claim.',
    node: process.version, platform: process.platform, repeatsPerArm: 3,
    summary: { source, compact, retainedHeapPlusArrayBufferReductionFraction: 1 - compact.retainedHeapPlusArrayBufferBytes / source.retainedHeapPlusArrayBufferBytes },
    measurementNotes: [
      'Independent fresh Node processes per arm; equal bounded warmup; explicit GC. Source arm retains only fixture Cell specifications, not production mutable State/maps or cached views.',
      'Compact snapshots follow source release and three GCs after an event-loop turn. WeakRef verifies source array and first/middle/last Cells were collectible; code retains no Cell references.',
      'Exact compact typed payload is 2496311 bytes. heapUsed excludes typed backing stores; heapUsed + arrayBuffers avoids falsely comparing only JS heap. external overlaps arrayBuffers and is not added.',
      'generationCheckpointBeforeGc and afterBuildBeforeSourceRelease are temporary high-allocation checkpoints, NOT retained usage and NOT a measured exact heap peak.',
      'processLifetimeMaxRss is the OS process-lifetime RSS high-water mark at each checkpoint. It includes Node/tsx/warmup/native pages, not a generation-only peak. Synchronous internal allocation peaks can exceed endpoint heap samples.',
      'The helper still transiently allocates 53113 Cell specs, sorting references, per-column data and generator maps. This proof removes retained per-cell objects, not temporary generation peak.',
      '2000 edited cells retain sparse JS records; 50 have cloned poses. Map, string, typed-array header and allocator overhead are represented by noisy process deltas, not exact payload accounting.',
    ], runs }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
