// Small seeded random generator so the same search returns the same demo results.
export function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const randInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const code = (r, n = 6) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(r() * 32)]).join('');
export function addMinutes(isoLocal, mins) {
  const d = new Date(`${isoLocal}Z`);
  return new Date(d.getTime() + mins * 60000).toISOString().slice(0, 19);
}
export const randomId = () => Math.random().toString(36).slice(2, 10).toUpperCase();
