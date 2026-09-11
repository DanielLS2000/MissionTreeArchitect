import { NextResponse } from 'next/server';
import { parse, serialize } from '../../../core/clausewitz';
import { loadProject } from '../../../core/project';
import { validate } from '../../../core/validate';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'Corpo ausente.' }, { status: 400 });
    const decoder = new TextDecoder(); let body = '', size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 25 * 1024 * 1024) { await reader.cancel(); return NextResponse.json({ error: 'Limite: 25 MB.' }, { status: 413 }); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const input = JSON.parse(body);
    if (input.action === 'parse' && typeof input.source === 'string') return NextResponse.json({ ast: parse(input.source) });
    const project = loadProject(JSON.stringify(input.project));
    const diagnostics = validate(project);
    if (input.action === 'validate') return NextResponse.json({ diagnostics });
    if (input.action === 'export') {
      if (diagnostics.some(d => d.severity === 'ERROR')) return NextResponse.json({ diagnostics }, { status: 422 });
      if (diagnostics.some(d => d.severity === 'WARNING') && input.acknowledgeWarnings !== true) return NextResponse.json({ error: 'Confirme a revisão dos warnings.', diagnostics }, { status: 409 });
      return NextResponse.json({ source: serialize(project.tree.ast) + '\n', diagnostics });
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Entrada inválida.' }, { status: 400 }); }
}
