type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, any> = {}, ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'draggable' || k === 'checked' || k === 'disabled' || k === 'selected') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k as any);
  return el;
}

export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept });
    i.addEventListener('change', () => res(i.files?.[0] ?? null));
    i.addEventListener('cancel', () => res(null));
    i.click();
  });
}
