import test from 'node:test';
import assert from 'node:assert/strict';
import { children, field, parse, semantic, serialize, setField } from '../src/core/clausewitz';
import { addMission, copyMission, deleteMission, exportLocalization, importTree, loadProject, missionsOf, moveMission, newProject, renameMission, seriesOf } from '../src/core/project';
import { validate } from '../src/core/validate';
import { decodeDds } from '../src/lib/icons';
// Synthetic fixture, not the unavailable French mission file or a certification of EU4 branch behavior.
const source = `# synthetic regression tree
@threshold = 10
campaign = {
 slot = 1
 generic = no
 potential = { tag = TST }
 unknown_series = { values = { one two "three # literal" } }
 first_mission = {
  icon = mission_unknown
  position = 1
  trigger = { army_size = 100 prestige >= 50 custom = { foo = yes foo = no } }
  effect = { add_country_modifier = { name = test_modifier duration = -1 } }
  unknown = { nested = { x != 1 y ?= "a\\\"b" } }
 }
 second_mission = {
  icon = mission_unknown position = 2
  required_missions = { first_mission }
  trigger = { always = yes }
  effect = { custom_effect = yes }
 }
}
`;
const project = () => { const p = newProject('Test'); p.tree = importTree(source, 'Test'); return p; };
test('parse/serialize/reimport preserves ordered unknown nodes, duplicates, strings and operators', () => {
  const ast = parse(source); const exported = serialize(ast);
  assert.equal(semantic(parse(exported)), semantic(ast));
  assert.ok(exported.includes('# synthetic regression tree'));
  assert.ok(exported.includes('three # literal'));
  assert.equal(missionsOf(importTree(exported, 'Again')).length, 2);
});
test('Import -> Parse -> Edit -> Export -> Reimport preserves unrelated structure', () => {
  const p = project(), before = missionsOf(p.tree)[0];
  const unknown = semantic(children(field(children(before.node), 'unknown')));
  renameMission(p, before.uid, 'renamed');
  setField(children(before.node), 'position', '3');
  const next = importTree(serialize(p.tree.ast), 'Reimport');
  const all = missionsOf(next);
  assert.equal(all[0].id, 'renamed'); assert.equal(all[0].position, 3);
  assert.deepEqual(all[1].required, ['renamed']);
  assert.equal(semantic(children(field(children(all[0].node), 'unknown'))), unknown);
});
test('parser rejects malformed input with line and column', () => {
  for (const bad of ['x = {', 'x =', 'x = "unterminated', '}', 'a = { b = }']) assert.throws(() => parse(bad), /linha .*coluna/);
  assert.doesNotThrow(() => parse('\uFEFF# bom\nx = { }'));
});
test('comments between key, operator and value survive', () => {
  const ast = parse('x # key\n= # op\n { y = yes } # tail');
  assert.equal(semantic(parse(serialize(ast))), semantic(ast));
  assert.ok(serialize(ast).includes('# op'));
});
test('library copying never mutates the source and retains counterpart', () => {
  const p = newProject(); const tree = importTree(source, 'Reference'); p.library.push(tree);
  const snapshot = JSON.stringify(tree); const original = missionsOf(tree)[0];
  const copied = copyMission(p, tree.id, original.uid, seriesOf(p.tree)[0].node.id);
  renameMission(p, copied, 'independent');
  assert.equal(JSON.stringify(p.library[0]), snapshot);
  assert.deepEqual(p.origins[copied], { treeId: tree.id, missionId: original.id });
});
test('project file keeps IDs, branch metadata, localization and AST', () => {
  const p = project(); const m = missionsOf(p.tree)[0];
  p.localization[m.id] = { title: 'Title "quoted"', description: 'First\nSecond' };
  p.branches.push({ id: 'father', name: 'Father', type: 'father', fatherId: '', trigger: 'always = yes', missions: [m.uid] });
  renameMission(p, m.uid, m.id);
  assert.equal(p.localization[m.id].title, 'Title "quoted"');
  const result = loadProject(JSON.stringify(p));
  assert.equal(semantic(result.tree.ast), semantic(p.tree.ast));
  assert.deepEqual(result.branches, p.branches); assert.equal(missionsOf(result.tree)[0].uid, m.uid);
  const localization = exportLocalization(result);
  assert.ok(localization.startsWith('\uFEFFl_english:')); assert.ok(localization.includes('\\"quoted\\"')); assert.ok(localization.includes('First\\nSecond'));
});
test('invalid project versions and duplicate AST UIDs are rejected', () => {
  assert.throws(() => loadProject('{"format":"eu4proj","version":9}'));
  const p = project(); p.tree.ast.push(p.tree.ast[0]);
  assert.throws(() => loadProject(JSON.stringify(p)), /duplicado/);
});
test('move and delete synchronize model references', () => {
  const p = project(); const all = missionsOf(p.tree);
  moveMission(p, all[0].uid, all[0].seriesUid, 4); assert.equal(missionsOf(p.tree)[0].position, 4);
  assert.throws(() => moveMission(p, all[0].uid, all[0].seriesUid, 0));
  deleteMission(p, all[0].uid); assert.deepEqual(missionsOf(p.tree)[0].required, []);
});
test('cycle and missing prerequisite diagnostics block export', () => {
  const p = project(); const all = missionsOf(p.tree);
  setField(children(all[0].node), 'required_missions', parse('second_mission missing_mission'));
  const diagnostics = validate(p);
  assert.ok(diagnostics.some(d => d.code === 'CYCLE' && d.severity === 'ERROR'));
  assert.ok(diagnostics.some(d => d.code === 'MISSING_REQUIRED'));
});
test('Portuversalis enforces counterpart, limit, troop floor and modifiers', () => {
  const p = newProject(); const tree = importTree(source, 'Base'); p.library.push(tree); p.baseTreeId = tree.id; p.portuversalis = true;
  const id = copyMission(p, tree.id, missionsOf(tree)[0].uid, seriesOf(p.tree)[0].node.id);
  const m = missionsOf(p.tree)[0]; const trigger = children(field(children(m.node), 'trigger'));
  setField(trigger, 'army_size', '70');
  assert.ok(!validate(p).some(d => d.code === 'TROOP_REDUCTION'));
  setField(trigger, 'army_size', '69');
  assert.ok(validate(p).some(d => d.code === 'TROOP_REDUCTION' && d.missionUid === id));
  setField(children(m.node), 'effect', []);
  assert.ok(validate(p).some(d => d.code === 'MODIFIERS'));
  addMission(p, seriesOf(p.tree)[0].node.id); addMission(p, seriesOf(p.tree)[0].node.id);
  assert.ok(validate(p).some(d => d.code === 'MISSION_LIMIT'));
  assert.ok(validate(p).some(d => d.code === 'COUNTERPART'));
  p.portuversalis = false; assert.ok(!validate(p).some(d => d.code === 'MODIFIERS'));
});
test('unsupported trigger changes and branch compilation are never reported valid', () => {
  const p = newProject(); const tree = importTree(source, 'Base'); p.library.push(tree); p.baseTreeId = tree.id; p.portuversalis = true;
  copyMission(p, tree.id, missionsOf(tree)[0].uid, seriesOf(p.tree)[0].node.id);
  setField(children(missionsOf(p.tree)[0].node), 'trigger', parse('custom_script = yes'));
  p.branches.push({ id: 'son', name: 'Son', type: 'son', fatherId: '', trigger: '', missions: [] });
  const diagnostics = validate(p);
  assert.ok(diagnostics.some(d => d.code === 'TRIGGER_UNKNOWN' && d.severity === 'WARNING'));
  assert.ok(diagnostics.some(d => d.code === 'BRANCH_UNKNOWN'));
  assert.ok(diagnostics.some(d => d.code === 'BRANCH_FATHER'));
});
test('DDS DXT1 decodes a red block without changing any GFX key', () => {
  const buffer = new ArrayBuffer(136); const view = new DataView(buffer);
  view.setUint32(0, 0x20534444, true); view.setUint32(4, 124, true);
  view.setUint32(12, 4, true); view.setUint32(16, 4, true);
  new Uint8Array(buffer, 84, 4).set([68, 88, 84, 49]);
  view.setUint16(128, 0xf800, true);
  const decoded = decodeDds(buffer);
  assert.equal(decoded.width, 4); assert.equal(decoded.height, 4);
  assert.deepEqual(Array.from(decoded.pixels.slice(0, 4)), [255, 0, 0, 255]);
  assert.throws(() => decodeDds(new ArrayBuffer(10)), /truncado/);
});
