// Rolling pool of model-provider API keys: round-robin per request, per-key cooldown on rate limits,
// permanent retirement of keys the provider rejects. Keys never leave this module except as a request header.
type KeyState = { key: string; coolingUntil: number; invalid: boolean };
export type Lease = { key: string } | { waitMs: number };

export class KeyPool {
  private readonly states: KeyState[];
  private cursor = 0;
  constructor(keys: string[], private readonly now: () => number = Date.now) {
    this.states = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].map((key) => ({ key, coolingUntil: 0, invalid: false }));
  }
  get size() { return this.states.length; }

  /** Next usable key in rotation, or how long until one is usable (Infinity when every key is invalid). */
  acquire(): Lease {
    const time = this.now();
    for (let step = 0; step < this.states.length; step++) {
      const index = (this.cursor + step) % this.states.length;
      const state = this.states[index];
      if (!state.invalid && state.coolingUntil <= time) { this.cursor = (index + 1) % this.states.length; return { key: state.key }; }
    }
    const live = this.states.filter((state) => !state.invalid);
    return { waitMs: live.length ? Math.max(0, Math.min(...live.map((state) => state.coolingUntil)) - time) : Infinity };
  }
  cooldown(key: string, ms: number) {
    const state = this.states.find((item) => item.key === key);
    if (state) state.coolingUntil = Math.max(state.coolingUntil, this.now() + ms);
  }
  invalidate(key: string) {
    const state = this.states.find((item) => item.key === key);
    if (state) state.invalid = true;
  }
  /** Redacted status for diagnostics — never includes key material beyond a 4-character tail. */
  status() {
    const time = this.now();
    return this.states.map((state, index) => ({ key: `#${index + 1}…${state.key.slice(-4)}`, state: state.invalid ? "invalid" : state.coolingUntil > time ? "cooling" : "available" }));
  }
}

const pools = new Map<string, KeyPool>();
/** Shared per-process pool so cooldowns persist across requests. */
export function sharedKeyPool(keys: string[]) {
  const id = keys.join("\u0000");
  let pool = pools.get(id);
  if (!pool) { pool = new KeyPool(keys); pools.set(id, pool); }
  return pool;
}

export function parseApiKeys(env: Record<string, string | undefined>) {
  const list = (env.AI_API_KEYS ?? "").split(/[\s,]+/).filter(Boolean);
  const single = env.AI_API_KEY?.trim();
  return [...new Set([...(single ? [single] : []), ...list])];
}
