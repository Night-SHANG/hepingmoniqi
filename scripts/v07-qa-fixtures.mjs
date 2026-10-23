// Synthetic legacy saves used only before browser page load. They deliberately
// seed research and must never be represented as an organic game playthrough.
export function createSchema5Fixture(createWorld) {
  const world = createWorld();
  const target = world.getSnapshot().voxels.find(v => v.group === 'house').position;
  world.damage({ id: 'labelled-fixture-damage', epoch: world.epoch, weapon: 'charge', power: .5, target });
  const save = world.getSnapshot(); save.schemaVersion = 5; save.research = 420;
  save.round = { budget: 6, used: 2, startResearch: 90, startDestroyed: 0, settled: false,
    loadout: { charge: 2, pulse: 1, shock: 1 }, remaining: { charge: 0, pulse: 1, shock: 1 } };
  return save;
}
export function createOverLimitSchema6Fixture(createWorld) {
  const save = createSchema5Fixture(createWorld); save.schemaVersion = 6; save.research = 620;
  save.round = { budget: 10, used: 1, startResearch: 620, startDestroyed: 0, settled: false,
    loadout: { charge: 1, pulse: 1, shock: 1, echo: 1, split: 0 },
    remaining: { charge: 0, pulse: 1, shock: 1, echo: 1, split: 0 } };
  return save;
}
