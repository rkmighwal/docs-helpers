/** A small XML reader, enough for the SVG this tool writes itself (elements, attributes, text; no comments or CDATA). */
export interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; text: string }

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
const unescapeXml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<\?[^>]*\?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += unescapeXml(m[5]); continue; }
    if (m[2] === undefined) continue; // a processing instruction
    if (m[1]) {
      if (stack.length > 1 && stack[stack.length - 1].tag === m[2]) stack.pop();
      else throw new Error(`Unexpected closing tag </${m[2]}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/\s([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
    const node: XNode = { tag: m[2], attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`Unclosed element <${stack[stack.length - 1].tag}>`);
  const first = root.children[0];
  if (!first) throw new Error('No elements found');
  return first;
}
