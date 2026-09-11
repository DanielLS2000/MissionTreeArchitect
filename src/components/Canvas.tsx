'use client';
import { useEffect, useRef, useState } from 'react';
import { Project, addMission, copyMission, missionsOf, moveMission, seriesOf } from '../core/project';
import { children, field, property, setField, uid } from '../core/clausewitz';
export type Mutate = (change: (draft: Project) => void) => void;
interface Props { project: Project; selected: string; select: (id: string) => void; mutate: Mutate; branch: string; link: boolean; zoom: number; report: (message: string) => void }
export default function Canvas({ project, selected, select, mutate, branch, link, zoom, report }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [linkStart, setLinkStart] = useState('');
  const missions = missionsOf(project.tree);
  const visible = missions.filter(m => !branch || project.branches.find(b => b.id === branch)?.missions.includes(m.uid));
  const byId = new Map(missions.map(m => [m.id, m]));
  const height = Math.max(870, ...missions.map(m => Number.isFinite(m.position) ? Math.min(10000, Math.max(1, m.position)) * 150 + 150 : 870));
  useEffect(() => { setLinkStart(''); }, [link]);
  useEffect(() => { if (selected) document.getElementById(`mission-${selected}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }, [selected]);
  const position = (x: number, y: number) => {
    const rect = scene.current!.getBoundingClientRect();
    return { column: Math.max(1, Math.min(5, Math.floor((x - rect.left) / (200 * zoom)) + 1)), row: Math.max(1, Math.round(((y - rect.top) / zoom - 75) / 150) + 1) };
  };
  const targetSeries = (p: Project, column: number) => {
    const existing = seriesOf(p.tree).find(s => s.slot === column);
    if (existing) return existing.node.id;
    const node = property(`series_${column}_${uid().slice(0, 8)}`, [property('slot', String(column)), property('generic', 'no'), property('potential', [])]);
    p.tree.ast.push(node); return node.id;
  };
  const pick = (id: string) => {
    select(id);
    if (!link) return;
    if (!linkStart) { setLinkStart(id); return; }
    if (linkStart === id) { setLinkStart(''); return; }
    mutate(p => {
      const all = missionsOf(p.tree), source = all.find(m => m.uid === linkStart), target = all.find(m => m.uid === id);
      if (!source || !target) return;
      const required = children(field(children(target.node), 'required_missions'));
      setField(children(target.node), 'required_missions', target.required.includes(source.id) ? required.filter(n => n.value !== source.id) : [...required, { id: uid(), value: source.id }]);
    });
    setLinkStart('');
  };
  return <div className="canvas-viewport" ref={viewport} aria-label="Canvas de missões" onPointerDown={event => {
    if ((event.target as HTMLElement).closest('button') && !event.altKey) return;
    if (event.button !== 0 && event.button !== 1) return;
    pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    if (!pan.current) return;
    event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
    event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
  }} onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
    <div style={{ width: 1000 * zoom, height: height * zoom }}><div className="canvas-scene" ref={scene} style={{ width: 1000, height, transform: `scale(${zoom})` }} onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/eu4-mission'));
        const { column, row } = position(e.clientX, e.clientY);
        mutate(p => {
          const series = targetSeries(p, column);
          if (data.treeId) select(copyMission(p, data.treeId, data.uid, series, row));
          else moveMission(p, data.uid, series, row);
        });
      } catch { report('Arraste uma missão do canvas ou da Library.'); }
    }} onDoubleClick={e => {
      if ((e.target as HTMLElement).closest('button')) return;
      const { column, row } = position(e.clientX, e.clientY);
      mutate(p => select(addMission(p, targetSeries(p, column), row)));
    }}>
      {[1, 2, 3, 4, 5].map(slot => <div className="column-heading" style={{ left: (slot - 1) * 200 }} key={slot}>SLOT {slot}<span>{seriesOf(project.tree).filter(s => s.slot === slot).map(s => s.id).join(' · ') || 'Empty series'}</span></div>)}
      <svg className="connections" width="1000" height={height} aria-hidden="true"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#bfa16b" /></marker></defs>
        {visible.flatMap(m => m.required.map((id, i) => {
          const parent = byId.get(id); if (!parent || !visible.some(v => v.uid === parent.uid)) return null;
          const x1 = (parent.slot - 1) * 200 + 100, y1 = (parent.position - 1) * 150 + 165;
          const x2 = (m.slot - 1) * 200 + 100, y2 = (m.position - 1) * 150 + 78;
          return <path key={`${m.uid}-${id}-${i}`} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} fill="none" stroke={selected === m.uid ? '#ead096' : '#856d49'} strokeWidth="2" markerEnd="url(#arrow)" />;
        }))}
      </svg>
      {visible.map(m => <button id={`mission-${m.uid}`} key={m.uid} className={`mission-card ${selected === m.uid ? 'selected' : ''} ${linkStart === m.uid ? 'link-start' : ''}`} style={{ left: (m.slot - 1) * 200 + 20, top: (m.position - 1) * 150 + 80 }} draggable onDragStart={e => e.dataTransfer.setData('application/eu4-mission', JSON.stringify({ uid: m.uid }))} onClick={() => pick(m.uid)} title={`${m.id} · ${m.series} · posição ${m.position}`}>
        <span className="mission-seal">{project.icons[m.icon]?.preview ? <img src={project.icons[m.icon].preview} alt="" /> : '⚜'}</span>
        <strong>{project.localization[m.id]?.title || m.id}</strong><small>{project.branches.find(b => b.missions.includes(m.uid))?.name || m.series}</small>
      </button>)}
      {!missions.length && <div className="canvas-empty"><span>⚜</span><h2>Uma campanha começa aqui</h2><p>Duplo clique para criar uma missão.<br />Arraste missões da Library para copiar.</p></div>}
    </div></div>
    {link && <div className="canvas-hint">{linkStart ? 'Selecione a missão dependente. Link existente será removido.' : 'Link Mode: selecione primeiro o pré-requisito.'}</div>}
  </div>;
}
