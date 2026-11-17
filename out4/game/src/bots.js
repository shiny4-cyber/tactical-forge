// The bots: a nav-graph route per round, A* to the objective, a hold angle, hearing, sight,
// burst fire, cover while reloading, and an objective brain that plants and defuses. One state
// machine, one fixed step, no three.js: the simulation asks a bot to fire, so a round can run
// headless in a test.
import { GRAPH, nearestNode, findPath } from './nav.js';
import { WORLD, moveBody, segmentClear, walkClear, PLAYER_RADIUS, CROUCH_HEIGHT, STAND_HEIGHT } from './collision.js';
import { WEAPONS } from './combat.js';
import { clamp } from './mathx.js';

const SENSE_INTERVAL = 0.1;
const STUCK_CHECK = 1.0;
const WAYPOINT_REACHED = 0.75;
const SIGHT_RANGE = 46;
const FOV = Math.cos(1.35); // ~77 degrees either side of the nose

export const BOT_STATES = ['advance', 'hold', 'engage', 'investigate', 'reload', 'plant', 'defuse'];

export function createBot(spec) {
  return {
    id: spec.id,
    name: spec.name,
    team: spec.team,
    x: spec.x,
    y: 0,
    z: spec.z,
    vx: 0,
    vz: 0,
    vy: 0,
    yaw: spec.yaw,
    pitch: 0,
    eye: 1.6,
    crouching: false,
    height: STAND_HEIGHT,
    onGround: true,
    alive: true,
    health: 100,
    armor: spec.armor ?? 0,
    weaponId: spec.weaponId ?? 'kestrel',
    mag: WEAPONS[spec.weaponId ?? 'kestrel'].mag,
    reserve: WEAPONS[spec.weaponId ?? 'kestrel'].reserve,
    cooldown: 0,
    reloadLeft: 0,
    money: 800,
    kills: 0,
    state: 'advance',
    path: null,
    pathIndex: 0,
    goalNode: -1,
    holdNode: spec.holdNode ?? -1,
    holdYaw: spec.holdYaw ?? 0,
    site: spec.site ?? null,
    lane: spec.lane ?? 'west',
    targetId: null,
    targetVisible: false,
    focus: 0,
    reaction: 0,
    senseTimer: spec.seed ? spec.seed * 0.037 : 0,
    repathTimer: 0,
    stuckTimer: 0,
    lastX: spec.x,
    lastZ: spec.z,
    stepPhase: 0,
    hasBomb: spec.hasBomb ?? false,
    plantProgress: 0,
    defuseProgress: 0,
    noise: null,
    burst: 0,
    burstPause: 0,
    lastSeenAt: -99,
    aimJitterSeed: spec.seed ?? 1,
    jabber: 0,
    heardSeq: -1,
    investigateUntil: 0,
  };
}

export function resetBot(bot, spec) {
  bot.x = spec.x;
  bot.z = spec.z;
  bot.y = 0;
  bot.vx = 0;
  bot.vz = 0;
  bot.vy = 0;
  bot.yaw = spec.yaw;
  bot.pitch = 0;
  bot.alive = true;
  bot.health = 100;
  bot.armor = spec.armor ?? 0;
  bot.mag = WEAPONS[bot.weaponId].mag;
  bot.reserve = WEAPONS[bot.weaponId].reserve;
  bot.reloadLeft = 0;
  bot.cooldown = 0;
  bot.state = 'advance';
  bot.path = null;
  bot.pathIndex = 0;
  bot.targetId = null;
  bot.targetVisible = false;
  bot.focus = 0;
  bot.reaction = 0;
  bot.plantProgress = 0;
  bot.defuseProgress = 0;
  bot.hasBomb = spec.hasBomb ?? false;
  bot.noise = null;
  bot.crouching = false;
  bot.height = STAND_HEIGHT;
  bot.lastX = spec.x;
  bot.lastZ = spec.z;
  bot.stuckTimer = 0;
  bot.burst = 0;
  bot.burstPause = 0;
}

// A* toward a node, with the first step dropped when the bot already stands on it.
export function setGoal(bot, nodeIndex) {
  const start = nearestNode(GRAPH, bot.x, bot.z);
  if (start < 0 || nodeIndex < 0) return false;
  const path = findPath(GRAPH, start, nodeIndex);
  if (!path) return false;
  bot.path = path;
  bot.pathIndex = path.length > 1 ? 1 : 0;
  bot.goalNode = nodeIndex;
  bot.repathTimer = 0;
  return true;
}

