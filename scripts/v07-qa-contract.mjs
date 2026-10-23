import assert from 'node:assert/strict';

export const WEAPON_IDS = ['charge', 'pulse', 'shock', 'echo', 'split', 'phase'];
export const MAP_IDS = ['courtyard', 'warehouse', 'bridge', 'tower', 'cantilever'];
export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE_LANDSCAPE = { width: 844, height: 390 };
export const MOBILE_PORTRAIT = { width: 390, height: 844 };
export const OPERATION_CONTROLS = ['[data-delivery="quick"]', '[data-delivery="place"]', '[data-trigger="automatic"]', '[data-trigger="remote"]', '#power', '#fire', '#detonate'];

export function overlaps(a, b, tolerance = 1) {
  return a.right > b.left + tolerance && b.right > a.left + tolerance && a.bottom > b.top + tolerance && b.bottom > a.top + tolerance;
}

export function assertInsideViewport(r, viewport, label, margin = 0) {
  assert.ok(r.width > 0 && r.height > 0, `${label}: empty rectangle`);
  assert.ok(r.left >= margin - .5 && r.top >= margin - .5 && r.right <= viewport.width - margin + .5 && r.bottom <= viewport.height - margin + .5,
    `${label}: outside viewport ${JSON.stringify({ r, viewport, margin })}`);
}

export function assertVerticalStack(rects, label) {
  assert.ok(rects.length > 1, `${label}: need multiple cards`);
  const first = rects[0];
  for (const [i, r] of rects.entries()) {
    assert.ok(r.width > 0 && r.height >= 44, `${label}[${i}]: invisible or too short`);
    assert.ok(Math.abs(r.left - first.left) < 2 && Math.abs(r.width - first.width) < 2,
      `${label}: columns/grid replaced vertical list at ${i}`);
    if (i) assert.ok(r.top >= rects[i - 1].bottom - .5, `${label}: overlapping or horizontally arranged card ${i}`);
  }
}

export function assertStationary(before, after, label, tolerance = 1) {
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(before[key] - after[key]) <= tolerance, `${label}: ${key} moved from ${before[key]} to ${after[key]}`);
  }
}

export function assertSideComposition({ viewport, left, right, scenes, loadout }) {
  assertInsideViewport(left, viewport, 'left scene panel');
  assertInsideViewport(right, viewport, 'right loadout panel');
  assert.ok(left.left < viewport.width * .08, 'scene cards must remain on the left');
  assert.ok(right.right > viewport.width * .92, 'loadout must remain on the right');
  assert.ok(left.width < viewport.width * .35 && right.width < viewport.width * .38, 'panels consume the live preview');
  assert.ok(right.left - left.right >= viewport.width * .18, 'center live-preview corridor is too narrow');
  assertVerticalStack(scenes, 'scene cards');
  assertVerticalStack(loadout, 'loadout rows');
}
