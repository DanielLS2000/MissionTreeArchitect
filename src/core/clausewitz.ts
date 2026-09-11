// Scalars retain their original lexeme, including quotes and escape sequences.
// Ordered nodes preserve duplicate keys, comments, anonymous list values and unknown blocks.
export interface AstNode {
  id: string;
  key?: string;
  op?: string;
  value: string | AstNode[];
  comment?: boolean;
}
export type Ast = AstNode[];
export const uid = () => crypto.randomUUID();
interface Token { text: string; offset: number; comment?: boolean }
export class ParseError extends Error {
  constructor(message: string, source: string, offset: number) {
    const prefix = source.slice(0, offset).split('\n');
    super(`${message} (linha ${prefix.length}, coluna ${prefix.at(-1)!.length + 1})`);
    this.name = 'ParseError';
  }
}
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s|\uFEFF/.test(source[i])) { i++; continue; }
    const start = i;
    if (source[i] === '#') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      tokens.push({ text: source.slice(start, i), offset: start, comment: true });
      continue;
    }
    if (source[i] === '"') {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === '"') { closed = true; break; }
      }
      if (!closed) throw new ParseError('String sem fechamento', source, start);
    } else if ('{}=<>!?'.includes(source[i])) {
      i++;
      if ('=<>!?'.includes(source[start]) && source[i] === '=') i++;
    } else {
      while (i < source.length && !/[\s{}=<>!?#"]/.test(source[i])) i++;
    }
    tokens.push({ text: source.slice(start, i), offset: start });
  }
  return tokens;
}
export function parse(source: string): Ast {
  const tokens = tokenize(source);
  let cursor = 0;
  const fail = (message: string) => { throw new ParseError(message, source, tokens[cursor]?.offset ?? source.length); };
  const isOperator = (text?: string) => !!text && /^(=|==|!=|<|>|<=|>=|\?=)$/.test(text);
  const block = (nested: boolean, depth: number): Ast => {
    if (depth > 256) fail('Profundidade máxima excedida');
    const nodes: Ast = [];
    const comments = () => {
      while (tokens[cursor]?.comment) nodes.push({ id: uid(), value: tokens[cursor++].text, comment: true });
    };
    const value = (): string | Ast => {
      comments();
      const token = tokens[cursor];
      if (!token || token.text === '}' || isOperator(token.text)) return fail('Valor esperado');
      cursor++;
      return token.text === '{' ? block(true, depth + 1) : token.text;
    };
    while (cursor < tokens.length) {
      comments();
      if (cursor >= tokens.length) break;
      if (tokens[cursor].text === '}') {
        if (!nested) fail('Chave de fechamento inesperada');
        cursor++;
        return nodes;
      }
      const first = value();
      comments();
      if (typeof first === 'string' && isOperator(tokens[cursor]?.text)) {
        const op = tokens[cursor++].text;
        nodes.push({ id: uid(), key: first, op, value: value() });
      } else nodes.push({ id: uid(), value: first });
    }
    if (nested) fail('Bloco sem fechamento');
    return nodes;
  };
  return block(false, 0);
}
export function serialize(ast: Ast, depth = 0): string {
  const indent = '\t'.repeat(depth);
  return ast.map(node => {
    const prefix = node.key === undefined ? '' : `${node.key} ${node.op ?? '='} `;
    if (node.comment) return indent + node.value;
    if (Array.isArray(node.value)) {
      return `${indent}${prefix}{${node.value.length ? '\n' + serialize(node.value, depth + 1) + '\n' + indent : ' '}}`;
    }
    return indent + prefix + node.value;
  }).join('\n');
}
export function text(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1') : raw;
}
export const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
export const field = (ast: Ast, key: string) => ast.find(n => !n.comment && n.key !== undefined && text(n.key) === key);
export const scalar = (ast: Ast, key: string, fallback = '') => {
  const value = field(ast, key)?.value;
  return typeof value === 'string' ? text(value) : fallback;
};
export const children = (node?: AstNode): Ast => Array.isArray(node?.value) ? node.value : [];
export function setField(ast: Ast, key: string, value: string | Ast): void {
  const existing = field(ast, key);
  if (existing) existing.value = value;
  else ast.push({ id: uid(), key, op: '=', value });
}
export const property = (key: string, value: string | Ast): AstNode => ({ id: uid(), key, op: '=', value });
export function cloneAst(ast: Ast): Ast {
  return ast.map(n => ({ ...n, id: uid(), value: Array.isArray(n.value) ? cloneAst(n.value) : n.value }));
}
export function semantic(ast: Ast): string {
  const clean = (nodes: Ast): unknown => nodes.filter(n => !n.comment).map(n => ({ key: n.key, op: n.op, value: Array.isArray(n.value) ? clean(n.value) : n.value }));
  return JSON.stringify(clean(ast));
}