function eyeOf(actor) {
  return { x: actor.x, y: actor.y + (actor.crouching ? 1.02 : 1.6), z: actor.z };
}

function canSee(from, to, range = SIGHT_RANGE) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > range) return 0;
  const eye = eyeOf(from);
  const targetEye = eyeOf(to);
  if (!segmentClear(WORLD, eye.x, eye.z, targetEye.x, targetEye.z, eye.y)) return 0;
  return distance;
}

// Closer and more centred wins, so a bot never spins between two enemies on each scan.
function pickTarget(bot, actors) {
  let best = null;
  let bestScore = Infinity;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  for (const actor of actors) {
    if (!actor.alive || actor.team === bot.team || actor.id === bot.id) continue;
    const distance = canSee(bot, actor);
    if (distance === 0) continue;
    const dx = (actor.x - bot.x) / (distance || 1);
    const dz = (actor.z - bot.z) / (distance || 1);
    const facing = dx * fx + dz * fz;
    if (facing < FOV && bot.state !== 'engage') continue;
    const score = distance * (2 - facing);
    if (score < bestScore) {
      bestScore = score;
      best = actor;
    }
  }
  return best;
}

function nearestCoverNode(bot) {
  let best = -1;
  let bestScore = Infinity;
  for (const node of GRAPH.nodes) {
    if (!node.hold) continue;
    const dx = node.x - bot.x;
    const dz = node.z - bot.z;
    const d = dx * dx + dz * dz;
    if (d > 144) continue;
    if (d < bestScore) {
      bestScore = d;
      best = node.index;
    }
  }
  return best;
}

function moveToward(bot, tx, tz, speed, dt) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) {
    bot.vx *= 0.8;
    bot.vz *= 0.8;
    return 0;
  }
  const wantX = (dx / distance) * speed;
  const wantZ = (dz / distance) * speed;
  const blend = Math.min(1, dt * 9);
  bot.vx += (wantX - bot.vx) * blend;
  bot.vz += (wantZ - bot.vz) * blend;
  moveBody(WORLD, bot, bot.vx * dt, bot.vz * dt, -1 * dt, PLAYER_RADIUS, bot.height);
  bot.stepPhase += Math.hypot(bot.vx, bot.vz) * dt * 2.2;
  return distance;
}

function faceToward(bot, tx, ty, tz, dt, turnRate = 7) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const wantYaw = Math.atan2(-dx, -dz);
  let delta = wantYaw - bot.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const step = clamp(delta, -turnRate * dt, turnRate * dt);
  bot.yaw += step;
  const eye = eyeOf(bot);
  const wantPitch = Math.atan2(ty - eye.y, Math.hypot(dx, dz) || 1);
  bot.pitch += clamp(wantPitch - bot.pitch, -turnRate * 0.6 * dt, turnRate * 0.6 * dt);
  return Math.abs(delta);
}

function followPath(bot, ctx, dt, speed) {
  // A detour is a short sideways walk out of a corner A* cannot see; it expires on its own.
  if (bot.detourUntil > ctx.now) {
    moveToward(bot, bot.detourX, bot.detourZ, speed, dt);
    faceToward(bot, bot.detourX, 1.4, bot.detourZ, dt, 5);
    return false;
  }
  if (!bot.path || bot.pathIndex >= bot.path.length) return true;
  const node = GRAPH.nodes[bot.path[bot.pathIndex]];
  const remaining = moveToward(bot, node.x, node.z, speed, dt);
  faceToward(bot, node.x, 1.4, node.z, dt, 5);
  if (remaining < WAYPOINT_REACHED) {
    bot.pathIndex += 1;
    if (bot.pathIndex >= bot.path.length) return true;
  }
  return false;
}

function startReload(bot) {
  if (bot.reloadLeft > 0 || bot.mag >= WEAPONS[bot.weaponId].mag || bot.reserve <= 0) return;
  bot.reloadLeft = WEAPONS[bot.weaponId].reload;
  bot.state = 'reload';
}

function think(bot, ctx, dt) {
  const { actors, now } = ctx;
  bot.senseTimer -= dt;
  if (bot.senseTimer <= 0) {
    bot.senseTimer = SENSE_INTERVAL;
    const found = pickTarget(bot, actors);
    if (found) {
      if (bot.targetId !== found.id) {
        bot.targetId = found.id;
        bot.reaction = 0.18 + ctx.random() * 0.22;
        bot.focus = 0;
      }
      bot.targetVisible = true;
      bot.lastSeenAt = now;
    } else {
      bot.targetVisible = false;
      if (bot.targetId && now - bot.lastSeenAt > 3) bot.targetId = null;
    }
  }
  const target = bot.targetId ? actors.find((actor) => actor.id === bot.targetId && actor.alive) : null;
  if (target) {
    bot.reaction = Math.max(0, bot.reaction - dt);
    bot.focus = Math.min(1, bot.focus + dt * 1.6);
  }
  return target;
}

