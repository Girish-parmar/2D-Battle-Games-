export interface Sample { mx: number; my: number; aim: number; fire: boolean; scope: boolean; hasAim: boolean }

/** Keyboard, mouse and touch. Desktop: WASD, mouse aim, hold LMB to fire, hold RMB or Shift to scope. */
export class InputController {
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, seen: false };
  private lmb = false;
  private rmb = false;
  autoFire = false;
  tabHeld = false;
  emoteHeld = false;
  private touchMove = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchAim = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchScope = false;
  private touchUi: HTMLElement | null = null;
  private stickA: HTMLElement | null = null;
  private stickB: HTMLElement | null = null;
  private handlers: [EventTarget, string, EventListener][] = [];
  touching = false;

  constructor(
    private target: HTMLElement,
    private cb: { emote(i: number): void; menu(): void; autoFireChanged(on: boolean): void }
  ) {
    const on = (t: EventTarget, ev: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opts);
      this.handlers.push([t, ev, fn]);
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ', 'tab', 'q'].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === 'tab') this.tabHeld = true;
      if (k === 'q') this.emoteHeld = true;
      if (k === 'f') { this.autoFire = !this.autoFire; this.cb.autoFireChanged(this.autoFire); }
      if (k === 'escape') this.cb.menu();
      if (this.emoteHeld && k >= '1' && k <= '6') this.cb.emote(Number(k) - 1);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.tabHeld = false;
      if (k === 'q') this.emoteHeld = false;
    });
    on(window, 'blur', () => { this.keys.clear(); this.lmb = false; this.rmb = false; this.tabHeld = false; this.emoteHeld = false; });
    on(target, 'mousemove', (e: MouseEvent) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true; });
    on(target, 'mousedown', (e: MouseEvent) => { if (e.button === 0) this.lmb = true; if (e.button === 2) this.rmb = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    on(window, 'mouseup', (e: MouseEvent) => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    on(target, 'contextmenu', (e: Event) => e.preventDefault());
    on(target, 'touchstart', (e: TouchEvent) => this.touchStart(e), { passive: false });
    on(target, 'touchmove', (e: TouchEvent) => this.touchMoveEv(e), { passive: false });
    on(target, 'touchend', (e: TouchEvent) => this.touchEnd(e));
    on(target, 'touchcancel', (e: TouchEvent) => this.touchEnd(e));
  }

  private buildTouchUi() {
    if (this.touchUi) return;
    const ui = document.createElement('div');
    ui.className = 'touch';
    const stick = () => { const s = document.createElement('div'); s.className = 'stick'; s.append(document.createElement('i')); return s; };
    this.stickA = stick(); this.stickB = stick();
    const btn = document.createElement('button');
    btn.className = 'tbtn'; btn.textContent = 'Scope'; btn.setAttribute('aria-label', 'Toggle scope');
    btn.addEventListener('click', () => { this.touchScope = !this.touchScope; btn.classList.toggle('on', this.touchScope); });
    ui.append(this.stickA, this.stickB, btn);
    document.body.append(ui);
    this.touchUi = ui;
  }
  private placeStick(el: HTMLElement | null, st: { ox: number; oy: number; x: number; y: number }, show: boolean) {
    if (!el) return;
    el.style.display = show ? 'block' : 'none';
    el.style.left = `${st.ox - 65}px`; el.style.top = `${st.oy - 65}px`;
    const i = el.firstElementChild as HTMLElement;
    const dx = Math.max(-65, Math.min(65, st.x - st.ox)), dy = Math.max(-65, Math.min(65, st.y - st.oy));
    i.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  private touchStart(e: TouchEvent) {
    e.preventDefault();
    this.touching = true;
    this.buildTouchUi();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth / 2;
      const st = left ? this.touchMove : this.touchAim;
      if (st.id !== -1) continue;
      Object.assign(st, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY });
    }
    this.refreshSticks();
  }
  private touchMoveEv(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      for (const st of [this.touchMove, this.touchAim]) if (st.id === t.identifier) { st.x = t.clientX; st.y = t.clientY; }
    }
    this.refreshSticks();
  }
  private touchEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      for (const st of [this.touchMove, this.touchAim]) if (st.id === t.identifier) st.id = -1;
    }
    this.refreshSticks();
  }
  private refreshSticks() {
    this.placeStick(this.stickA, this.touchMove, this.touchMove.id !== -1);
    this.placeStick(this.stickB, this.touchAim, this.touchAim.id !== -1);
  }

  sample(center: { x: number; y: number }): Sample {
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) mx -= 127;
    if (k.has('d') || k.has('arrowright')) mx += 127;
    if (k.has('w') || k.has('arrowup')) my -= 127;
    if (k.has('s') || k.has('arrowdown')) my += 127;
    let aim = 0, hasAim = false;
    let fire = this.lmb;
    let scope = this.rmb || k.has('shift');
    if (this.touchMove.id !== -1) {
      const dx = (this.touchMove.x - this.touchMove.ox) / 65, dy = (this.touchMove.y - this.touchMove.oy) / 65;
      const m = Math.hypot(dx, dy);
      if (m > 0.1) { const s = Math.min(1, m) / m; mx = Math.round(dx * s * 127); my = Math.round(dy * s * 127); }
    }
    if (this.touchAim.id !== -1) {
      const dx = this.touchAim.x - this.touchAim.ox, dy = this.touchAim.y - this.touchAim.oy;
      const m = Math.hypot(dx, dy) / 65;
      if (m > 0.1) { aim = Math.atan2(dy, dx); hasAim = true; }
      if (m > 0.3) fire = true; // pushing the right stick past 30% fires
    } else if (this.mouse.seen) {
      aim = Math.atan2(this.mouse.y - center.y, this.mouse.x - center.x);
      hasAim = true;
    }
    if (this.touchScope) scope = true;
    return { mx, my, aim, fire, scope, hasAim };
  }

  destroy() {
    for (const [t, ev, fn] of this.handlers) t.removeEventListener(ev, fn);
    this.touchUi?.remove();
  }
}
