// A firearm's runtime state: the magazine, the reserve, the cooldown between shots, the reload
// and the trigger discipline. The weapon table lives in combat.js; this is the part that ticks.
import { WEAPONS } from './combat.js';

export function createArsenal(weaponId = 'kestrel') {
  const weapon = WEAPONS[weaponId];
  return {
    weaponId,
    mag: weapon.mag,
    reserve: weapon.reserve,
    cooldown: 0,
    reloadLeft: 0,
    lastShotAt: -10,
    shotsFired: 0,
    shotsHit: 0,
  };
}

export function giveWeapon(arsenal, weaponId) {
  const weapon = WEAPONS[weaponId];
  arsenal.weaponId = weaponId;
  arsenal.mag = weapon.mag;
  arsenal.reserve = weapon.reserve;
  arsenal.cooldown = 0;
  arsenal.reloadLeft = 0;
  arsenal.shotsFired = 0;
  arsenal.shotsHit = 0;
}

export function weaponOf(arsenal) {
  return WEAPONS[arsenal.weaponId];
}

export function tickArsenal(arsenal, dt) {
  arsenal.cooldown = Math.max(0, arsenal.cooldown - dt);
  if (arsenal.reloadLeft > 0) {
    arsenal.reloadLeft = Math.max(0, arsenal.reloadLeft - dt);
    if (arsenal.reloadLeft === 0) {
      const weapon = weaponOf(arsenal);
      const need = weapon.mag - arsenal.mag;
      const take = Math.min(need, arsenal.reserve);
      arsenal.mag += take;
      arsenal.reserve -= take;
    }
  }
}

export function canFire(arsenal) {
  return arsenal.mag > 0 && arsenal.cooldown === 0 && arsenal.reloadLeft === 0;
}

export function consumeRound(arsenal) {
  if (arsenal.mag <= 0) return false;
  arsenal.mag -= 1;
  arsenal.shotsFired += 1;
  arsenal.cooldown = weaponOf(arsenal).interval;
  return true;
}

export function startReload(arsenal) {
  const weapon = weaponOf(arsenal);
  if (arsenal.reloadLeft > 0) return false;
  if (arsenal.mag >= weapon.mag) return false;
  if (arsenal.reserve <= 0) return false;
  arsenal.reloadLeft = weapon.reload;
  return true;
}

export function refillAmmo(arsenal) {
  const weapon = weaponOf(arsenal);
  arsenal.mag = weapon.mag;
  arsenal.reserve = weapon.reserve;
  arsenal.reloadLeft = 0;
  arsenal.cooldown = 0;
}