function shootAt(bot, target, ctx, dt) {
  const weapon = WEAPONS[bot.weaponId];
  if (bot.reloadLeft > 0 || bot.cooldown > 0) return;
  if (bot.mag <= 0) {
    startReload(bot);
    return;
  }
  if (bot.reaction > 0) return;
  const eye = eyeOf(bot);
  const targetEye = eyeOf(target);
  const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
  if (distance > 30) return;
  // Bots aim for the chest and only sometimes for the head, and only up close: a bot that
  // headshots at 25 m through a door turns every round into a coin flip.
  const headAim = distance < 12 && bot.focus > 0.5 && ctx.random() < 0.22;
  faceToward(bot, target.x, targetEye.y - (headAim ? 0.05 : 0.36), target.z, dt, 9);
  const aimError = Math.atan2(Math.sin(target.x - bot.x), Math.cos(target.z - bot.z));
  if (Math.abs(aimError) > 0.35 && bot.focus < 0.4) return;
  // Spread: a first shot is loose, a tracked shot tightens, and range widens the cone.
  // A bot that has just seen you is dangerous, not clairvoyant: the cone starts wide and
  // only tightens after it has tracked you for a moment.
  const cone = (0.045 + (1 - bot.focus) * 0.02) + distance * 0.0012;
  const dx = -Math.sin(bot.yaw) * Math.cos(bot.pitch);
  const dy = Math.sin(bot.pitch);
  const dz = -Math.cos(bot.yaw) * Math.cos(bot.pitch);
  const jitter = ctx.random;
  const ox = (jitter() * 2 - 1) * cone;
  const oy = (jitter() * 2 - 1) * cone;
  ctx.fireShot(bot, dx, dy, dz, ox, oy);
  bot.mag -= 1;
  bot.cooldown = weapon.interval;
  bot.burst += 1;
  if (!weapon.auto) bot.cooldown += 0.18;
  if (bot.burst >= (distance > 18 ? 3 : 5)) {
    bot.burst = 0;
    bot.cooldown += 0.22 + ctx.random() * 0.2;
  }
}

// The attacker's objective brain: walk the lane, reach the site, plant, then hold the angle.
function attackerBrain(bot, ctx, dt) {
  const bomb = ctx.bomb;
  if (bomb.state === 'planted') {
    // After the plant the attackers hold the site rather than chase kills.
    const hold = siteHoldNode(bot.site) ?? bot.holdNode;
    if (hold >= 0 && bot.state !== 'hold' && bot.state !== 'engage') {
      if (setGoal(bot, hold)) bot.state = 'advance';
    }
    return;
  }
  if (!bot.hasBomb) {
    if (bot.state !== 'engage' && bot.state !== 'investigate') {
      const hold = siteHoldNode(bot.site);
      if (hold >= 0 && bot.goalNode !== hold) {
        if (setGoal(bot, hold)) bot.state = 'advance';
      }
    }
    return;
  }
  const site = ctx.sites.find((entry) => entry.id === bot.site);
  if (!site) return;
  const distance = Math.hypot(bot.x - site.center.x, bot.z - site.center.z);
  if (distance < site.radius) {
    bot.state = 'plant';
    bot.vx *= 0.7;
    bot.vz *= 0.7;
    faceToward(bot, site.center.x, 0.4, site.center.z, dt, 6);
    bot.plantProgress += dt;
    if (bot.plantProgress >= ctx.plantSeconds) {
      bot.plantProgress = 0;
      ctx.plantBomb(bot, site);
    }
    return;
  }
  if (bot.state !== 'engage' && bot.state !== 'investigate') {
    bot.state = 'advance';
    if (bot.goalNode < 0 || !bot.path) {
      setGoal(bot, siteNodeFor(bot.site));
    }
  }
}

function siteHoldNode(site) {
  for (const node of GRAPH.nodes) {
    if (node.hold && node.hold.site === site) return node.index;
  }
  return -1;
}

function siteNodeFor(site) {
  for (const node of GRAPH.nodes) if (node.site === site) return node.index;
  return -1;
}

