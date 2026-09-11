'use client';
import { children, parse, property, serialize, setField, uid } from '../core/clausewitz';
import { Project, seriesOf } from '../core/project';
import { Mutate } from './Canvas';
import { EditField, RawEditor, preserveIds } from './Inspector';
export default function Managers({ project, mutate, kind, close, report }: { project: Project; mutate: Mutate; kind: string; close: () => void; report: (s: string) => void }) {
  const attempt = (action: () => void) => { try { action(); } catch (error) { report((error as Error).message); } };
  return <div className="modal-backdrop" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-label={kind} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') close(); }}><header><h2>{kind === 'series' ? 'Series & slots' : kind === 'branches' ? 'Branch Architect' : 'Raw View · árvore completa'}</h2><button onClick={close} aria-label="Fechar">✕</button></header>
    {kind === 'series' ? <><p className="muted">Cada Series ocupa uma coluna. Potential controla quando aparece no jogo; país/tag da Library são apenas metadata.</p><button onClick={() => mutate(p => p.tree.ast.push(property(`series_${uid().slice(0, 8)}`, [property('slot', '1'), property('generic', 'no'), property('potential', [])])))}>＋ Criar Series</button>
      {seriesOf(project.tree).map(s => <div className="manager-card" key={s.node.id}><EditField label="Series ID" value={s.id} commit={value => mutate(p => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || seriesOf(p.tree).some(x => x.id === value && x.node.id !== s.node.id)) throw new Error('Series ID inválido ou duplicado.');
        seriesOf(p.tree).find(x => x.node.id === s.node.id)!.node.key = value;
      })} /><label className="field">Slot<select value={s.slot} onChange={e => mutate(p => setField(children(seriesOf(p.tree).find(x => x.node.id === s.node.id)!.node), 'slot', e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label><p>{s.missions.length} missões</p>
        <details><summary>Raw da Series / potential / propriedades avançadas</summary><RawEditor value={serialize([s.node])} apply={source => attempt(() => {
          const nodes = parse(source); if (nodes.filter(n => !n.comment).length !== 1) throw new Error('Informe uma única Series.');
          mutate(p => { const index = p.tree.ast.findIndex(n => n.id === s.node.id); const next = preserveIds([p.tree.ast[index]], nodes); next.find(n => !n.comment)!.id = s.node.id; p.tree.ast.splice(index, 1, ...next); });
        })} /></details>
        <button className="danger" disabled={s.missions.length > 0} title="Mova ou apague as missões antes de apagar a Series" onClick={() => { if (confirm('Apagar Series e suas propriedades raw?')) mutate(p => { p.tree.ast = p.tree.ast.filter(n => n.id !== s.node.id); }); }}>Apagar Series vazia</button>
      </div>)}
    </> : kind === 'branches' ? <><div className="notice">Father/Son organiza o editor e o .eu4proj. Lógica de seleção/visibilidade no EU4 deve ser configurada em Raw View. Triggers abaixo não são compilados automaticamente; exportação mostra UNKNOWN/WARNING.</div><button onClick={() => mutate(p => p.branches.push({ id: `branch_${uid().slice(0, 8)}`, name: 'Nova branch', type: 'generic', fatherId: '', trigger: '', missions: [] }))}>＋ Criar branch</button>
      {project.branches.map(b => <div className={`manager-card branch-${b.type}`} key={b.id}><EditField label="Branch ID" value={b.id} commit={value => mutate(p => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || p.branches.some(x => x.id === value && x.id !== b.id)) throw new Error('Branch ID inválido ou duplicado.');
        p.branches.forEach(x => { if (x.fatherId === b.id) x.fatherId = value; }); p.branches.find(x => x.id === b.id)!.id = value;
      })} /><EditField label="Nome" value={b.name} commit={value => mutate(p => { p.branches.find(x => x.id === b.id)!.name = value; })} /><label className="field">Tipo<select value={b.type} onChange={e => mutate(p => { const branch = p.branches.find(x => x.id === b.id)!; branch.type = e.target.value as typeof b.type; if (branch.type !== 'son') branch.fatherId = ''; })}><option value="generic">Generic</option><option value="father">Father</option><option value="son">Son</option></select></label>
        {b.type === 'son' && <label className="field">Father<select value={b.fatherId} onChange={e => mutate(p => { p.branches.find(x => x.id === b.id)!.fatherId = e.target.value; })}><option value="">Selecionar Father</option>{project.branches.filter(x => x.type === 'father' && x.id !== b.id).map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>}
        <RawEditor label="Trigger da branch (metadata)" value={b.trigger} apply={source => attempt(() => { parse(source); mutate(p => { p.branches.find(x => x.id === b.id)!.trigger = source; }); })} /><small>{b.missions.length} missões · associe pelo Mission Inspector</small><button className="danger" onClick={() => { if (confirm('Apagar branch? Missões serão mantidas.')) mutate(p => { p.branches = p.branches.filter(x => x.id !== b.id); p.branches.forEach(x => { if (x.fatherId === b.id) x.fatherId = ''; }); }); }}>Apagar branch</button>
      </div>)}
    </> : <><p className="muted">AST completa. Propriedades desconhecidas são preservadas; reparsing mantém UIDs dos blocos com a mesma chave. Revisar vínculos após renomear/remover missões aqui.</p><RawEditor value={serialize(project.tree.ast)} apply={source => attempt(() => { const next = parse(source); mutate(p => { p.tree.ast = preserveIds(p.tree.ast, next); }); })} /></>}
  </section></div>;
}
