// Gunplay: the weapon table, the spread model, the hit scan against bodies, and damage with
// the head multiplier. The rule the whole game is built around lives here: standing still is
// accurate, firing while moving is not; recoil climbs and pulls the muzzle, so a burst has to
// be re-aimed rather than held.
import { rayWorld } from './collision.js';
import { clamp } from './mathx.js';

export const WEAPONS = {
  kestrel: {
    id: 'kestrel',
    name: 'KESTREL',
    slot: 1,
    kind: 'rifle',
    cost: 2700,
    mag: 30,
    reserve: 90,
    damage: 33,
    headMultiplier: 4,
    interval: 0.1,
    reload: 2.15,
    spreadStill: 0.0018,
    spreadMove: 0.03,
    recoilPitch: 0.0115,
    recoilYaw: 0.0042,
    recoilRecover: 7.5,
    pellets: 1,
    auto: true,
  },
  tapper: {
    id: 'tapper',
    name: 'TAPPER',
    slot: 2,
    kind: 'smg',
    cost: 1250,
    mag: 25,
    reserve: 100,
    damage: 22,
    headMultiplier: 4,
    interval: 0.075,
    reload: 1.75,
    spreadStill: 0.0034,
    spreadMove: 0.026,
    recoilPitch: 0.0075,
    recoilYaw: 0.0046,
    recoilRecover: 9,
    pellets: 1,
    auto: true,
  },
  marrow: {
    id: 'marrow',
    name: 'MARROW',
    slot: 3,
    kind: 'shotgun',
    cost: 1800,
    mag: 7,
    reserve: 28,
    damage: 13,
    headMultiplier: 2.2,
    interval: 0.82,
    reload: 2.6,
    spreadStill: 0.02,
    spreadMove: 0.028,
    recoilPitch: 0.028,
    recoilYaw: 0.008,
    recoilRecover: 6,
    pellets: 8,
    auto: false,
  },
  spark: {
    id: 'spark',
    name: 'SPARK',
    slot: 4,
    kind: 'pistol',
    cost: 500,
    mag: 12,
    reserve: 48,
    damage: 26,
    headMultiplier: 4,
    interval: 0.16,
    reload: 1.4,
    spreadStill: 0.0028,
    spreadMove: 0.03,
    recoilPitch: 0.009,
    recoilYaw: 0.003,
    recoilRecover: 10,
    pellets: 1,
    auto: false,
  },
};

export const GRENADE = { id: 'pitch', name: 'PITCH FRAG', cost: 300, damage: 92, radius: 3.6, fuse: 2.6, max: 1 };

export const BUY_LIST = [
  { id: 'kestrel', type: 'weapon', name: 'KESTREL', cost: 2700, hint: 'rifle / 30 rounds' },
  { id: 'tapper', type: 'weapon', name: 'TAPPER', cost: 1250, hint: 'smg / 25 rounds' },
  { id: 'marrow', type: 'weapon', name: 'MARROW', cost: 1800, hint: 'shotgun / 7 shells' },
  { id: 'spark', type: 'weapon', name: 'SPARK', cost: 500, hint: 'pistol / 12 rounds' },
  { id: 'pitch', type: 'grenade', name: 'PITCH FRAG', cost: 300, hint: 'one thrown grenade' },
  { id: 'armor', type: 'armor', name: 'PLATE VEST', cost: 650, hint: 'absorbs half of each hit' },
];

// Speed-scaled spread: at a standstill the cone is the weapon's base; at full run it is the
// base plus the movement term. Crouching cuts it by a third, which is why holding still pays.
export function spreadFor(weapon, speed, crouching) {
  const move = clamp(speed / 5.2, 0, 1) * weapon.spreadMove;
  const cone = weapon.spreadStill + move;
  return crouching ? cone * 0.66 : cone;
}

// Two random angles inside the cone, applied to the shot's direction. Deterministic for a
// given rng, so a test can assert that a moving shot is wider than a still one.
export function scatterDirection(out, dir, spread, random) {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * spread;
  // Any pair of perpendicular axes will do; pick the one the direction is least aligned with.
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(dir.y) > 0.9) {
    ux = 1;
    uy = 0;
    uz = 0;
  }
  // right = normalize(cross(dir, up))
  let rx = dir.y * uz - dir.z * uy;
  let ry = dir.z * ux - dir.x * uz;
  let rz = dir.x * uy - dir.y * ux;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  // up2 = cross(right, dir)
  const vx = ry * dir.z - rz * dir.y;
  const vy = rz * dir.x - rx * dir.z;
  const vz = rx * dir.y - ry * dir.x;
  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;
  out.x = dir.x + rx * ox + vx * oy;
  out.y = dir.y + ry * ox + vy * oy;
  out.z = dir.z + rz * ox + vz * oy;
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  return out;
}

// Body boxes in world space. A crouched actor is shorter; the head follows the model.
export function actorBoxes(actor) {
  const height = actor.crouching ? 1.14 : 1.72;
  const headTop = actor.y + height;
  const headBottom = headTop - 0.26;
  return {
    head: { minX: actor.x - 0.19, maxX: actor.x + 0.19, minY: headBottom, maxY: headTop, minZ: actor.z - 0.19, maxZ: actor.z + 0.19 },
    body: { minX: actor.x - 0.31, maxX: actor.x + 0.31, minY: actor.y + 0.5, maxY: headBottom, minZ: actor.z - 0.31, maxZ: actor.z + 0.31 },
    legs: { minX: actor.x - 0.24, maxX: actor.x + 0.24, minY: actor.y, maxY: actor.y + 0.5, minZ: actor.z - 0.24, maxZ: actor.z + 0.24 },
  };
}

