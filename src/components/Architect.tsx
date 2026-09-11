'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { children, serialize, setField } from '../core/clausewitz';
import { Project, addMission, exportLocalization, importTree, loadProject, missionsOf, newProject, seriesOf } from '../core/project';
import { Diagnostic, validate } from '../core/validate';
import { download, readText, recentProjects, saveProject } from '../lib/storage';
import Canvas, { Mutate } from './Canvas';
import Inspector from './Inspector';
import Library from './Library';
import Managers from './Managers';
interface History { past: Project[]; present: Project | null; future: Project[] }
const emptyHistory = (): History => ({ past: [], present: null, future: [] });
export default function Architect() {
  const [history, setHistory] = useState<History>(emptyHistory);
  const historyRef = useRef(history);
  const [recents, setRecents] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState(0.85);
  const [link, setLink] = useState(false);
  const [branch, setBranch] = useState('');
  const [modal, setModal] = useState('');
  const [message, setMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState('Local workspace');
  const [showProblems, setShowProblems] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const mode = useRef<'project' | 'tree' | 'library'>('project');
  const dirty = useRef(false);
  const revision = useRef(0);
  const project = history.present;
  const replaceHistory = useCallback((next: History) => { historyRef.current = next; setHistory(next); }, []);
  const report = useCallback((s: string) => setMessage(s), []);
  const open = useCallback((p: Project) => {
    replaceHistory({ past: [], present: p, future: [] }); setSelected(''); setBranch(''); setModal(''); setMessage('');
    try { localStorage.setItem('eu4-last-project', p.id); } catch { /* IndexedDB remains the source of project data. */ }
  }, [replaceHistory]);
  const mutate: Mutate = useCallback(change => {
    const current = historyRef.current;
    if (!current.present) return;
    try {
      const draft = structuredClone(current.present);
      change(draft); draft.updatedAt = new Date().toISOString();
      dirty.current = true;
      replaceHistory({ past: [...current.past.slice(-39), current.present], present: draft, future: [] });
    } catch (e) { report(e instanceof Error ? e.message : 'Não foi possível aplicar a alteração.'); }
  }, [replaceHistory, report]);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.present || !h.past.length) return;
    dirty.current = true;
    replaceHistory({ past: h.past.slice(0, -1), present: { ...h.past.at(-1)!, updatedAt: new Date().toISOString() }, future: [h.present, ...h.future] });
  }, [replaceHistory]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.present || !h.future.length) return;
    dirty.current = true;
    replaceHistory({ past: [...h.past, h.present], present: { ...h.future[0], updatedAt: new Date().toISOString() }, future: h.future.slice(1) });
  }, [replaceHistory]);
  useEffect(() => {
    let mounted = true;
    recentProjects().then(projects => {
      if (!mounted) return;
      setRecents(projects);
      try {
        const last = localStorage.getItem('eu4-last-project');
        const previous = projects.find(p => p.id === last);
        if (previous) open(previous);
        const preference = Number(localStorage.getItem('eu4-zoom'));
        if (preference >= 0.4 && preference <= 1.5) setZoom(preference);
      } catch { /* Preferences are optional. */ }
    }).catch(e => { if (mounted) report(`Recuperação local indisponível: ${e.message}. Use Load Project ou salve backups .eu4proj.`); }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [open, report]);
  useEffect(() => {
    if (!project || !ready) return;
    const current = ++revision.current;
    dirty.current = true; setSaveStatus('Salvando…');
    // Each state is submitted immediately, not only when a debounce timer eventually runs.
    saveProject(project).then(() => {
      if (current !== revision.current) return;
      dirty.current = false; setSaveStatus('✓ Salvo neste navegador');
      setRecents(previous => [project, ...previous.filter(p => p.id !== project.id)]);
    }).catch(e => {
      if (current !== revision.current) return;
      setSaveStatus('⚠ Autosave falhou'); report(`Falha no IndexedDB: ${e.message}. Faça download de um .eu4proj.`);
    });
  }, [project, ready, report]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    const keyboard = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault(); const p = historyRef.current.present; if (p) download(`${p.name}.eu4proj`, JSON.stringify(p, null, 2), 'application/json');
      }
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('beforeunload', before); window.addEventListener('keydown', keyboard);
    return () => { window.removeEventListener('beforeunload', before); window.removeEventListener('keydown', keyboard); };
  }, [undo, redo]);
  const diagnostics = useMemo(() => project ? validate(project) : [], [project]);
  const errors = diagnostics.filter(d => d.severity === 'ERROR');
  const warnings = diagnostics.filter(d => d.severity === 'WARNING');
  const chooseFile = (kind: typeof mode.current) => { mode.current = kind; input.current?.click(); };
  const create = () => { const name = prompt('Nome do projeto', 'Minha Mission Tree'); if (name?.trim()) open(newProject(name.trim())); };
  const importFile = async (file: File) => {
    const kind = mode.current;
    try {
      const source = await readText(file);
      if (kind === 'project') { open(loadProject(source)); return; }
      const tree = importTree(source, file.name.replace(/\.txt$/i, ''));
      if (kind === 'library') mutate(p => { p.library.push(tree); if (!p.baseTreeId) p.baseTreeId = tree.id; });
      else { const p = newProject(tree.name); p.tree = tree; open(p); }
      if (!missionsOf(tree).length) report('Arquivo importado, mas nenhuma missão foi reconhecida. Consulte Raw View; todos os blocos foram preservados.');
    } catch (e) { report(`Importação falhou: ${(e as Error).message}`); }
  };
  const exportTree = () => {
    if (!project) return;
    setShowProblems(true);
    if (errors.length) { report(`Exportação bloqueada: corrija ${errors.length} ERROR(s).`); return; }
    if (warnings.length && !confirm(`${warnings.length} WARNING(s), incluindo regras possivelmente UNKNOWN. Revise a lista; exportar não certifica compatibilidade com EU4/Portuversalis. Continuar?`)) return;
    download(`${project.tree.name}_missions.txt`, serialize(project.tree.ast) + '\n');
  };
  const focusDiagnostic = (d: Diagnostic) => {
    setBranch('');
    if (d.missionUid) {
      setSelected(d.missionUid);
      setTimeout(() => window.dispatchEvent(new CustomEvent('eu4-focus-property', { detail: d.property ?? 'raw' })), 50);
    } else if (d.code.startsWith('BRANCH')) setModal('branches');
    else if (['SLOT', 'SERIES_ID'].includes(d.code)) setModal('series');
  };
  const autoArrange = () => mutate(p => {
    const all = missionsOf(p.tree);
    const remaining = new Map(all.map(m => [m.id, m]));
    const rows = new Map<string, number>(), occupied = new Set<string>();
    while (remaining.size) {
      let progress = false;
      for (const [id, mission] of remaining) {
        if (mission.required.some(required => remaining.has(required))) continue;
        let row = Math.max(0, ...mission.required.map(required => rows.get(required) ?? 0)) + 1;
        while (occupied.has(`${mission.slot}:${row}`)) row++;
        occupied.add(`${mission.slot}:${row}`); rows.set(id, row);
        setField(children(mission.node), 'position', String(row)); remaining.delete(id); progress = true;
      }
      if (!progress) throw new Error('Auto-arrange cancelado: resolva ciclos ou IDs duplicados.');
    }
  });
  const fileInput = <input hidden ref={input} type="file" accept=".txt,.eu4proj" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />;
  const toast = message && <div className="toast" role="alert"><span>{message}</span><button onClick={() => setMessage('')} aria-label="Fechar aviso">✕</button></div>;
  if (!project) return <main className="home">{fileInput}{toast}<header className="home-header"><div className="brand"><span className="brand-emblem">⚜</span><div>EU4 <b>MISSION TREE ARCHITECT</b><small>THE CAMPAIGN IS YOURS TO DESIGN</small></div></div><span className="local-badge">◆ LOCAL-FIRST · NO DATABASE</span></header>
    <section className="hero"><div className="hero-crest">⚜</div><p className="eyebrow">EUROPA UNIVERSALIS IV · MODDING WORKSPACE</p><h1>Escreva o destino<br /><em>de uma nação.</em></h1><p>Crie, conecte e refine suas Mission Trees.<br />Um editor visual sobre uma AST Clausewitz — seus dados, no seu navegador.</p>
      <div className="home-actions"><button disabled={!ready} onClick={create}><span>＋</span><strong>Create Project</strong><small>Comece uma nova campanha</small></button><button disabled={!ready} onClick={() => chooseFile('project')}><span>▣</span><strong>Load Project</strong><small>Recupere seu arquivo .eu4proj</small></button><button disabled={!ready} onClick={() => chooseFile('tree')}><span>⇧</span><strong>Import Mission Tree</strong><small>Abra um arquivo Clausewitz .txt</small></button></div>
    </section><section className="recent-section"><h2>Projetos recentes <span>{recents.length}</span></h2>{!ready ? <p>Recuperando workspace local…</p> : !recents.length ? <p className="muted">Suas campanhas aparecerão aqui. Autosave via IndexedDB, sem envio ao servidor.</p> : <div className="recent-grid">{recents.map(p => <button key={p.id} onClick={() => open(p)}><span>⚑</span><div><strong>{p.name}</strong><small>{missionsOf(p.tree).length} missões · {new Date(p.updatedAt).toLocaleString('pt-BR')}</small></div><span>→</span></button>)}</div>}</section><footer>Fan-made modding tool · Não afiliado à Paradox Interactive. Faça backups .eu4proj: dados locais podem ser removidos pelo navegador.</footer>
  </main>;
  const all = missionsOf(project.tree);
  return <main className="app-shell">{fileInput}{toast}<header className="app-header"><button className="brand compact" onClick={() => { replaceHistory(emptyHistory()); setModal(''); }} title="Página inicial"><span className="brand-emblem">⚜</span><div>EU4 <b>MISSION TREE ARCHITECT</b><small>{project.name}</small></div></button><div className="header-actions"><button onClick={() => download(`${project.name}.eu4proj`, JSON.stringify(project, null, 2), 'application/json')}>Save Project</button><button onClick={() => chooseFile('project')}>Load Project</button><button onClick={() => chooseFile('tree')}>Import .txt</button><button className="primary" onClick={exportTree}>Export Mission Tree ↗</button></div></header>
    <div className="workspace-bar"><span className="workspace-label">⚑ {project.tree.country || project.name} <small>{all.length} MISSIONS · {seriesOf(project.tree).length} SERIES</small></span><label className={`mode-toggle ${project.portuversalis ? 'enabled' : ''}`}><input type="checkbox" checked={project.portuversalis} onChange={e => mutate(p => { p.portuversalis = e.target.checked; })} /> Portuversalis Mode <b>{project.portuversalis ? 'ON' : 'OFF'}</b></label></div>
    <div className="workspace"><Library project={project} mutate={mutate} importLibrary={() => chooseFile('library')} select={setSelected} /><section className="editor"><div className="editor-toolbar"><div className="toolbar-group"><button onClick={() => mutate(p => setSelected(addMission(p, seriesOf(p.tree)[0]?.node.id ?? '')))}>＋ Mission</button><button className={link ? 'active' : ''} aria-pressed={link} onClick={() => setLink(!link)}>⇄ Link Mode</button><button onClick={autoArrange}>Auto-arrange</button></div><div className="toolbar-group"><button disabled={!history.past.length} onClick={undo} title="Undo (Ctrl+Z)">↶</button><button disabled={!history.future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button><select aria-label="Zoom" value={zoom} onChange={e => { const value = Number(e.target.value); setZoom(value); try { localStorage.setItem('eu4-zoom', String(value)); } catch {} }}>{[0.4, 0.6, 0.85, 1, 1.25, 1.5].map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></div></div>
      <div className="canvas-subbar"><div><button onClick={() => setModal('series')}>Series</button><button onClick={() => setModal('branches')}>Branches</button><button onClick={() => setModal('raw')}>{'{ }'} Raw View</button></div><select aria-label="Visualizar branch" value={branch} onChange={e => setBranch(e.target.value)}><option value="">Todas as branches</option>{project.branches.map(b => <option key={b.id} value={b.id}>{b.type === 'son' ? '↳ ' : ''}{b.name}</option>)}</select></div>
      <Canvas project={project} selected={selected} select={setSelected} mutate={mutate} branch={branch} link={link} zoom={zoom} report={report} />
      <section className={`problems ${showProblems ? 'expanded' : ''}`}><button className="problems-heading" onClick={() => setShowProblems(!showProblems)}>VALIDATION ENGINE <span className="error-count">{errors.length} ERROR</span><span className="warning-count">{warnings.length} WARNING</span><span>{diagnostics.filter(d => d.severity === 'INFO').length} INFO</span><span>{showProblems ? '⌄' : '⌃'}</span></button>{showProblems && <div className="problems-list">{diagnostics.length ? diagnostics.map((d, i) => <button className={`diagnostic ${d.severity.toLowerCase()}`} key={`${d.code}-${d.missionUid}-${i}`} onClick={() => focusDiagnostic(d)}><b>{d.severity}</b><span>{d.message}</span>{d.missionUid && <small>{all.find(m => m.uid === d.missionUid)?.id} ↗</small>}</button>) : <p className="empty-note">Nenhum diagnóstico estrutural. Isso não substitui testes dentro do EU4.</p>}</div>}</section>
    </section><Inspector project={project} selected={selected} mutate={mutate} report={report} /></div>
    <footer className="statusbar"><span>{saveStatus}</span><span>AST · {all.length} missões · {project.branches.length} branches</span><div><select aria-label="Idioma localization" value={project.language} onChange={e => mutate(p => { p.language = e.target.value; })}>{['english', 'french', 'german', 'spanish'].map(l => <option key={l}>{l}</option>)}</select><button onClick={() => download(`${project.tree.name}_l_${project.language}.yml`, exportLocalization(project), 'text/yaml;charset=utf-8')}>Export localization</button></div></footer>
    {modal && <Managers project={project} mutate={mutate} kind={modal} close={() => setModal('')} report={report} />}
  </main>;
}
