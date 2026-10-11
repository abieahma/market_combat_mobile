// Small deterministic PRNG (mulberry32). The state is a plain number so it can
// live inside game state and be replayed on the server with the same seed.

export type RngState = number;

/** Returns a float in [0, 1) and the next state. */
export function nextFloat(state: RngState): [number, RngState] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Standard normal sample (Box–Muller). */
export function nextNormal(state: RngState): [number, RngState] {
  let u: number;
  let v: number;
  let s = state;
  [u, s] = nextFloat(s);
  [v, s] = nextFloat(s);
  const z = Math.sqrt(-2 * Math.log(u || 1e-12)) * Math.cos(2 * Math.PI * v);
  return [z, s];
}

/** Integer in [min, max] inclusive. */
export function nextInt(state: RngState, min: number, max: number): [number, RngState] {
  const [f, s] = nextFloat(state);
  return [min + Math.floor(f * (max - min + 1)), s];
}

/** Float in [min, max). */
export function nextRange(state: RngState, min: number, max: number): [number, RngState] {
  const [f, s] = nextFloat(state);
  return [min + f * (max - min), s];
}

export function pick<T>(state: RngState, items: readonly T[]): [T, RngState] {
  const [i, s] = nextInt(state, 0, items.length - 1);
  return [items[i], s];
}

/** Turns any string or number into a 32-bit seed. */
export function seedFrom(input: string | number): RngState {
  const text = String(input);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
