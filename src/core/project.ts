import { Ast, AstNode, children, cloneAst, field, parse, property, scalar, serialize, setField, text, uid, quote } from './clausewitz';

export interface MissionTree { id: string; name: string; country: string; tag: string; ast: Ast }
export interface Branch { id: string; name: string; type: 'father' | 'son' | 'generic'; fatherId: string; trigger: string; missions: string[] }
export interface Origin { treeId: string; missionId: string }
export interface Localization { title: string; description: string }
export interface Project {
  format: 'eu4proj'; version: 1; id: string; name: string; updatedAt: string;
  tree: MissionTree; library: MissionTree[]; branches: Branch[];
  origins: Record<string, Origin>; localization: Record<string, Localization>;
  icons: Record<string, { name: string; preview?: string; data?: string }>;
  portuversalis: boolean; baseTreeId: string; language: string;
}
export interface Series { node: AstNode; id: string; slot: number; missions: Mission[] }
export interface Mission { node: AstNode; uid: string; id: string; seriesUid: string; series: string; slot: number; position: number; icon: string; required: string[] }
const seriesFields = new Set(['slot', 'generic', 'ai', 'potential', 'potential_on_load', 'has_country_shield', 'priority']);
export function seriesOf(tree: MissionTree): Series[] {
  return tree.ast.filter(n => n.key && Array.isArray(n.value) && field(n.value, 'slot')).map(node => {
    const body = children(node);
    const slot = Number(scalar(body, 'slot', '1'));
    const id = text(node.key!);
    const missions = body.filter(n => n.key && Array.isArray(n.value) && !seriesFields.has(text(n.key)) && ['position', 'icon', 'trigger', 'effect', 'required_missions'].some(k => field(children(n), k))).map(n => {
      const block = children(n);
      return { node: n, uid: n.id, id: text(n.key!), seriesUid: node.id, series: id, slot,
        position: Number(scalar(block, 'position', '1')), icon: scalar(block, 'icon'),
        required: children(field(block, 'required_missions')).filter(x => !x.key && !x.comment && typeof x.value === 'string').map(x => text(x.value as string)) };
    });
    return { node, id, slot, missions };
  });
}
export const missionsOf = (tree: MissionTree) => seriesOf(tree).flatMap(s => s.missions);
export function importTree(source: string, name: string): MissionTree {
  return { id: uid(), name, country: '', tag: '', ast: parse(source) };
}
export function newProject(name = 'Nova campanha'): Project {
  return { format: 'eu4proj', version: 1, id: uid(), name, updatedAt: new Date().toISOString(),
    tree: { id: uid(), name, country: '', tag: '', ast: [property('custom_missions', [property('slot', '1'), property('generic', 'no'), property('potential', [])])] },
    library: [], branches: [], origins: {}, localization: {}, icons: {}, portuversalis: false, baseTreeId: '', language: 'english' };
}
export function addMission(project: Project, seriesUid: string, position?: number): string {
  const series = seriesOf(project.tree).find(s => s.node.id === seriesUid);
  if (!series) throw new Error('Crie uma Series antes de adicionar missões.');
  const ids = new Set(missionsOf(project.tree).map(m => m.id));
  let number = 1;
  while (ids.has(`new_mission_${number}`)) number++;
  const node = property(`new_mission_${number}`, [property('icon', 'mission_unknown'), property('position', String(position ?? Math.max(0, ...series.missions.map(m => m.position)) + 1)), property('required_missions', []), property('trigger', []), property('effect', [])]);
  children(series.node).push(node);
  return node.id;
}
export function renameMission(project: Project, nodeUid: string, id: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error('ID deve usar letras, números e underscore, sem espaços.');
  const missions = missionsOf(project.tree);
  const mission = missions.find(m => m.uid === nodeUid);
  if (!mission) return;
  if (missions.some(m => m.id === id && m.uid !== nodeUid)) throw new Error('Mission ID duplicado.');
  const old = mission.id;
  if (old === id) return;
  mission.node.key = id;
  missions.forEach(m => {
    children(field(children(m.node), 'required_missions')).forEach(n => {
      if (typeof n.value === 'string' && !n.key && !n.comment && text(n.value) === old) n.value = id;
    });
  });
  if (project.localization[old]) { project.localization[id] = project.localization[old]; delete project.localization[old]; }
}
export function moveMission(project: Project, missionUid: string, targetUid: string, row: number): void {
  const series = seriesOf(project.tree);
  const source = series.find(s => s.missions.some(m => m.uid === missionUid));
  const target = series.find(s => s.node.id === targetUid);
  const node = source?.missions.find(m => m.uid === missionUid)?.node;
  if (!source || !target || !node) return;
  if (!Number.isInteger(row) || row < 1) throw new Error('Posição deve ser um inteiro positivo.');
  if (source.node.id !== target.node.id) {
    source.node.value = children(source.node).filter(n => n.id !== missionUid);
    children(target.node).push(node);
  }
  setField(children(node), 'position', String(row));
}
export function deleteMission(project: Project, missionUid: string): void {
  const mission = missionsOf(project.tree).find(m => m.uid === missionUid);
  if (!mission) return;
  seriesOf(project.tree).forEach(s => { s.node.value = children(s.node).filter(n => n.id !== missionUid); });
  missionsOf(project.tree).forEach(m => {
    const required = field(children(m.node), 'required_missions');
    if (required) required.value = children(required).filter(n => !(typeof n.value === 'string' && !n.key && !n.comment && text(n.value) === mission.id));
  });
  delete project.origins[missionUid]; delete project.localization[mission.id];
  project.branches.forEach(b => { b.missions = b.missions.filter(id => id !== missionUid); });
}
export function copyMission(project: Project, treeId: string, missionUid: string, seriesUid: string, row?: number): string {
  const tree = project.library.find(t => t.id === treeId);
  const original = tree && missionsOf(tree).find(m => m.uid === missionUid);
  const target = seriesOf(project.tree).find(s => s.node.id === seriesUid);
  if (!original || !target) throw new Error('Missão ou Series não encontrada.');
  const copy = cloneAst([original.node])[0];
  const ids = new Set(missionsOf(project.tree).map(m => m.id));
  let id = original.id;
  for (let i = 2; ids.has(id); i++) id = `${original.id}_copy_${i}`;
  copy.key = id;
  setField(children(copy), 'position', String(row ?? Math.max(0, ...target.missions.map(m => m.position)) + 1));
  children(target.node).push(copy);
  project.origins[copy.id] = { treeId, missionId: original.id };
  return copy.id;
}
export function exportLocalization(project: Project): string {
  const escape = (s: string) => quote(s);
  return '\uFEFFl_' + project.language + ':\n' + Object.entries(project.localization).map(([id, loc]) => ` ${id}_title:0 ${escape(loc.title)}\n ${id}_desc:0 ${escape(loc.description)}`).join('\n') + '\n';
}
// Reparse persisted ASTs instead of trusting shape, depth, or object prototypes from uploaded JSON.
export function loadProject(source: string): Project {
  const data = JSON.parse(source);
  if (data?.format !== 'eu4proj' || data.version !== 1) throw new Error('Formato/versão de projeto incompatível.');
  const str = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
  const astIds = new Set<string>();
  const ast = (value: unknown, depth = 0): Ast => {
    if (!Array.isArray(value) || depth > 256) throw new Error('AST inválida.');
    return value.map((n: unknown): AstNode => {
      if (!n || typeof n !== 'object') throw new Error('Nó AST inválido.');
      const a = n as Record<string, unknown>;
      if (typeof a.id !== 'string' || astIds.has(a.id)) throw new Error('UID AST inválido ou duplicado.');
      astIds.add(a.id);
      if (typeof a.value !== 'string' && !Array.isArray(a.value)) throw new Error('Valor AST inválido.');
      return { id: a.id, key: typeof a.key === 'string' ? a.key : undefined, op: typeof a.op === 'string' ? a.op : undefined, comment: a.comment === true, value: typeof a.value === 'string' ? a.value : ast(a.value, depth + 1) };
    });
  };
  const tree = (t: unknown): MissionTree => {
    if (!t || typeof t !== 'object') throw new Error('Árvore inválida.');
    const v = t as Record<string, unknown>;
    const result = { id: str(v.id, uid()), name: str(v.name), country: str(v.country), tag: str(v.tag), ast: ast(v.ast) };
    parse(serialize(result.ast));
    return result;
  };
  const p = newProject(str(data.name));
  p.id = str(data.id, p.id); p.updatedAt = str(data.updatedAt, p.updatedAt); p.tree = tree(data.tree);
  p.library = Array.isArray(data.library) ? data.library.map(tree) : [];
  p.baseTreeId = str(data.baseTreeId); p.portuversalis = data.portuversalis === true;
  p.language = ['english', 'french', 'german', 'spanish'].includes(data.language) ? data.language : 'english';
  p.branches = Array.isArray(data.branches) ? data.branches.map((b: Partial<Branch>) => ({ id: str(b.id, uid()), name: str(b.name), type: b.type === 'father' || b.type === 'son' ? b.type : 'generic', fatherId: str(b.fatherId), trigger: str(b.trigger), missions: Array.isArray(b.missions) ? b.missions.filter((m: unknown) => typeof m === 'string') : [] })) : [];
  for (const [key, value] of Object.entries(data.origins ?? {})) {
    const v = value as Partial<Origin> | null;
    if (v && typeof v.treeId === 'string' && typeof v.missionId === 'string') Object.defineProperty(p.origins, key, { value: { treeId: v.treeId, missionId: v.missionId }, enumerable: true, writable: true, configurable: true });
  }
  for (const [key, value] of Object.entries(data.localization ?? {})) {
    const v = value as Partial<Localization> | null;
    if (v) Object.defineProperty(p.localization, key, { value: { title: str(v.title), description: str(v.description) }, enumerable: true, writable: true, configurable: true });
  }
  for (const [key, value] of Object.entries(data.icons ?? {})) {
    const v = value as { name?: string; preview?: string; data?: string } | null;
    if (v) Object.defineProperty(p.icons, key, { value: { name: str(v.name), preview: typeof v.preview === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v.preview) ? v.preview : undefined, data: typeof v.data === 'string' && v.data.startsWith('data:') ? v.data : undefined }, enumerable: true, writable: true, configurable: true });
  }
  return p;
}
