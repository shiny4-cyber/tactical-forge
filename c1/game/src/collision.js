// Collision and rays against the map's axis-aligned boxes. No three.js, no allocation in the
// query paths: one flat array of boxes, a slab test that writes into a caller-owned result.
import { BOXES, MAP } from './map.js';

export const PLAYER_RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.14;

// Baked once at load: min/max corners so the hot loops never recompute them.
export function buildWorld(boxes = BOXES) {
  const world = { boxes: [], solids: [], count: 0 };
  for (const source of boxes) {
    const box = {
      minX: source.x - source.w / 2,
      maxX: source.x + source.w / 2,
      minY: source.y - source.h / 2,
      maxY: source.y + source.h / 2,
      minZ: source.z - source.d / 2,
      maxZ: source.z + source.d / 2,
      kind: source.kind,
      solid: source.solid !== false,
      source,
      index: world.count,
    };
    world.boxes.push(box);
    if (box.solid) world.solids.push(box);
    world.count += 1;
  }
  return world;
}

export const WORLD = buildWorld();

// A body is {x, y, z} feet position plus height. `overlaps` is the single horizontal test the
// movement and the bot steering share.
export function overlapsAt(world, x, y, z, radius, height, lift = 0.04) {
  const minX = x - radius;
  const maxX = x + radius;
  const minY = y + lift;
  const maxY = y + height - lift;
  const minZ = z - radius;
  const maxZ = z + radius;
  for (let i = 0; i < world.solids.length; i += 1) {
    const b = world.solids[i];
    if (maxX > b.minX && minX < b.maxX && maxY > b.minY && minY < b.maxY && maxZ > b.minZ && minZ < b.maxZ) return b;
  }
  return null;
}

// Move one body against the solids, one horizontal axis at a time, then resolve the vertical
// move against box tops so crates are jumpable. Mutates body {x,y,z,vy,onGround}.
export function moveBody(world, body, dx, dz, dy, radius, height) {
  if (dx !== 0) {
    const nextX = body.x + dx;
    if (!overlapsAt(world, nextX, body.y, body.z, radius, height)) body.x = nextX;
  }
  if (dz !== 0) {
    const nextZ = body.z + dz;
    if (!overlapsAt(world, body.x, body.y, nextZ, radius, height)) body.z = nextZ;
  }
  const previousY = body.y;
  let nextY = body.y + dy;
  body.onGround = false;
  if (nextY <= 0) {
    nextY = 0;
    body.onGround = true;
  } else if (dy <= 0) {
    // Land on the highest crate top the feet pass through this step.
    let support = -Infinity;
    for (let i = 0; i < world.solids.length; i += 1) {
      const b = world.solids[i];
      if (b.maxY > previousY + 0.02 || b.maxY < nextY - 0.001) continue;
      if (body.x + radius <= b.minX || body.x - radius >= b.maxX) continue;
      if (body.z + radius <= b.minZ || body.z - radius >= b.maxZ) continue;
      if (b.maxY > support) support = b.maxY;
    }
    if (support > -Infinity && support >= nextY) {
      nextY = support;
      body.onGround = true;
    }
  } else {
    // Head bump: stop the rise if the crown enters a box.
    if (overlapsAt(world, body.x, nextY, body.z, radius, height, 0)) {
      nextY = previousY;
    }
  }
  body.y = nextY;
  if (body.onGround) body.vy = Math.max(0, body.vy);
  return body;
}

export const rayHit = { t: 0, box: null, nx: 0, ny: 0, nz: 0 };

// Slab test against the solid boxes, in index order, nearest hit wins. Writes into `rayHit`
// and returns it, or null when nothing is between origin and maxDistance.
export function rayWorld(world, ox, oy, oz, dx, dy, dz, maxDistance = 200) {
  let bestT = maxDistance;
  let bestBox = null;
  let bestAxis = 0;
  const invX = dx === 0 ? Infinity : 1 / dx;
  const invY = dy === 0 ? Infinity : 1 / dy;
  const invZ = dz === 0 ? Infinity : 1 / dz;
  for (let i = 0; i < world.solids.length; i += 1) {
    const b = world.solids[i];
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = 0;
    let t1 = (b.minX - ox) * invX;
    let t2 = (b.maxX - ox) * invX;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 0;
    }
    if (t2 < tmax) tmax = t2;
    t1 = (b.minY - oy) * invY;
    t2 = (b.maxY - oy) * invY;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 1;
    }
    if (t2 < tmax) tmax = t2;
    t1 = (b.minZ - oz) * invZ;
    t2 = (b.maxZ - oz) * invZ;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 2;
    }
    if (t2 < tmax) tmax = t2;
    if (tmax < 0 || tmin > bestT || tmin > tmax) continue;
    const hitT = tmin < 0 ? 0 : tmin;
    bestT = hitT;
    bestBox = b;
    bestAxis = axis;
  }
  if (bestBox === null) return null;
  rayHit.t = bestT;
  rayHit.box = bestBox;
  rayHit.nx = bestAxis === 0 ? -Math.sign(dx) : 0;
  rayHit.ny = bestAxis === 1 ? -Math.sign(dy) : 0;
  rayHit.nz = bestAxis === 2 ? -Math.sign(dz) : 0;
  return rayHit;
}

// Segment clear at eye height, used by the nav graph and by bot perception. Sampling every
// 0.4 m is enough for 1 m thick walls and much cheaper than a full sweep.
export function segmentClear(world, ax, az, bx, bz, eye = 1.2) {
  const dx = bx - ax;
  const dz = bz - az;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return true;
  const steps = Math.ceil(distance / 0.4);
  const stepX = dx / steps;
  const stepZ = dz / steps;
  let x = ax;
  let z = az;
  for (let i = 1; i <= steps; i += 1) {
    x += stepX;
    z += stepZ;
    if (overlapsAt(world, x, eye, z, 0.16, 0.2, 0)) return false;
  }
  return true;
}

// Walkability along a segment: a body's footprint sampled every 0.25 m from a to b. Sight
// tests and walk tests are different questions here (a 1.2 m crate is see-over but not
// walk-through), so the nav graph uses this one.
export function walkClear(world, ax, az, bx, bz, radius = 0.33, height = 1.7) {
  const dx = bx - ax;
  const dz = bz - az;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return true;
  const steps = Math.ceil(distance / 0.25);
  const stepX = dx / steps;
  const stepZ = dz / steps;
  let x = ax;
  let z = az;
  for (let i = 0; i <= steps; i += 1) {
    if (overlapsAt(world, x, 0, z, radius, height, 0.02)) return false;
    x += stepX;
    z += stepZ;
  }
  return true;
}

// A body standing in open floor: the spawn check and the nav test share it.
export function spotClear(world, x, z, radius = 0.34, height = 1.72) {
  return !overlapsAt(world, x, 0, z, radius, height, 0.02);
}

export function insideBounds(x, z) {
  return x > MAP.bounds.minX + 1 && x < MAP.bounds.maxX - 1 && z > MAP.bounds.minZ + 1 && z < MAP.bounds.maxZ - 1;
}

// Nearest solid top under a point, or 0 for the floor: the bots' feet follow the floor.
export function groundAt(x, z) {
  let top = 0;
  for (let i = 0; i < WORLD.solids.length; i += 1) {
    const b = WORLD.solids[i];
    if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) continue;
    if (b.maxY > top && b.maxY < 1.2) top = b.maxY;
  }
  return top;
}