// The defenders' brain: hold the site until the bomb is down, rotate, clear it, then defuse.
function defenderBrain(bot, ctx, dt) {
  const bomb = ctx.bomb;
  if (bomb.state === 'planted') {
    const distance = Math.hypot(bot.x - bomb.x, bot.z - bomb.z);
    const enemyNear = ctx.actors.some(
      (actor) => actor.alive && actor.team !== bot.team && Math.hypot(actor.x - bomb.x, actor.z - bomb.z) < 11,
    );
    if (distance < 1.5 && !enemyNear) {
      // The site is clear: work the charge. The ten-second timer lives in the simulation,
      // which owns one clock for the site rather than one per bot.
      bot.state = 'defuse';
      bot.vx *= 0.6;
      bot.vz *= 0.6;
      faceToward(bot, bomb.x, 0.3, bomb.z, dt, 6);
      bot.crouching = true;
      bot.height = CROUCH_HEIGHT;
      ctx.defuseBomb(bot, false);
      return;
    }
    if (bot.state === 'defuse') {
      bot.state = 'advance';
      bot.crouching = false;
      bot.height = STAND_HEIGHT;
    }
    if (bot.state !== 'engage') {
      const node = nearestNode(GRAPH, bomb.x, bomb.z);
      if (node >= 0 && bot.goalNode !== node) {
        if (setGoal(bot, node)) bot.state = 'advance';
      }
    }
    return;
  }
  if (bot.state !== 'engage' && bot.state !== 'investigate' && bot.state !== 'reload') {
    const hold = bot.holdNode >= 0 ? bot.holdNode : siteHoldNode(bot.site);
    if (hold >= 0 && bot.goalNode !== hold) {
      if (setGoal(bot, hold)) bot.state = 'advance';
    }
  }
}

function investigate(bot, ctx, dt) {
  if (!bot.noise) return false;
  const age = ctx.now - bot.noise.at;
  const distance = Math.hypot(bot.x - bot.noise.x, bot.z - bot.noise.z);
  // A noise is worth a few seconds, not a round: arrive, or give up and go back to the role.
  // Without the deadline a bot re-hears the same shot forever and never leaves the lane.
  if (age > 3 || distance < 1.8 || ctx.now > bot.investigateUntil) {
    bot.noise = null;
    bot.noiseUntil = ctx.now + 2.0;
    bot.state = 'advance';
    const roleNode = bot.team === 'attackers' ? siteHoldNode(bot.role?.site ?? 'A') : bot.holdNode;
    if (roleNode >= 0) setGoal(bot, roleNode);
    return false;
  }
  const node = nearestNode(GRAPH, bot.noise.x, bot.noise.z);
  if (node >= 0 && bot.goalNode !== node && bot.repathTimer <= 0) {
    setGoal(bot, node);
    bot.repathTimer = 0.5;
  }
  followPath(bot, ctx, dt, 3.6);
  return true;
}

