import { Project, loadProject } from '../core/project';
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('eu4-mission-architect', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('IndexedDB bloqueado por outra aba.')); };
  });
  return connection;
}
export async function saveProject(project: Project): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Autosave interrompido.'));
    tx.onerror = () => reject(tx.error);
  });
}
export async function recentProjects(): Promise<Project[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').getAll();
    request.onsuccess = () => {
      try { resolve(request.result.map(p => loadProject(JSON.stringify(p))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
      catch (e) { reject(e); }
    };
    request.onerror = () => reject(request.error);
  });
}
export function download(name: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readText(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Limite de importação: 25 MB.');
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
