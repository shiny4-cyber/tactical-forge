// The simulation: one fixed step that moves every body, resolves every shot, ticks the bomb and
// the clock. The only module that knows the player and the bots at once; the renderer reads its
// state and drains its event queue.
import { createMatch, ROUND, ECONOMY, roundPayout } from './match.js';
import { createPlayer, stepPlayer, playerAim, playerEyeY, addRecoil } from './player.js';
import { createBot, resetBot, stepBot } from './bots.js';
import { createArsenal, tickArsenal, canFire, consumeRound, startReload, giveWeapon, weaponOf } from './arsenal.js';
import { WEAPONS, GRENADE, BUY_LIST, spreadFor, scatterDirection, traceShot, damageActor, blastActors } from './combat.js';
import { WORLD, groundAt } from './collision.js';
import { MAP } from './map.js';
import { GRAPH } from './nav.js';
import { mulberry32 } from './mathx.js';

const BOT_NAMES = {
  attackers: ['ASH', 'BRICK', 'COIL', 'DRIFT'],
  defenders: ['VANE', 'MOTH', 'RIDGE', 'SABLE'],
};

export function createSimulation(options = {}) {
  const seed = options.seed ?? 1;
  const withBots = options.bots !== false;
  const side = options.side === 'defenders' ? 'defenders' : 'attackers';
  const random = mulberry32(seed);

  const match = createMatch();
  const player = createPlayer(spawnFor(side, 0));
  player.team = side;
  const arsenal = createArsenal('kestrel');
  const bots = [];

  const sim = {
    seed,
    side,
    player,
    arsenal,
    bots,
    match: match.state,
    bomb: match.state.bomb,
    sites: MAP.sites,
    events: [],
    killFeed: [],
    noises: [],
    grenades: [],
    tracers: [],
    now: 0,
    roundSerial: 0,
    plantSeconds: ROUND.plantSeconds,
    defuseSeconds: ROUND.defuseSeconds,
    input: { keys: new Set(), firing: false, planting: false, defusing: false, walk: false },
    stats: { shots: 0, hits: 0, headshots: 0, damage: 0, kills: 0, deaths: 0, plants: 0, defuses: 0 },
  };

  const dirScratch = { x: 0, y: 0, z: 0 };
  const actorList = [player];
  let noiseSeq = 0;
  const NODE_INDEX = new Map();
  for (const node of GRAPH.nodes) NODE_INDEX.set(node.id, node.index);

  function emit(event) {
    sim.events.push(event);
    if (sim.events.length > 64) sim.events.shift();
  }

  function spawnFor(team, index) {
    const list = team === 'defenders' ? MAP.defenderSpawns : MAP.attackerSpawns;
    const point = list[index % list.length];
    return { x: point.x, z: point.z, yaw: team === 'defenders' ? 0 : Math.PI };
  }

  function makeBots() {
    bots.length = 0;
    const enemy = side === 'attackers' ? 'defenders' : 'attackers';
    const friendlyCount = 3;
    const enemyCount = 4;
    let serial = 0;
    const push = (team, index, role) => {
      const spawn = spawnFor(team, index);
      const id = `${team}-${serial}`;
      const name = BOT_NAMES[team][serial % 4];
      serial += 1;
      const holder = holdNodeFor(role.site);
      const bot = createBot({
        id,
        name,
        team,
        x: spawn.x,
        z: spawn.z,
        yaw: spawn.yaw,
        seed: serial * 7 + 3,
        site: role.site,
        lane: role.lane,
        holdNode: holder,
        holdYaw: holder >= 0 ? 0 : 0,
        weaponId: role.weapon ?? 'kestrel',
        armor: 0,
      });
      bot.role = role;
      bot.weaponId = role.weapon ?? 'kestrel';
      bot.mag = WEAPONS[bot.weaponId].mag;
      bot.reserve = WEAPONS[bot.weaponId].reserve;
      bots.push(bot);
      return bot;
    };
    // The player's team gets three bots; the other team four. Roles: site anchors and a roamer.
    if (enemy === 'defenders') {
      push('defenders', 0, { site: 'A', lane: 'west', weapon: 'kestrel' });
      push('defenders', 1, { site: 'A', lane: 'west', weapon: 'tapper' });
      push('defenders', 2, { site: 'B', lane: 'east', weapon: 'kestrel' });
      push('defenders', 3, { site: 'B', lane: 'east', weapon: 'marrow' });
      for (let i = 0; i < friendlyCount; i += 1) {
        push('attackers', i + 1, { site: i % 2 === 0 ? 'A' : 'B', lane: i % 2 === 0 ? 'west' : 'east', weapon: i === 0 ? 'tapper' : 'kestrel' });
      }
    } else {
      push('attackers', 0, { site: 'A', lane: 'west', weapon: 'kestrel' });
      push('attackers', 1, { site: 'A', lane: 'west', weapon: 'tapper' });
      push('attackers', 2, { site: 'B', lane: 'east', weapon: 'tapper' });
      push('attackers', 3, { site: 'B', lane: 'east', weapon: 'kestrel' });
      for (let i = 0; i < friendlyCount; i += 1) {
        push('defenders', i + 1, { site: i % 2 === 0 ? 'A' : 'B', lane: i % 2 === 0 ? 'west' : 'east', weapon: 'kestrel' });
      }
    }
  }

  // Site anchors: the first hold node that watches the site the role was given.
  function holdNodeFor(site) {
    for (const node of GRAPH.nodes) {
      if (node.hold && node.hold.site === site) return node.index;
    }
    return -1;
  }

  function resetRound() {
    const state = match.state;
    sim.bomb = state.bomb;
    const team = side;
    const spawn = spawnFor(team, 0);
    player.x = spawn.x;
    player.z = spawn.z;
    player.y = 0;
    player.vx = 0;
    player.vz = 0;
    player.vy = 0;
    player.yaw = spawn.yaw;
    player.pitch = 0;
    player.recoilPitch = 0;
    player.recoilYaw = 0;
    player.health = 100;
    player.alive = true;
    sim.playerAlive = true;
    player.crouching = false;
    player.height = 1.72;
    player.armor = 0;
    arsenal.mag = WEAPONS[arsenal.weaponId].mag;
    arsenal.reserve = WEAPONS[arsenal.weaponId].reserve;
    arsenal.reloadLeft = 0;
    if (state.round === 1) {
      player.money = ECONOMY.start;
      arsenal.weaponId = 'kestrel';
      giveWeapon(arsenal, 'kestrel');
      player.money = ECONOMY.start;
    }
    // The charge starts in the player's hands when they attack, else on an attacker bot.
    let carries = false;
    if (team === 'attackers') {
      carryBomb(player);
      carries = true;
    }
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const botSpawn = spawnFor(bot.team, i + 1);
      resetBot(bot, {
        x: botSpawn.x,
        z: botSpawn.z,
        yaw: botSpawn.yaw,
        armor: bot.armor,
        hasBomb: false,
        site: bot.role.site,
        lane: bot.role.lane,
      });
      bot.holdNode = NODE_INDEX.get(bot.role.site === 'A' ? 'a4' : 'b4') ?? -1;
      if (bot.team === 'attackers' && !carries && bot.alive) {
        carryBomb(bot);
        carries = true;
      }
    }
    // Bots of the player's team aim at their own site; the enemy split A/B.
    sim.grenades.length = 0;
    sim.tracers.length = 0;
    sim.noises.length = 0;
    sim.roundSerial = state.round;
    emit({ type: 'roundStart', round: state.round });
  }

  function carryBomb(actor) {
    const bomb = match.state.bomb;
    bomb.state = 'carried';
    bomb.carrier = actor.id;
    bomb.site = null;
    bomb.plantProgress = 0;
    bomb.defuseProgress = 0;
    bomb.fuse = 0;
    actor.hasBomb = true;
  }

  function dropBomb(actor) {
    const bomb = match.state.bomb;
    if (bomb.carrier !== actor.id) return;
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.x = actor.x;
    bomb.z = actor.z;
    actor.hasBomb = false;
    emit({ type: 'bombDropped', x: actor.x, z: actor.z });
  }

  function plantBomb(actor, site) {
    const bomb = match.state.bomb;
    if (match.state.phase !== 'live' || bomb.state === 'planted') return;
    if (actor.team !== 'attackers') return;
    bomb.state = 'planted';
    bomb.carrier = null;
    bomb.site = site.id;
    bomb.x = site.center.x + (actor.x - site.center.x) * 0.2;
    bomb.z = site.center.z + (actor.z - site.center.z) * 0.2;
    bomb.fuse = ROUND.fuseSeconds;
    bomb.plantedBy = actor.id;
    actor.hasBomb = false;
    match.event('bomb', `CINDER CHARGE PLANTED AT ${site.id}`);
    const planter = actor.id === 'player' ? player : bots.find((bot) => bot.id === actor.id);
    if (planter) planter.money = Math.min(ECONOMY.max, planter.money + ECONOMY.plant);
    if (actor.id === 'player') sim.stats.plants += 1;
    emit({ type: 'planted', x: bomb.x, z: bomb.z, site: site.id });
    pushNoise(bomb.x, bomb.z, 'plant', 40, 'attackers');
  }

  function defuseBomb(actor, complete) {
    const bomb = match.state.bomb;
    if (bomb.state !== 'planted') return;
    if (actor.team !== 'defenders') return;
    if (!complete) {
      emit({ type: 'defuseTick', progress: bomb.defuseProgress / ROUND.defuseSeconds });
      return;
    }
    bomb.state = 'defused';
    bomb.defuseProgress = ROUND.defuseSeconds;
    if (actor.id === 'player') sim.stats.defuses += 1;
    match.event('bomb', 'CINDER CHARGE DEFUSED');
    emit({ type: 'defused', x: bomb.x, z: bomb.z });
    endRoundWith('defenders', 'defuse');
  }

  function pushNoise(x, z, kind, radius, team) {
    noiseSeq += 1;
    sim.noises.push({ x, z, kind, radius, team, at: sim.now, seq: noiseSeq });
    // A shot is heard for a few seconds; older noise is history, not a destination.
    for (let i = sim.noises.length - 1; i >= 0; i -= 1) {
      if (sim.now - sim.noises[i].at > 3.0) sim.noises.splice(i, 1);
    }
    if (sim.noises.length > 32) sim.noises.shift();
  }

  function fireShot(actor, dx, dy, dz, offsetX = 0, offsetY = 0) {
    const eyeY = actor.y + (actor.crouching ? 1.02 : 1.6);
    const ax = dx + offsetX;
    const ay = dy + offsetY;
    const az = dz;
    const len = Math.hypot(ax, ay, az) || 1;
    const result = traceShot(WORLD, actors(), actor.team, actor.x, eyeY, actor.z, ax / len, ay / len, az / len, 120);
    emit({ type: 'shot', x: actor.x, y: eyeY, z: actor.z, tx: result.x, ty: result.y, tz: result.z, team: actor.team, id: actor.id, wall: result.wall });
    pushNoise(actor.x, actor.z, 'gunfire', 30, actor.team);
    if (result.hit) {
      // Bots hit softer than the player: the player's trigger is the game's skill expression,
      // the bots' is the pressure that makes it matter.
      const scale = actor.id === 'player' ? 1 : 0.6;
      const { killed } = damageActor(result.hit, WEAPONS[actor.weaponId] ?? WEAPONS.kestrel, result.part, scale);
      emit({ type: 'hit', x: result.x, y: result.y, z: result.z, part: result.part, killed, victim: result.hit.id, byPlayer: actor.id === 'player', onPlayer: result.hit.id === 'player' });
      if (actor.id === 'player') {
        sim.stats.hits += 1;
        if (result.part === 'head') sim.stats.headshots += 1;
        sim.stats.damage += result.part === 'head' ? 100 : 33;
        arsenal.shotsHit += 1;
      }
      if (killed) onKill(actor, result.hit, result.part);
      return true;
    }
    return false;
  }

  function onKill(killer, victim, part) {
    killer.kills = (killer.kills ?? 0) + 1;
    killer.money = Math.min(ECONOMY.max, (killer.money ?? 0) + ECONOMY.kill);
    victim.deaths = (victim.deaths ?? 0) + 1;
    if (victim.id === 'player') {
      sim.stats.deaths += 1;
      sim.playerAlive = false;
    }
    if (killer.id === 'player') sim.stats.kills += 1;
    dropBomb(victim);
    sim.killFeed.push({ killer: killer.name ?? 'YOU', victim: victim.name ?? 'YOU', weapon: (WEAPONS[killer.weaponId] ?? WEAPONS.kestrel).name, part, at: sim.now });
    if (sim.killFeed.length > 6) sim.killFeed.shift();
    emit({ type: 'kill', killer: killer.id, victim: victim.id, part });
    match.event('kill', `${killer.name ?? 'YOU'} > ${victim.name ?? 'YOU'}`);
  }

  function actors() {
    return actorList;
  }

  function endRoundWith(winner, reason) {
    const ended = match.endRound(winner, reason);
    if (!ended) return;
    emit({ type: 'roundEnd', winner, reason });
    // Round money is paid once, on the transition.
    const payout = roundPayout(match.state, player.team);
    player.money = Math.min(ECONOMY.max, player.money + payout);
    for (const bot of bots) bot.money = Math.min(ECONOMY.max, bot.money + roundPayout(match.state, bot.team));
  }

  function playerShoot() {
    if (!player.alive || match.state.phase !== 'live') return false;
    if (!canFire(arsenal)) {
      if (arsenal.mag === 0) startReload(arsenal);
      return false;
    }
    const weapon = weaponOf(arsenal);
    if (!consumeRound(arsenal)) return false;
    const aim = playerAim(player);
    const spread = spreadFor(weapon, player.speed, player.crouching);
    sim.stats.shots += 1;
    let lastTracerX = 0;
    let lastTracerY = 0;
    let lastTracerZ = 0;
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      scatterDirection(dirScratch, aim, spread, random);
      const eyeY = playerEyeY(player);
      const result = traceShot(WORLD, actors(), player.team, player.x, eyeY, player.z, dirScratch.x, dirScratch.y, dirScratch.z, 120);
      sim.tracers.push({ x: player.x, y: eyeY, z: player.z, tx: result.x, ty: result.y, tz: result.z, t: 0.06, team: player.team });
      lastTracerX = result.x;
      lastTracerY = result.y;
      lastTracerZ = result.z;
      if (result.hit) {
        const { killed } = damageActor(result.hit, weapon, result.part);
        sim.stats.hits += 1;
        if (result.part === 'head') sim.stats.headshots += 1;
        if (killed) onKill(player, result.hit, result.part);
        emit({ type: 'hit', x: result.x, y: result.y, z: result.z, part: result.part, killed, victim: result.hit.id, byPlayer: true, onPlayer: false });
      } else if (result.wall) {
        emit({ type: 'impact', x: result.x, y: result.y, z: result.z, kind: result.wallKind });
      }
    }
    addRecoil(player, weapon.recoilPitch * (player.crouching ? 0.8 : 1), (random() * 2 - 1) * weapon.recoilYaw);
    pushNoise(player.x, player.z, 'gunfire', 30, player.team);
    emit({
      type: 'shot',
      x: player.x,
      y: playerEyeY(player),
      z: player.z,
      tx: lastTracerX,
      ty: lastTracerY,
      tz: lastTracerZ,
      team: player.team,
      id: 'player',
    });
    return true;
  }

  function buy(itemId) {
    if (match.state.phase !== 'buy') return { ok: false, reason: 'buy phase closed' };
    const item = BUY_LIST.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, reason: 'unknown item' };
    if (player.money < item.cost) return { ok: false, reason: 'not enough money' };
    if (item.type === 'weapon') {
      if (arsenal.weaponId === itemId) return { ok: false, reason: 'already held' };
      player.money -= item.cost;
      giveWeapon(arsenal, itemId);
      emit({ type: 'buy', item: itemId });
      match.event('buy', `BOUGHT ${item.name}`);
      return { ok: true, item };
    }
    if (item.type === 'armor') {
      if (player.armor >= 100) return { ok: false, reason: 'vest already full' };
      player.money -= item.cost;
      player.armor = 100;
      emit({ type: 'buy', item: itemId });
      return { ok: true, item };
    }
    if (item.type === 'grenade') {
      if (player.grenades >= GRENADE.max) return { ok: false, reason: 'one grenade only' };
      player.money -= item.cost;
      player.grenades = 1;
      return { ok: true, item };
    }
    return { ok: false, reason: 'unhandled' };
  }

  function throwGrenade() {
    if (!player.alive || player.grenades <= 0 || match.state.phase !== 'live') return false;
    player.grenades -= 1;
    const aim = playerAim(player);
    sim.grenades.push({
      x: player.x + aim.x * 0.5,
      y: playerEyeY(player) - 0.1,
      z: player.z + aim.z * 0.5,
      vx: aim.x * 16,
      vy: aim.y * 16 + 3.4,
      vz: aim.z * 16,
      fuse: GRENADE.fuse,
      team: player.team,
      owner: 'player',
    });
    emit({ type: 'grenadeThrow' });
    return true;
  }

  function stepGrenades(dt) {
    for (let i = sim.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = sim.grenades[i];
      grenade.fuse -= dt;
      grenade.vy -= 21 * dt;
      grenade.x += grenade.vx * dt;
      grenade.y += grenade.vy * dt;
      grenade.z += grenade.vz * dt;
      const floor = groundAt(grenade.x, grenade.z);
      if (grenade.y <= floor + 0.12) {
        grenade.y = floor + 0.12;
        grenade.vy *= -0.42;
        grenade.vx *= 0.62;
        grenade.vz *= 0.62;
      }
      if (grenade.fuse <= 0) {
        sim.grenades.splice(i, 1);
        const hurt = blastActors(actors(), grenade.x, grenade.y, grenade.z, grenade.team);
        for (const entry of hurt) {
          if (!entry.actor.alive) {
            const killer = grenade.owner === 'player' ? player : bots.find((bot) => bot.id === grenade.owner) ?? player;
            onKill(killer, entry.actor, 'blast');
          }
        }
        emit({ type: 'explosion', x: grenade.x, y: grenade.y, z: grenade.z });
        pushNoise(grenade.x, grenade.z, 'explosion', 45, grenade.team);
      }
    }
  }

  function stepBomb(dt) {
    const bomb = match.state.bomb;
    const state = match.state;
    if (bomb.state === 'carried' && bomb.carrier === 'player') {
      if (state.phase === 'live' && sim.input.planting && player.alive) {
        const site = MAP.sites.find((entry) => Math.hypot(player.x - entry.center.x, player.z - entry.center.z) < entry.radius);
        if (site) {
          bomb.plantProgress += dt;
          emit({ type: 'plantTick', progress: bomb.plantProgress / ROUND.plantSeconds });
          if (bomb.plantProgress >= ROUND.plantSeconds) plantBomb(player, site);
        } else {
          bomb.plantProgress = 0;
        }
      } else {
        bomb.plantProgress = 0;
      }
    } else if (bomb.state === 'dropped') {
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'attackers') continue;
        if (Math.hypot(bot.x - bomb.x, bot.z - bomb.z) < 1.5) {
          carryBomb(bot);
          match.event('bomb', `${bot.name} HAS THE CINDER CHARGE`);
          break;
        }
      }
    } else if (bomb.state === 'planted') {
      bomb.fuse = Math.max(0, bomb.fuse - dt);
      // One defuse timer for the site, owned here: a bot only says it is working the charge
      // (state 'defuse', entered once the site is clear), so two bots cannot run two clocks.
      let worker = null;
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'defenders' || bot.state !== 'defuse') continue;
        if (Math.hypot(bot.x - bomb.x, bot.z - bomb.z) > 1.5) continue;
        worker = bot;
        break;
      }
      if (worker) {
        if (bomb.defuserId !== worker.id) {
          bomb.defuserId = worker.id;
          bomb.defuseProgress = 0;
        }
        bomb.defuseProgress += dt;
        emit({ type: 'defuseTick', progress: bomb.defuseProgress / ROUND.defuseSeconds });
        if (bomb.defuseProgress >= ROUND.defuseSeconds) defuseBomb(worker, true);
      } else if (bomb.defuserId && bomb.defuserId !== 'player') {
        bomb.defuserId = null;
        bomb.defuseProgress = 0;
      }
      // A charge defused this step must not also detonate: the first terminal state wins.
      if (bomb.state === 'planted' && bomb.fuse === 0) {
        bomb.state = 'detonated';
        const center = MAP.sites.find((entry) => entry.id === bomb.site)?.center ?? { x: bomb.x, y: 0, z: bomb.z };
        blastActors(actors(), center.x, 1.0, center.z, 'attackers', 9, 200);
        emit({ type: 'explosion', x: center.x, y: 1, z: center.z, big: true });
        match.event('bomb', 'CINDER CHARGE DETONATED');
        endRoundWith('attackers', 'detonation');
      }
    }
  }

  function playerDefuse(dt) {
    const bomb = match.state.bomb;
    if (bomb.state !== 'planted' || !player.alive) return;
    if (player.team !== 'defenders') return;
    if (sim.input.defusing && Math.hypot(player.x - bomb.x, player.z - bomb.z) < 1.5) {
      bomb.defuserId = 'player';
      bomb.defuseProgress = (bomb.defuseProgress ?? 0) + dt;
      if (bomb.defuseProgress >= ROUND.defuseSeconds) defuseBomb(player, true);
      else emit({ type: 'defuseTick', progress: bomb.defuseProgress / ROUND.defuseSeconds });
    } else if (bomb.defuserId === 'player') {
      // Letting go (or stepping off) costs the whole timer: the defuse is not resumable.
      bomb.defuseProgress = 0;
      bomb.defuserId = null;
    }
  }

  function checkRoundEnd() {
    const state = match.state;
    if (state.phase !== 'live') return;
    const bomb = state.bomb;
    if (bomb.state === 'planted' || bomb.state === 'detonated' || bomb.state === 'defused') return;
    // Elimination needs bodies: a practice round with no bots is decided by the clock.
    const attackersExist = actors().some((actor) => actor.team === 'attackers');
    const defendersExist = actors().some((actor) => actor.team === 'defenders');
    const attackersAlive = actors().some((actor) => actor.alive && actor.team === 'attackers');
    const defendersAlive = actors().some((actor) => actor.alive && actor.team === 'defenders');
    if (attackersExist && !attackersAlive) endRoundWith('defenders', 'elimination');
    else if (defendersExist && !defendersAlive) endRoundWith('attackers', 'elimination');
    else if (state.phaseTime <= 0) endRoundWith('defenders', 'time');
  }

  const botCtx = {
    actors: null,
    bomb: null,
    sites: MAP.sites,
    now: 0,
    random,
    plantSeconds: ROUND.plantSeconds,
    defuseSeconds: ROUND.defuseSeconds,
    fireShot: null,
    plantBomb: null,
    defuseBomb: null,
  };

  function step(dt) {
    sim.now += dt;
    const state = match.state;
    // A new round builds a new bomb; keep the handle the renderer holds pointing at it.
    sim.bomb = state.bomb;
    const transition = match.tick(dt);
    if (transition === 'buy' || transition === 'matchOver') {
      if (transition === 'buy') resetRound();
    }
    if (state.phase === 'buy') {
      tickArsenal(arsenal, dt);
      for (const bot of bots) bot.cooldown = Math.max(0, bot.cooldown - dt);
      sim.tracers.length = 0;
      return;
    }
    if (state.phase !== 'live') {
      for (const bot of bots) {
        bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      }
      stepGrenades(dt);
      return;
    }
    stepPlayer(player, sim.input.keys, dt, weaponOf(arsenal).recoilRecover);
    tickArsenal(arsenal, dt);
    if (player.alive && sim.input.firing && canFire(arsenal)) playerShoot();
    playerDefuse(dt);
    if (player.grenades > 0 && sim.input.throwGrenade) {
      sim.input.throwGrenade = false;
      throwGrenade();
    }

    botCtx.actors = actors();
    botCtx.bomb = state.bomb;
    botCtx.now = sim.now;
    botCtx.fireShot = fireShot;
    botCtx.plantBomb = (actor, site) => plantBomb(actor, site);
    botCtx.defuseBomb = (actor, complete) => defuseBomb(actor, complete);
    for (const bot of bots) {
      // Hearing: a noise of the other team's within its radius sends the bot to look. Noises
      // are pruned by age in the simulation, and each bot keeps the one it is chasing.
      if (!bot.noise && (bot.noiseUntil ?? 0) < sim.now) {
        for (let i = sim.noises.length - 1; i >= 0; i -= 1) {
          const noise = sim.noises[i];
          if (noise.team === bot.team) continue;
          if (bot.heardSeq === noise.seq) continue;
          if (Math.hypot(noise.x - bot.x, noise.z - bot.z) > noise.radius) continue;
          // Defenders do not abandon a planted site to chase a shot across the yard.
          if (bot.team === 'defenders' && state.bomb.state === 'planted') break;
          bot.noise = noise;
          bot.heardSeq = noise.seq;
          break;
        }
      }
      stepBot(bot, botCtx, dt);
      // Bots stand on the floor or on a crate, never inside one.
      bot.y = groundAt(bot.x, bot.z);
    }
    stepGrenades(dt);
    stepBomb(dt);
    if (state.bomb.state === 'defused' || state.bomb.state === 'detonated') {
      // endRoundWith already ran; nothing else to do this step.
    }
    checkRoundEnd();
    for (let i = sim.tracers.length - 1; i >= 0; i -= 1) {
      sim.tracers[i].t -= dt;
      if (sim.tracers[i].t <= 0) sim.tracers.splice(i, 1);
    }
  }

  function start() {
    match.buyPhase(1);
    resetRound();
    if (side === 'defenders') {
      // Defenders start on the site and the bomb is in an attacker bot's hands.
      player.x = MAP.defenderSpawn.x;
      player.z = MAP.defenderSpawn.z;
    }
  }

  if (withBots) {
    makeBots();
    actorList.length = 1;
    for (const bot of bots) actorList.push(bot);
  }

  sim.step = step;
  sim.start = start;
  sim.resetRound = resetRound;
  sim.fireShot = fireShot;
  sim.playerShoot = playerShoot;
  sim.buy = buy;
  sim.throwGrenade = throwGrenade;
  sim.playerAlive = true;
  sim.killFeed = sim.killFeed;
  sim.drainEvents = () => {
    if (sim.events.length === 0) return null;
    const out = sim.events.slice();
    sim.events.length = 0;
    return out;
  };
  sim.aliveCount = (team) => actors().filter((actor) => actor.alive && actor.team === team).length;
  sim.restart = () => {
    match.startOver();
    player.money = ECONOMY.start;
    resetRound();
  };
  sim.forceLive = () => {
    if (match.state.phase === 'buy') {
      match.state.phaseTime = 0;
      match.live();
      match.state.phaseSerial += 1;
      resetRound();
      // Keep the round's starting money: forceLive is a test/capture shortcut, not a new round.
    }
  };

  return sim;
}

export { MAP };
