'use client';
import { useEffect, useState } from 'react';
import { Ast, children, parse, scalar, serialize, setField, text, uid } from '../core/clausewitz';
import { Project, deleteMission, missionsOf, moveMission, renameMission, seriesOf } from '../core/project';
import { Mutate } from './Canvas';
import { dataUrl, iconPreview } from '../lib/icons';
export function EditField({ label, value, commit, multiline = false, id }: { label: string; value: string; commit: (s: string) => void; multiline?: boolean; id?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label className="field" id={id}>{label}{multiline ? <textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value) commit(draft); }} /> : <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value) commit(draft); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}</label>;
}
export function RawEditor({ value, apply, label = 'Clausewitz AST' }: { value: string; apply: (value: string) => void; label?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <div className="raw-editor"><label>{label}<textarea spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)} /></label><div className="raw-actions"><small>{draft !== value ? 'Rascunho não salvo: aplique antes de trocar de seleção.' : 'Sincronizado com a AST'}</small><button disabled={draft === value} onClick={() => apply(draft)}>Reparse & Apply</button><button disabled={draft === value} onClick={() => setDraft(value)}>Descartar</button></div></div>;
}
function preserveIds(old: Ast, next: Ast): Ast {
  const used = new Set<string>();
  return next.map(n => {
    const match = old.find(o => !used.has(o.id) && o.key === n.key && o.comment === n.comment && (n.key !== undefined || o.value === n.value));
    if (!match) return n;
    used.add(match.id);
    return { ...n, id: match.id, value: Array.isArray(n.value) ? preserveIds(children(match), n.value) : n.value };
  });
}
export { preserveIds };
export default function Inspector({ project, selected, mutate, report }: { project: Project; selected: string; mutate: Mutate; report: (s: string) => void }) {
  const [tab, setTab] = useState('mission');
  useEffect(() => {
    const focus = (event: Event) => {
      const property = (event as CustomEvent<string>).detail;
      setTab(['trigger', 'effect', 'raw'].includes(property) ? property : 'mission');
      setTimeout(() => document.getElementById(`property-${property}`)?.querySelector<HTMLElement>('input,select,textarea')?.focus(), 30);
    };
    window.addEventListener('eu4-focus-property', focus);
    return () => window.removeEventListener('eu4-focus-property', focus);
  }, []);
  const m = missionsOf(project.tree).find(m => m.uid === selected);
  const patch = (key: string, value: string | Ast) => mutate(p => {
    const mission = missionsOf(p.tree).find(n => n.uid === selected);
    if (mission) setField(children(mission.node), key, value);
  });
  if (!m) return <aside className="inspector"><div className="panel-heading">Mission Inspector</div><div className="inspector-empty"><span>♜</span><h3>Selecione uma missão</h3><p>Edite condições, recompensas, pré-requisitos e propriedades Clausewitz sem perder dados desconhecidos.</p></div></aside>;
  const block = children(m.node);
  const loc = project.localization[m.id] ?? { title: '', description: '' };
  return <aside className="inspector"><div className="panel-heading">Mission Inspector <span className="gold">◆</span></div><div className="inspector-title"><span className="mission-seal">⚜</span><div><h3>{loc.title || m.id}</h3><small>{m.series}</small></div></div>
    <nav className="tabs">{['mission', 'trigger', 'effect', 'raw'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
    <div className="inspector-body" key={`${m.uid}-${tab}`}>
      {tab === 'mission' ? <>
        <EditField id="property-id" label="Mission ID" value={m.id} commit={value => mutate(p => renameMission(p, selected, value))} />
        <EditField id="property-localization" label="Título / localization" value={loc.title} commit={title => mutate(p => { p.localization[m.id] = { ...loc, title }; })} />
        <EditField label="Descrição" value={loc.description} multiline commit={description => mutate(p => { p.localization[m.id] = { ...loc, description }; })} />
        <label className="field">Series<select value={m.seriesUid} onChange={e => mutate(p => moveMission(p, selected, e.target.value, m.position))}>{seriesOf(project.tree).map(s => <option key={s.node.id} value={s.node.id}>{s.id} · slot {s.slot}</option>)}</select></label>
        <EditField id="property-position" label="Posição / linha" value={String(m.position)} commit={value => mutate(p => moveMission(p, selected, m.seriesUid, Number(value)))} />
        <label className="field">Branch<select value={project.branches.find(b => b.missions.includes(selected))?.id ?? ''} onChange={e => mutate(p => { p.branches.forEach(b => { b.missions = b.missions.filter(id => id !== selected); if (b.id === e.target.value) b.missions.push(selected); }); })}><option value="">Sem branch</option>{project.branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.type}</option>)}</select></label>
        <EditField id="property-icon" label="GFX key / icon original" value={m.icon} commit={value => { if (!/^[A-Za-z0-9_]+$/.test(value)) report('GFX key inválida.'); else patch('icon', value); }} />
        <label className="file-button">Importar preview / DDS<input type="file" accept=".dds,.png,.jpg,.jpeg,.webp" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          if (!m.icon) { report('Defina uma GFX key primeiro.'); return; }
          if (file.size > 8 * 1024 * 1024) { report('Limite por ícone: 8 MB.'); return; }
          try {
            const data = await dataUrl(file); let preview: string | undefined;
            try { preview = await iconPreview(file); } catch (error) { report((error as Error).message); }
            mutate(p => { p.icons[m.icon] = { name: file.name, data, preview }; });
          } catch (error) { report((error as Error).message); }
        }} /></label>
        {project.icons[m.icon]?.preview && <img className="icon-preview" src={project.icons[m.icon].preview} alt={`Preview ${m.icon}`} />}
        <EditField id="property-required" label="Required missions (separadas por espaço)" value={m.required.join(' ')} commit={value => {
          const ids = value.trim().split(/\s+/).filter(Boolean);
          if (ids.some(id => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))) { report('Pré-requisito com ID inválido.'); return; }
          patch('required_missions', ids.map(value => ({ id: uid(), value })));
        }} />
        <label className="field" id="property-counterpart">Contraparte de referência<select value={project.origins[selected] ? JSON.stringify(project.origins[selected]) : ''} onChange={e => mutate(p => { if (e.target.value) p.origins[selected] = JSON.parse(e.target.value); else delete p.origins[selected]; })}><option value="">Nenhuma</option>{project.library.map(tree => <optgroup key={tree.id} label={tree.name}>{missionsOf(tree).map(mission => <option key={mission.uid} value={JSON.stringify({ treeId: tree.id, missionId: mission.id })}>{mission.id}</option>)}</optgroup>)}</select></label>
        <button className="danger full" onClick={() => { if (confirm(`Apagar ${m.id} e suas conexões?`)) mutate(p => deleteMission(p, selected)); }}>Apagar missão</button>
      </> : tab === 'raw' ? <RawEditor label="Bloco completo / propriedades avançadas" value={serialize([m.node])} apply={value => {
        try {
          const ast = parse(value), entries = ast.filter(n => !n.comment);
          if (entries.length !== 1 || !entries[0].key || !Array.isArray(entries[0].value)) throw new Error('Informe um único bloco de missão.');
          const replacement = entries[0];
          mutate(p => {
            renameMission(p, selected, text(replacement.key!));
            const current = missionsOf(p.tree).find(n => n.uid === selected);
            if (current) current.node.value = preserveIds(children(current.node), children(replacement));
          });
        } catch (error) { report((error as Error).message); }
      }} /> : <><p className="muted">{tab === 'effect' ? 'Effects e modifiers: edite os blocos originais. Nenhuma propriedade desconhecida é descartada.' : 'Condições Clausewitz. Escopos e scripted triggers são preservados.'}</p><RawEditor label={tab === 'trigger' ? 'trigger = { … } — conteúdo' : 'effect = { … } — conteúdo'} value={serialize(children(block.find(n => n.key === tab)))} apply={value => { try { patch(tab, parse(value)); } catch (error) { report((error as Error).message); } }} /></>}
      <small className="muted">Campos visuais salvam ao sair do campo. Raw exige Apply. {scalar(block, 'completed_by') && 'completed_by preservado na AST.'}</small>
    </div>
  </aside>;
}
