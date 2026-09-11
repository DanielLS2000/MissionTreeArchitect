'use client';
import { useState } from 'react';
import { Project, copyMission, missionsOf, seriesOf } from '../core/project';
import { Mutate } from './Canvas';
export default function Library({ project, mutate, importLibrary, select }: { project: Project; mutate: Mutate; importLibrary: () => void; select: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [treeFilter, setTreeFilter] = useState('');
  const [seriesFilter, setSeriesFilter] = useState('');
  return <aside className="library"><div className="panel-heading">Mission Library <span>{project.library.length}</span></div>
    <div className="library-tools"><button className="full" onClick={importLibrary}>＋ Importar árvore de referência</button><input aria-label="Pesquisar missões" placeholder="⌕  Buscar missão, país, tag…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Filtrar árvore" value={treeFilter} onChange={e => { setTreeFilter(e.target.value); setSeriesFilter(''); }}><option value="">Todas as árvores</option>{project.library.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select aria-label="Filtrar Series" value={seriesFilter} onChange={e => setSeriesFilter(e.target.value)}><option value="">Todas as Series</option>{project.library.filter(t => !treeFilter || t.id === treeFilter).flatMap(t => seriesOf(t).map(s => <option key={s.node.id} value={s.node.id}>{t.name} / {s.id}</option>))}</select>
      <label className="field">País base / limite Portuversalis<select value={project.baseTreeId} onChange={e => mutate(p => { p.baseTreeId = e.target.value; })}><option value="">Selecionar referência</option>{project.library.map(t => <option value={t.id} key={t.id}>{t.country || t.name} {t.tag} ({missionsOf(t).length})</option>)}</select></label>
    </div><div className="library-list">
      {!project.library.length && <div className="empty-note">Carregue arquivos .txt para construir seu pool de missões.<br /><br />Arrastar cria uma cópia independente com referência à origem.</div>}
      {project.library.filter(t => !treeFilter || t.id === treeFilter).map(tree => {
        const all = missionsOf(tree);
        const filtered = all.filter(m => (!seriesFilter || m.seriesUid === seriesFilter) && `${m.id} ${tree.name} ${tree.country} ${tree.tag}`.toLowerCase().includes(query.toLowerCase()));
        return <details key={tree.id} open className="library-tree"><summary>⚜ {tree.country || tree.name}<small>{tree.tag || 'Tag não definida'} · {all.length} missões · {seriesOf(tree).length} Series</small><small>Branches: não inferidas; blocos raw preservados</small></summary>
          <div className="tree-metadata"><input aria-label={`País ${tree.name}`} placeholder="País" value={tree.country} onChange={e => mutate(p => { p.library.find(t => t.id === tree.id)!.country = e.target.value; })} /><input aria-label={`Tag ${tree.name}`} placeholder="TAG" value={tree.tag} onChange={e => mutate(p => { p.library.find(t => t.id === tree.id)!.tag = e.target.value; })} /></div>
          {filtered.map(m => <div className="pool-mission" key={m.uid} draggable onDragStart={e => e.dataTransfer.setData('application/eu4-mission', JSON.stringify({ treeId: tree.id, uid: m.uid }))}><span className="pool-icon">⚑</span><div><strong>{m.id}</strong><small>{m.series} · {m.slot}:{m.position}</small></div><button title="Copiar para a primeira Series (alternativa ao arraste)" onClick={() => mutate(p => select(copyMission(p, tree.id, m.uid, seriesOf(p.tree)[0]?.node.id ?? '')))}>＋</button></div>)}
          {!filtered.length && <p className="empty-note">Nenhuma missão encontrada.</p>}
        </details>;
      })}
    </div><div className="library-footer">LOCAL WORKSPACE <span>◆</span></div>
  </aside>;
}
