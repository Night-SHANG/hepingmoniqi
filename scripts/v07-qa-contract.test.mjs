import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, assertInsideViewport, assertVerticalStack, assertStationary, assertSideComposition } from './v07-qa-contract.mjs';
const r = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const vertical = (left, width, count) => Array.from({ length: count }, (_, i) => r(left, 160 + i * 100, width, 90));

test('composition contract accepts original side panels and vertical cards', () => {
  assertSideComposition({ viewport: { width: 1440, height: 900 }, left: r(30, 110, 310, 750), right: r(1050, 110, 360, 750), scenes: vertical(50, 270, 4), loadout: vertical(1070, 320, 5) });
});
test('composition contract rejects a full-page grid replacing live preview', () => {
  assert.throws(() => assertSideComposition({ viewport: { width: 1440, height: 900 }, left: r(30, 110, 690, 750), right: r(740, 110, 670, 750), scenes: vertical(50, 270, 4), loadout: vertical(1070, 320, 5) }));
});
test('vertical contract rejects horizontal/grid cards', () => {
  assert.throws(() => assertVerticalStack([r(10, 20, 100, 90), r(120, 20, 100, 90)], 'grid'));
  assert.throws(() => assertVerticalStack([r(10, 20, 100, 90), r(10, 95, 100, 90)], 'overlap'));
});
test('fixed footer contract catches scroll-induced displacement', () => {
  assertStationary(r(20, 700, 300, 60), r(20, 700.4, 300, 60), 'footer');
  assert.throws(() => assertStationary(r(20, 700, 300, 60), r(20, 400, 300, 60), 'footer'));
});
test('mobile overlap checks distinguish separated/touching panels from covering panels', () => {
  assert.equal(overlaps(r(8, 90, 140, 250), r(160, 230, 220, 140)), false);
  assert.equal(overlaps(r(8, 90, 180, 250), r(160, 230, 220, 140)), true);
  assert.equal(overlaps(r(8, 90, 140, 250), r(148, 230, 220, 140)), false);
});
test('viewport contract catches clipped controls and honors safe margins', () => {
  assertInsideViewport(r(8, 8, 44, 44), { width: 390, height: 844 }, 'button', 8);
  assert.throws(() => assertInsideViewport(r(360, 20, 44, 44), { width: 390, height: 844 }, 'clipped'));
  assert.throws(() => assertInsideViewport(r(0, 0, 44, 44), { width: 390, height: 844 }, 'unsafe', 8));
});
