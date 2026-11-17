// The player's body: acceleration, friction, crouch, jump, and collision against the map.
// Pure simulation, no three.js: the renderer reads this state and the tests step it directly.
import { WORLD, moveBody, overlapsAt, PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT } from './collision.js';
import { clamp } from './mathx.js';

export const MOVE = {
  run: 5.2,
  walk: 3.05,
  crouch: 2.35,
  groundAccel: 46,
  airAccel: 7,
  friction: 9.5,
  gravity: 21,
  jump: 6.3,
  eyeStand: 1.6,
  eyeCrouch: 1.02,
};

export function createPlayer(spawn = { x: 0, z: 16.5, yaw: Math.PI }) {
  return {
    id: 'player',
    name: 'YOU',
    team: 'attackers',
    x: spawn.x,
    y: 0,
    z: spawn.z,
    vy: 0,
    yaw: spawn.yaw,
    pitch: 0,
    eye: MOVE.eyeStand,
    crouching: false,
    height: STAND_HEIGHT,
    onGround: true,
    alive: true,
    health: 100,
    armor: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    speed: 0,
    firing: false,
    lastDamageAt: -10,
    stepPhase: 0,
  };
}

export function playerEyeY(player) {
  return player.y + player.eye;
}

export function playerAim(player) {
  const cp = Math.cos(player.pitch + player.recoilPitch);
  return {
    x: -Math.sin(player.yaw + player.recoilYaw) * cp,
    y: Math.sin(player.pitch + player.recoilPitch),
    z: -Math.cos(player.yaw + player.recoilYaw) * cp,
  };
}

// look deltas are in radians: the mouse handler scales pixels into radians before this.
export function lookPlayer(player, dYaw, dPitch) {
  player.yaw += dYaw;
  player.pitch = clamp(player.pitch + dPitch, -1.45, 1.45);
}

export function addRecoil(player, pitchKick, yawKick) {
  player.recoilPitch = clamp(player.recoilPitch + pitchKick, -0.2, 0.42);
  player.recoilYaw += yawKick;
}

// One fixed step of movement. `keys` is a Set of KeyboardEvent.code values; `walking` is the
// shift key. Recoil recovers toward zero at the weapon's rate, which the caller passes in.
export function stepPlayer(player, keys, dt, recoilRecover = 8) {
  if (!player.alive) return player;
  const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (crouchKey && !player.crouching) {
    player.crouching = true;
    player.height = CROUCH_HEIGHT;
  } else if (!crouchKey && player.crouching) {
    // Stand only when the taller body fits; otherwise stay crouched under the lintel.
    const probe = { x: player.x, y: player.y, z: player.z };
    const before = player.height;
    player.height = STAND_HEIGHT;
    const blocked = requireOverlap(probe);
    player.height = before;
    if (!blocked) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
  }
  const eyeTarget = player.crouching ? MOVE.eyeCrouch : MOVE.eyeStand;
  player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if (forward || strafe) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    wishX = -sin * forward + cos * strafe;
    wishZ = -cos * forward - sin * strafe;
    const len = Math.hypot(wishX, wishZ) || 1;
    wishX /= len;
    wishZ /= len;
  }
  const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const target = player.crouching ? MOVE.crouch : walking ? MOVE.walk : MOVE.run;
  const accel = player.onGround ? MOVE.groundAccel : MOVE.airAccel;
  const blend = Math.min(1, (accel * dt) / target);
  let vx = player.vx ?? 0;
  let vz = player.vz ?? 0;
  vx += (wishX * target - vx) * blend;
  vz += (wishZ * target - vz) * blend;
  if (player.onGround && !wishX && !wishZ) {
    const damp = Math.max(0, 1 - MOVE.friction * dt);
    vx *= damp;
    vz *= damp;
  }
  player.vx = vx;
  player.vz = vz;
  player.speed = Math.hypot(vx, vz);

  if (keys.has('Space') && player.onGround) {
    player.vy = MOVE.jump;
    player.onGround = false;
  }
  player.vy -= MOVE.gravity * dt;
  player.vy = Math.max(-32, player.vy);

  moveBody(WORLD, player, vx * dt, vz * dt, player.vy * dt, PLAYER_RADIUS, player.height);
  if (player.y <= 0.0001) player.y = 0;

  // Recoil settles: fast at first, then a slow tail, so a tap is back on target quickly.
  const settle = Math.min(1, dt * recoilRecover);
  player.recoilPitch += (0 - player.recoilPitch) * settle;
  player.recoilYaw += (0 - player.recoilYaw) * settle;
  player.stepPhase += player.speed * dt * 2.2;
  return player;
}

function requireOverlap(probe) {
  // The stand-up probe reuses the shared horizontal test, so it costs one pass over the solids.
  return overlapsAt(WORLD, probe.x, probe.y, probe.z, PLAYER_RADIUS, STAND_HEIGHT) !== null;
}
