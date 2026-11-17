// Small vector and random helpers the simulation uses. Plain numbers, no three.js, so every
// module below this one runs under Node in the tests. Vectors are {x, y, z} objects created
// once and reused by the hot loops; nothing here allocates per call unless the caller asks.
export const TAU = Math.PI * 2;

export function vec(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function set(out, x, y, z) {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out, a) {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add(out, a, b) {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out, a, b) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out, a, s) {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function lengthSq(a) {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a) {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}

export function normalize(out, a) {
  const len = length(a);
  if (len === 0) return set(out, 0, 0, 0);
  return scale(out, a, 1 / len);
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Deterministic PRNG: a capture or a test run replays exactly from the same seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
