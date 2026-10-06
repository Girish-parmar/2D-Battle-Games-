import { createHmac, timingSafeEqual } from 'node:crypto';

// Small HMAC-signed tokens (JWT-shaped, HS256). Access tokens last 15 minutes, room tickets 60 seconds.
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(payload: Record<string, unknown>, secret: string, ttlS: number): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlS }));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify<T extends Record<string, unknown>>(token: string, secret: string): (T & { exp: number }) | null {
  const i = token.indexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i);
  const mac = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return typeof p.exp === 'number' && p.exp * 1000 > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export interface Bucket { count: number; resetAt: number }
/** Fixed-window rate limiter keyed by string. Returns true when the call is allowed. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; this.buckets.set(key, b); }
    b.count++;
    if (this.buckets.size > 20000) for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    return b.count <= max;
  }
}
