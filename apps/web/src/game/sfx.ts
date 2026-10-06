import type { SoundKind } from './state.js';

// Synthesised effects: no asset files to ship, and each has a distinct sound for hit, tier-up and low health.
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('war.muted') === '1'; } catch { /* storage blocked */ }
const last = new Map<string, number>();

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('war.muted', m ? '1' : '0'); } catch { /* storage blocked */ }
}
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur: number, vol: number, delay = 0) {
  if (!ctx || muted) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(ctx.destination);
  s.start(ctx.currentTime + delay);
}

/** dist is the distance from the listener in wu; far sounds are quieter and dropped when too quiet. */
export function play(kind: SoundKind, dist = 0) {
  if (!ctx || muted) return;
  const now = performance.now();
  const gap: Record<SoundKind, number> = { shoot: 45, hit: 40, hurt: 120, pickup: 55, tier: 300, kill: 150, death: 400, boom: 80, crate: 120, low: 900 };
  if (now - (last.get(kind) ?? 0) < gap[kind]) return;
  const att = Math.max(0, 1 - dist / 900);
  if (att < 0.08) return;
  last.set(kind, now);
  const v = att * att;
  switch (kind) {
    case 'shoot': tone(320, 0.08, 'square', 0.04 * v, 110); break;
    case 'hit': tone(520, 0.05, 'triangle', 0.05 * v, 300); break;
    case 'hurt': tone(160, 0.18, 'sawtooth', 0.09, 70); noise(0.1, 0.05); break;
    case 'pickup': tone(700 + Math.random() * 300, 0.06, 'sine', 0.035); break;
    case 'crate': tone(500, 0.1, 'triangle', 0.07, 900); break;
    case 'tier': tone(440, 0.12, 'triangle', 0.1); tone(660, 0.12, 'triangle', 0.1, undefined, 0.1); tone(880, 0.2, 'triangle', 0.1, undefined, 0.2); break;
    case 'kill': tone(300, 0.12, 'square', 0.07, 600); break;
    case 'death': tone(220, 0.5, 'sawtooth', 0.1, 50); noise(0.3, 0.08); break;
    case 'boom': noise(0.35, 0.18 * v); tone(90, 0.3, 'sine', 0.15 * v, 40); break;
    case 'low': tone(880, 0.09, 'square', 0.05); tone(880, 0.09, 'square', 0.05, undefined, 0.16); break;
  }
}
