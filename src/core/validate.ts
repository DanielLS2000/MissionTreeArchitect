import { Ast, children, field, semantic, text, parse } from './clausewitz';
import { Mission, Project, missionsOf, seriesOf } from './project';
export interface Diagnostic { severity: 'ERROR' | 'WARNING' | 'INFO'; code: string; message: string; missionUid?: string; property?: string }
function ancestors(mission: Mission, all: Mission[]): Set<string> {
  const byId = new Map(all.map(m => [m.id, m]));
  const seen = new Set<string>();
  const stack = [...mission.required];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.required ?? []));
  }
  return seen;
}
const troopKeys = new Set(['army_size', 'navy_size', 'num_of_infantry', 'num_of_cavalry', 'num_of_artillery', 'num_of_heavy_ship', 'num_of_light_ship', 'num_of_galley', 'num_of_transport']);
function compareTriggers(actual: Ast, reference: Ast): 'same' | 'allowed' | 'changed' {
  let allowed = false;
  const clean = (nodes: Ast) => nodes.filter(n => !n.comment);
  const compare = (a: Ast, r: Ast): boolean => {
    const aa = clean(a), rr = clean(r);
    if (aa.length !== rr.length) return false;
    return rr.every((node, i) => {
      const other = aa[i];
      if (node.key !== other.key || node.op !== other.op) return false;
      if (Array.isArray(node.value)) {
        // Numeric relaxations inside NOT/OR, scopes or scripted triggers cannot be inferred safely.
        return Array.isArray(other.value) && semantic([node]) === semantic([other]);
      }
      if (Array.isArray(other.value)) return false;
      if (node.value === other.value) return true;
      const old = Number(node.value), current = Number(other.value);
      if (troopKeys.has(node.key ?? '') && ['=', '>='].includes(node.op ?? '=') && Number.isFinite(old) && old >= 0 && Number.isFinite(current) && current >= old * 0.7) { allowed = true; return true; }
      return false;
    });
  };
  return compare(actual, reference) ? allowed ? 'allowed' : 'same' : 'changed';
}
function modifiers(ast: Ast): Ast {
  const found: Ast = [];
  for (const n of ast) {
    if (n.key && /modifier/.test(text(n.key))) found.push(n);
    else if (Array.isArray(n.value)) {
      const nested = modifiers(n.value);
      // Keep enclosing scopes and conditions, but do not compare unrelated rewards
      // merely because they are siblings of an unchanged modifier in an effect block.
      if (nested.length) found.push({ ...n, value: [...n.value.filter(child => child.key && ['limit', 'chance', 'trigger'].includes(text(child.key))), ...nested] });
    }
  }
  return found;
}
export function validate(p: Project): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (severity: Diagnostic['severity'], code: string, message: string, m?: Mission, property?: string) => result.push({ severity, code, message, missionUid: m?.uid, property });
  const missions = missionsOf(p.tree);
  const ids = new Map<string, Mission>();
  const positions = new Map<string, Mission>();
  if (!missions.length) add('WARNING', 'EMPTY', 'Árvore sem missões reconhecidas. Blocos desconhecidos permanecem na AST.');
  const seriesIds = new Set<string>();
  for (const s of seriesOf(p.tree)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.id) || seriesIds.has(s.id)) add('ERROR', 'SERIES_ID', `Series inválida ou duplicada: ${s.id}`);
    seriesIds.add(s.id);
    if (!Number.isInteger(s.slot) || s.slot < 1 || s.slot > 5) add('ERROR', 'SLOT', `Series ${s.id}: slot deve estar entre 1 e 5.`);
  }
  for (const m of missions) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.id) || ids.has(m.id)) add('ERROR', 'ID', `ID inválido ou duplicado: ${m.id}`, m, 'id');
    ids.set(m.id, m);
    if (!Number.isInteger(m.position) || m.position < 1) add('ERROR', 'POSITION', 'Posição deve ser um inteiro positivo.', m, 'position');
    const key = `${m.slot}:${m.position}`;
    if (positions.has(key)) add('WARNING', 'OVERLAP', `Sobreposição com ${positions.get(key)!.id}; confira os potentials/branches.`, m, 'position');
    positions.set(key, m);
    if (!m.icon) add('WARNING', 'ICON', 'Missão sem GFX key.', m, 'icon');
    if (!Object.hasOwn(p.localization, m.id)) add('INFO', 'LOCALIZATION', 'Localization não está neste projeto; pode existir no mod.', m, 'localization');
    const keys = new Set<string>();
    for (const n of children(m.node)) {
      if (n.key && ['position', 'icon', 'trigger', 'effect', 'required_missions'].includes(text(n.key))) {
        if (keys.has(text(n.key))) add('ERROR', 'DUPLICATE_FIELD', `Propriedade visual duplicada: ${text(n.key)}. Resolva no Raw View.`, m, 'raw');
        keys.add(text(n.key));
      }
    }
    const required = field(children(m.node), 'required_missions');
    if (required && (!Array.isArray(required.value) || required.value.some(n => !n.comment && (n.key !== undefined || typeof n.value !== 'string')))) add('ERROR', 'REQUIRED_FORMAT', 'required_missions deve ser uma lista de IDs.', m, 'required');
  }
  for (const m of missions) {
    for (const required of m.required) if (!ids.has(required)) add('ERROR', 'MISSING_REQUIRED', `Pré-requisito não encontrado: ${required}`, m, 'required');
    if (ancestors(m, missions).has(m.id)) add('ERROR', 'CYCLE', 'Ciclo de pré-requisitos detectado.', m, 'required');
    if (new Set(m.required).size !== m.required.length) add('WARNING', 'DUPLICATE_LINK', 'Pré-requisito repetido.', m, 'required');
  }
  for (const branch of p.branches) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(branch.id) || p.branches.filter(b => b.id === branch.id).length > 1) add('ERROR', 'BRANCH_ID', `Branch ID inválido ou duplicado: ${branch.id}`);
    if (branch.type === 'son' && !p.branches.some(b => b.id === branch.fatherId && b.type === 'father')) add('ERROR', 'BRANCH_FATHER', `Branch ${branch.name} sem Father válido.`);
    try { parse(branch.trigger); } catch (e) { add('ERROR', 'BRANCH_TRIGGER', `${branch.name}: ${(e as Error).message}`); }
    if (branch.missions.some(id => !missions.some(m => m.uid === id))) add('ERROR', 'BRANCH_MEMBER', `Branch ${branch.name} contém missão inexistente.`);
  }
  if (p.branches.length) add('WARNING', 'BRANCH_UNKNOWN', 'UNKNOWN: Father/Son é metadata do editor. Configure a lógica EU4 nos blocos raw; a tradução automática de branches não está implementada.');
  if (!p.portuversalis) return result;
  const base = p.library.find(t => t.id === p.baseTreeId);
  if (!base) add('ERROR', 'BASE_TREE', 'Portuversalis: selecione uma árvore base na Library.');
  else {
    const limit = Math.min(50, missionsOf(base).length);
    if (missions.length > limit) add('ERROR', 'MISSION_LIMIT', `Limite Portuversalis: ${missions.length}/${limit} missões.`);
  }
  for (const m of missions) {
    const origin = p.origins[m.uid];
    const tree = origin && p.library.find(t => t.id === origin.treeId);
    const referenceMissions = tree ? missionsOf(tree) : [];
    const counterpart = referenceMissions.find(r => r.id === origin?.missionId);
    if (!counterpart) { add('ERROR', 'COUNTERPART', 'Missão sem contraparte válida na Library.', m, 'counterpart'); continue; }
    if (ancestors(m, missions).size < ancestors(counterpart, referenceMissions).size) add('ERROR', 'ANCESTORS', 'Menos pré-requisitos diretos/indiretos únicos que a contraparte.', m, 'required');
    if (ancestors(counterpart, referenceMissions).has(counterpart.id) || referenceMissions.some(r => r.required.some(id => !referenceMissions.some(x => x.id === id)))) add('WARNING', 'REFERENCE_UNKNOWN', 'UNKNOWN: referência possui ciclo ou pré-requisito externo; contagem de ancestrais pode estar incompleta.', m, 'counterpart');
    const actualBody = children(m.node), referenceBody = children(counterpart.node);
    const actualTrigger = field(actualBody, 'trigger'), referenceTrigger = field(referenceBody, 'trigger');
    if ((actualTrigger && !Array.isArray(actualTrigger.value)) || (referenceTrigger && !Array.isArray(referenceTrigger.value))) add('WARNING', 'TRIGGER_UNKNOWN', 'UNKNOWN: trigger não é um bloco.', m, 'trigger');
    else {
      const comparison = compareTriggers(children(actualTrigger), children(referenceTrigger));
      if (comparison === 'changed') add('WARNING', 'TRIGGER_UNKNOWN', 'UNKNOWN: triggers alterados. Revisar conquistas, estate, relações, construções e demais condições manualmente.', m, 'trigger');
      if (comparison === 'allowed') add('INFO', 'TROOPS', 'Requisitos diretos de tropas/navios respeitam o mínimo de 70%.', m, 'trigger');
      const invariantKeys = new Set(['prestige', 'stability', 'legitimacy', 'republican_tradition', 'devotion', 'meritocracy', 'absolutism', 'war_exhaustion', 'religious_unity', 'is_at_war', 'is_great_power', 'adm_tech', 'dip_tech', 'mil_tech']);
      for (const reference of children(referenceTrigger)) {
        if (!reference.key || !invariantKeys.has(reference.key)) continue;
        const actual = field(children(actualTrigger), reference.key);
        if (actual && semantic([actual]) !== semantic([reference])) add('ERROR', 'INVARIANT_TRIGGER', `${reference.key}: trigger deve permanecer igual à contraparte.`, m, 'trigger');
      }
      for (const reference of children(referenceTrigger)) {
        if (!reference.key || !troopKeys.has(reference.key) || typeof reference.value !== 'string' || !['=', '>='].includes(reference.op ?? '=')) continue;
        const actual = field(children(actualTrigger), reference.key);
        if (!actual) add('WARNING', 'TROOP_UNKNOWN', `UNKNOWN: ${reference.key} removido ou movido para outro escopo.`, m, 'trigger');
        if (actual && typeof actual.value === 'string' && Number.isFinite(Number(actual.value)) && Number(actual.value) < Number(reference.value) * 0.7) add('ERROR', 'TROOP_REDUCTION', `${reference.key}: redução acima de 30%.`, m, 'trigger');
      }
    }
    if (semantic(modifiers(actualBody)) !== semantic(modifiers(referenceBody))) add('ERROR', 'MODIFIERS', 'Modifiers diferem da contraparte.', m, 'effect');
    if (semantic(children(field(actualBody, 'effect'))) !== semantic(children(field(referenceBody, 'effect')))) add('WARNING', 'EFFECT_UNKNOWN', 'UNKNOWN: efeitos alterados. Claims, distâncias e realocação de development/buildings/autonomy exigem revisão e dados do mapa.', m, 'effect');
  }
  add('WARNING', 'PORTU_REVIEW', 'UNKNOWN: validação Portuversalis parcial. Scripted triggers/effects, geografia e permissões de realocação exigem revisão humana. Ausência de ERROR não certifica as regras completas.');
  return result;
}