export function stepBot(bot, ctx, dt) {
  if (!bot.alive) {
    bot.state = 'dead';
    return;
  }
  bot.cooldown = Math.max(0, bot.cooldown - dt);
  if (bot.reloadLeft > 0) {
    bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
    if (bot.reloadLeft === 0) {
      const weapon = WEAPONS[bot.weaponId];
      const need = weapon.mag - bot.mag;
      const take = Math.min(need, bot.reserve);
      bot.mag += take;
      bot.reserve -= take;
    }
  }
  if (bot.repathTimer > 0) bot.repathTimer -= dt;

  const target = think(bot, ctx, dt);

  // Gunfire outranks the route; an empty magazine sends the bot to cover to reload.
  if (target && bot.reloadLeft === 0) {
    if (bot.state === 'defuse') bot.defuseProgress = 0;
    bot.state = 'engage';
    const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
    if (distance > 7 && bot.mag > 0) moveToward(bot, target.x, target.z, 3.2, dt);
    else {
      bot.vx *= 0.75;
      bot.vz *= 0.75;
      moveBody(WORLD, bot, bot.vx * dt, bot.vz * dt, -dt, PLAYER_RADIUS, bot.height);
    }
    shootAt(bot, target, ctx, dt);
    if (bot.mag === 0) {
      const cover = nearestCoverNode(bot);
      if (cover >= 0) setGoal(bot, cover);
      startReload(bot);
    }
    checkStuck(bot, ctx, dt);
    return;
  }
  if (bot.mag === 0 && bot.reloadLeft === 0) {
    const cover = nearestCoverNode(bot);
    if (cover >= 0 && bot.state !== 'advance') setGoal(bot, cover);
    startReload(bot);
  }

  if (bot.reloadLeft > 0) {
    bot.state = 'reload';
    bot.crouching = true;
    bot.height = CROUCH_HEIGHT;
  } else if (bot.crouching && bot.state !== 'defuse') {
    bot.crouching = false;
    bot.height = STAND_HEIGHT;
  }

  if (bot.state === 'reload') {
    const cover = nearestCoverNode(bot);
    if (cover >= 0) {
      if (!bot.path || bot.goalNode !== cover) setGoal(bot, cover);
      followPath(bot, ctx, dt, 3.0);
    }
    checkStuck(bot, ctx, dt);
    return;
  }

  if (!bot.targetVisible && bot.noise && bot.state !== 'plant' && bot.state !== 'defuse') {
    bot.state = 'investigate';
    // The deadline is set when the noise is taken, not every step, or the bot never gives up.
    if (!bot.investigateUntil || bot.investigateUntil < ctx.now - 6) bot.investigateUntil = ctx.now + 3.2;
    const busy = investigate(bot, ctx, dt);
    checkStuck(bot, ctx, dt);
    // A noise the bot has just reached is spent; carry on with the round this same step.
    if (busy) return;
  }

  if (bot.team === 'attackers') attackerBrain(bot, ctx, dt);
  else defenderBrain(bot, ctx, dt);

  if (bot.state === 'advance') {
    if (followPath(bot, ctx, dt, bot.crouching ? 2.2 : 4.3)) {
      bot.state = bot.team === 'attackers' ? 'hold' : 'hold';
      bot.vx *= 0.5;
      bot.vz *= 0.5;
    }
  } else if (bot.state === 'hold') {
    // Settle drift plus a scan of the angle this node watches.
    bot.vx *= 0.85;
    bot.vz *= 0.85;
    moveBody(WORLD, bot, bot.vx * dt, bot.vz * dt, -dt, PLAYER_RADIUS, bot.height);
    const node = GRAPH.nodes[bot.holdNode >= 0 ? bot.holdNode : bot.goalNode];
    const watchYaw = node && node.hold ? node.hold.yaw : bot.holdYaw;
    const sway = Math.sin(ctx.now * 0.7 + bot.aimJitterSeed) * 0.18;
    faceToward(bot, bot.x - Math.sin(watchYaw + sway), 1.5, bot.z - Math.cos(watchYaw + sway), dt, 2.2);
  }
  checkStuck(bot, ctx, dt);
}

function checkStuck(bot, ctx, dt) {
  bot.stuckTimer += dt;
  if (bot.stuckTimer < STUCK_CHECK) return;
  const moved = Math.hypot(bot.x - bot.lastX, bot.z - bot.lastZ);
  bot.lastX = bot.x;
  bot.lastZ = bot.z;
  bot.stuckTimer = 0;
  if (moved > 0.35) {
    bot.stuckCount = 0;
    return;
  }
  // A detour beats a re-path when the re-path is the same path: step sideways out of the
  // corner, then let A* run again from the new spot.
  bot.stuckCount = (bot.stuckCount ?? 0) + 1;
  const goal = GRAPH.nodes[bot.goalNode];
  let px = 0;
  let pz = 0;
  if (goal) {
    const gx = goal.x - bot.x;
    const gz = goal.z - bot.z;
    const len = Math.hypot(gx, gz) || 1;
    const side = bot.stuckCount % 2 === 0 ? 1 : -1;
    px = (-gz / len) * side * 2.4;
    pz = (gx / len) * side * 2.4;
  } else {
    px = Math.sin(bot.yaw + Math.PI / 2) * 2.4;
    pz = Math.cos(bot.yaw + Math.PI / 2) * 2.4;
  }
  if (walkClear(WORLD, bot.x, bot.z, bot.x + px, bot.z + pz)) {
    bot.detourX = bot.x + px;
    bot.detourZ = bot.z + pz;
    bot.detourUntil = ctx.now + 1.1;
  }
  // A third of a metre in a second while walking: re-path, then step sideways if that repeats.
  if (bot.goalNode >= 0) {
    if (!setGoal(bot, bot.goalNode) || bot.pathIndex >= (bot.path?.length ?? 0)) {
      const node = nearestNode(GRAPH, bot.x + Math.sin(bot.yaw) * -2, bot.z + Math.cos(bot.yaw) * -2);
      if (node >= 0) setGoal(bot, node);
    }
  }
  // A nudge sideways so two bots shoulder to shoulder do not lock.
  bot.x += Math.sin(ctx.now + bot.aimJitterSeed) * 0.12;
  bot.z += Math.cos(ctx.now * 1.3 + bot.aimJitterSeed) * 0.12;
}
