// QA ONLY: explicitly synthetic schema-7 save, installed before browser load.
// The 1400 research is fixture data, never organic gameplay or production boost.
export function createSchema7Fixture(createWorld) {
  const world = createWorld();
  const target = world.getSnapshot().voxels.find(v => v.group === 'house').position;
  world.damage({ id: 'labelled-v08-schema7-fixture-damage', epoch: world.epoch, weapon: 'charge', power: .5, target });
  const save = world.getSnapshot();
  save.schemaVersion = 7; save.research = 1400;
  save.round = { budget: 10, used: 1, startResearch: 1400, startDestroyed: 0, settled: false,
    loadout: { charge: 2, pulse: 0, shock: 0, echo: 1, split: 0, phase: 1 },
    remaining: { charge: 1, pulse: 0, shock: 0, echo: 1, split: 0, phase: 1 } };
  return save;
}
