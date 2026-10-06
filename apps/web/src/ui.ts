// Tiny DOM helpers. Menus are plain DOM so they stay accessible and easy to restyle.

type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, unknown> = {}, ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (c: Child | Child[]) => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export function mount(root: HTMLElement, ...nodes: Node[]) {
  root.replaceChildren(...nodes);
}

let toastTimer: number | undefined;
export function toast(msg: string, error = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (error ? ' error' : ''), role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 4000);
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function meter(frac: number, cls = ''): HTMLElement {
  return h('div', { class: 'meter ' + cls }, h('i', { style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%` } }));
}
export const STAT_LABEL: Record<string, string> = {
  hull: 'Hull', armor: 'Armor', repair: 'Repair', speed: 'Speed', damage: 'Damage', fireRate: 'Fire rate', range: 'Range',
  look: 'Look', scope: 'Scope', feed: 'Feed', reborn: 'Respawn timer'
};
export function amount(stat: string, v: number, sign: '+' | '-'): string {
  const n = Math.abs(v);
  if (stat === 'armor') return `${sign}${n.toFixed(1)}`;
  if (stat === 'scope') return `${sign}${Math.round(n)} wu`;
  return `${sign}${n.toFixed(1)}%`;
}