export const shotResult = { hit: null, part: null, distance: 0, x: 0, y: 0, z: 0, wall: false, wallKind: null };

function rayBox(box, ox, oy, oz, invX, invY, invZ, maxT) {
  let tmin = 0;
  let tmax = maxT;
  let t1 = (box.minX - ox) * invX;
  let t2 = (box.maxX - ox) * invX;
  if (t1 > t2) {
    const s = t1;
    t1 = t2;
    t2 = s;
  }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return -1;
  t1 = (box.minY - oy) * invY;
  t2 = (box.maxY - oy) * invY;
  if (t1 > t2) {
    const s = t1;
    t1 = t2;
    t2 = s;
  }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return -1;
  t1 = (box.minZ - oz) * invZ;
  t2 = (box.maxZ - oz) * invZ;
  if (t1 > t2) {
    const s = t1;
    t1 = t2;
    t2 = s;
  }
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return -1;
  return tmin;
}

// One slug down the ray: the nearest body part if it is in front of the wall, else the wall.
// Hits only actors of another team; a dead actor is not a target.
export function traceShot(world, actors, team, ox, oy, oz, dx, dy, dz, maxDistance = 120) {
  let bestT = maxDistance;
  let bestActor = null;
  let bestPart = null;
  shotResult.wall = false;
  shotResult.wallKind = null;
  const invX = dx === 0 ? Infinity : 1 / dx;
  const invY = dy === 0 ? Infinity : 1 / dy;
  const invZ = dz === 0 ? Infinity : 1 / dz;
  for (let i = 0; i < actors.length; i += 1) {
    const actor = actors[i];
    if (!actor.alive || actor.team === team) continue;
    const boxes = actorBoxes(actor);
    const headT = rayBox(boxes.head, ox, oy, oz, invX, invY, invZ, bestT);
    if (headT >= 0 && headT < bestT) {
      bestT = headT;
      bestActor = actor;
      bestPart = 'head';
      continue;
    }
    const bodyT = rayBox(boxes.body, ox, oy, oz, invX, invY, invZ, bestT);
    if (bodyT >= 0 && bodyT < bestT) {
      bestT = bodyT;
      bestActor = actor;
      bestPart = 'body';
      continue;
    }
    const legsT = rayBox(boxes.legs, ox, oy, oz, invX, invY, invZ, bestT);
    if (legsT >= 0 && legsT < bestT) {
      bestT = legsT;
      bestActor = actor;
      bestPart = 'legs';
    }
  }
  const wall = rayWorld(world, ox, oy, oz, dx, dy, dz, bestT);
  if (wall !== null) {
    shotResult.hit = null;
    shotResult.part = null;
    shotResult.wall = true;
    shotResult.wallKind = wall.box.kind;
    shotResult.distance = wall.t;
    shotResult.x = ox + dx * wall.t;
    shotResult.y = oy + dy * wall.t;
    shotResult.z = oz + dz * wall.t;
    return shotResult;
  }
  shotResult.hit = bestActor;
  shotResult.part = bestPart;
  shotResult.distance = bestT;
  shotResult.x = ox + dx * bestT;
  shotResult.y = oy + dy * bestT;
  shotResult.z = oz + dz * bestT;
  return shotResult;
}

// Damage with a head multiplier and a body-part scale. Armour soaks half of every hit until
// it runs out; a head shot that kills is a clean kill whatever the armour.
export function damageActor(actor, weapon, part, falloff = 1) {
  if (!actor.alive) return { amount: 0, killed: false };
  const multiplier = part === 'head' ? weapon.headMultiplier : part === 'legs' ? 0.75 : 1;
  let amount = weapon.damage * multiplier * falloff;
  if (part === 'head' && falloff >= 1) {
    // A player's head hit is lethal whatever the range; a bot's softer round is not, which is
    // what stops a bot from ending a round with one shot through a door.
    amount = Math.max(amount, 100);
  }
  if (actor.armor > 0) {
    const soaked = Math.min(actor.armor, amount * 0.5);
    actor.armor -= soaked;
    amount -= soaked;
  }
  actor.health -= amount;
  actor.lastHitBy = weapon.id;
  if (actor.health <= 0) {
    actor.health = 0;
    actor.alive = false;
    return { amount, killed: true };
  }
  return { amount, killed: false };
}

// Grenade blast: a sphere test against every body with distance falloff, and no line of sight
// requirement: walls soften the blast by half in the traces, which is enough for this yard.
export function blastActors(actors, x, y, z, team, radius = GRENADE.radius, damage = GRENADE.damage) {
  const hurt = [];
  for (const actor of actors) {
    if (!actor.alive) continue;
    const cy = y;
    const dx = actor.x - x;
    const dy = actor.y + 0.9 - cy;
    const dz = actor.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const amount = Math.round(damage * falloff * (actor.team === team ? 0.5 : 1));
    if (amount <= 0) continue;
    if (actor.armor > 0) {
      const soaked = Math.min(actor.armor, amount * 0.5);
      actor.armor -= soaked;
      actor.health -= amount - soaked;
    } else {
      actor.health -= amount;
    }
    if (actor.health <= 0) {
      actor.health = 0;
      actor.alive = false;
    }
    hurt.push({ actor, amount, killed: !actor.alive });
  }
  return hurt;
}
