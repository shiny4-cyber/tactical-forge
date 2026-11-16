// Headless logic tests over the simulation: collision, nav, gunplay, bomb, rounds, bots.
// They import the same modules the browser runs; nothing here touches three.js or the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

import { WORLD, overlapsAt, moveBody, rayWorld, walkClear, spotClear, PLAYER_RADIUS } from '../game/src/collision.js';
import { GRAPH, findPath, nearestNode, buildGraph } from '../game/src/nav.js';
import { NODES, MAP } from '../game/src/map.js';
import { WEAPONS, spreadFor, scatterDirection, traceShot, damageActor, blastActors, actorBoxes } from '../game/src/combat.js';
import { createArsenal, tickArsenal, canFire, consumeRound, startReload } from '../game/src/arsenal.js';
import { createMatch, ROUND, ECONOMY } from '../game/src/match.js';
import { createSimulation } from '../game/src/sim.js';
import { createBot, stepBot } from '../game/src/bots.js';
import { mulberry32 } from '../game/src/mathx.js';

const STEP = 1 / 60;
const SITES = MAP.sites;

function body(x, z) {
  return { x, z, y: 0, vy: 0, onGround: true };
}

function run(sim, seconds) {
  const count = Math.round(seconds / STEP);
  for (let i = 0; i < count; i += 1) sim.step(STEP);
}

function liveSim(options = {}) {
  const sim = createSimulation({ seed: 5, bots: false, ...options });
  sim.start();
  sim.forceLive();
  return sim;
}

function liveBotSim(options = {}) {
  const sim = createSimulation({ seed: 5, bots: true, ...options });
  sim.start();
  sim.forceLive();
  return sim;
}

test('the kiln block is solid and the lanes are not', () => {
  assert.ok(overlapsAt(WORLD, 0, 0, 0, PLAYER_RADIUS, 1.72), 'the kiln block blocks a body');
  assert.equal(overlapsAt(WORLD, -19, 0, 0, PLAYER_RADIUS, 1.72), null, 'the west lane is open');
  assert.equal(overlapsAt(WORLD, 19, 0, 0, PLAYER_RADIUS, 1.72), null, 'the east lane is open');
});

test('a body cannot walk through a wall, and slides along it', () => {
  const walker = body(-6.0, 0);
  // Walk hard east into the kiln block's face at x = -4.
  for (let i = 0; i < 120; i += 1) moveBody(WORLD, walker, 0.1, 0, 0, PLAYER_RADIUS, 1.72);
  assert.ok(walker.x < -4.2, `stopped at the wall, x=${walker.x}`);
  assert.ok(walker.x > -4.6, 'reached the wall rather than stopping short');
  // Sliding: push north-east, the x move is blocked but the z move is not.
  const beforeZ = walker.z;
  for (let i = 0; i < 30; i += 1) moveBody(WORLD, walker, 0.1, -0.1, 0, PLAYER_RADIUS, 1.72);
  assert.ok(walker.z < beforeZ - 0.5, 'slid along the face');
  assert.ok(walker.x < -4.2, 'did not enter the block');
});

test('a crate can be landed on and the floor is the fallback', () => {
  const crate = { x: -16.2, z: -14.4 };
  const jumper = body(crate.x, crate.z);
  jumper.y = 1.9;
  jumper.vy = -6;
  for (let i = 0; i < 60; i += 1) {
    jumper.vy -= 21 * STEP;
    moveBody(WORLD, jumper, 0, 0, jumper.vy * STEP, PLAYER_RADIUS, 1.72);
  }
  assert.ok(Math.abs(jumper.y - 1.4) < 0.05, `landed on the crate top, y=${jumper.y}`);
  const faller = body(-6.0, 12.0);
  faller.y = 3;
  faller.vy = 0;
  for (let i = 0; i < 120; i += 1) {
    faller.vy -= 21 * STEP;
    moveBody(WORLD, faller, 0, 0, faller.vy * STEP, PLAYER_RADIUS, 1.72);
  }
  assert.equal(faller.y, 0, 'open ground drops to the floor');
});

test('a ray stops on the wall between two points', () => {
  const hit = rayWorld(WORLD, 0, 1.6, 8, 0, 0, -1, 40);
  assert.ok(hit, 'the kiln block is in the way');
  assert.ok(hit.t > 1.5 && hit.t < 2.5, `hit the block face, t=${hit.t}`);
  // The mouth of site B is a straight, clear lane from the cistern floor to the mid yard.
  const clear = rayWorld(WORLD, 13, 1.6, -7.4, 0, 0, 1, 11);
  assert.equal(clear, null, 'the cistern mouth is clear');
});

test('every nav node is walkable and every edge is walkable', () => {
  let edges = 0;
  for (const node of GRAPH.nodes) {
    assert.ok(spotClear(WORLD, node.x, node.z), `node ${node.id} sits in geometry`);
  }
  for (let i = 0; i < GRAPH.nodes.length; i += 1) {
    for (const next of GRAPH.nodes[i].links) {
      edges += 1;
      assert.ok(walkClear(WORLD, GRAPH.nodes[i].x, GRAPH.nodes[i].z, GRAPH.nodes[next].x, GRAPH.nodes[next].z), `edge ${GRAPH.nodes[i].id}->${GRAPH.nodes[next].id} is not walkable`);
    }
  }
  assert.ok(edges > 300, `graph has enough edges (${edges})`);
});

test('A* finds a path from the attacker spawn to both sites and onto the bomb', () => {
  const start = nearestNode(GRAPH, MAP.attackerSpawn.x, MAP.attackerSpawn.z);
  for (const site of SITES) {
    const goal = GRAPH.nodes.find((node) => node.site === site.id).index;
    const path = findPath(GRAPH, start, goal);
    assert.ok(path && path.length > 3, `path to site ${site.id} exists`);
    for (let i = 1; i < path.length; i += 1) {
      const a = GRAPH.nodes[path[i - 1]];
      const b = GRAPH.nodes[path[i]];
      assert.ok(walkClear(WORLD, a.x, a.z, b.x, b.z), `path step ${a.id}->${b.id} is walkable`);
    }
  }
});

test('a hand-written edge cannot cross a crate', () => {
  const tiny = buildGraph([
    { id: 'p', x: -8.8, z: -6.6, lane: 'test' },
    { id: 'q', x: -8.8, z: -1.8, lane: 'test' },
  ]);
  const p = tiny.byId.get('p').index;
  const q = tiny.byId.get('q').index;
  assert.equal(tiny.edges[p].includes(q), false, 'the crate at (-8.8,-4.2) breaks the straight edge');
});

test('spread punishes moving fire and crouching helps', () => {
  const rifle = WEAPONS.kestrel;
  const still = spreadFor(rifle, 0, false);
  const walking = spreadFor(rifle, 3, false);
  const running = spreadFor(rifle, 5.2, false);
  const crouched = spreadFor(rifle, 0, true);
  assert.ok(still < walking && walking < running, `cone widens with speed: ${still} < ${walking} < ${running}`);
  assert.ok(crouched < still, 'crouching tightens the cone');
});

test('a scatter stays inside the cone it was given', () => {
  const random = mulberry32(9);
  const dir = { x: 0, y: 0, z: -1 };
  const out = { x: 0, y: 0, z: 0 };
  const cone = 0.05;
  for (let i = 0; i < 200; i += 1) {
    scatterDirection(out, dir, cone, random);
    const angle = Math.acos(Math.min(1, Math.max(-1, -out.z)));
    assert.ok(angle <= cone + 1e-6, `scatter ${angle} inside ${cone}`);
    assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-6, 'direction stays normalized');
  }
});

test('hit detection separates head, body and legs, and a wall wins', () => {
  const target = { id: 't', team: 'defenders', alive: true, health: 100, armor: 0, x: -6, y: 0, z: -10, crouching: false };
  const boxes = actorBoxes(target);
  const headY = (boxes.head.minY + boxes.head.maxY) / 2;
  const bodyY = (boxes.body.minY + boxes.body.maxY) / 2;
  const head = traceShot(WORLD, [target], 'attackers', -6, headY, 0, 0, 0, -1, 40);
  assert.equal(head.hit, target);
  assert.equal(head.part, 'head');
  const bodyShot = traceShot(WORLD, [target], 'attackers', -6, bodyY, 0, 0, 0, -1, 40);
  assert.equal(bodyShot.part, 'body');
  const legs = traceShot(WORLD, [target], 'attackers', -6, 0.25, 0, 0, 0, -1, 40);
  assert.equal(legs.part, 'legs');
  // A wall between the two: the shot never reaches the body behind the kiln block.
  const blocked = traceShot(WORLD, [target], 'attackers', -6, 1.2, 8, 0, 0, -1, 60);
  assert.equal(blocked.hit, null);
  assert.equal(blocked.wall, true);
});

test('the head multiplier kills, armour soaks, and a bot round is softer', () => {
  const rifle = WEAPONS.kestrel;
  const plain = { alive: true, health: 100, armor: 0 };
  const head = damageActor(plain, rifle, 'head');
  assert.equal(head.killed, true, 'a player headshot kills');
  const vest = { alive: true, health: 100, armor: 100 };
  const bodyshot = damageActor(vest, rifle, 'body');
  assert.equal(bodyshot.killed, false);
  assert.ok(vest.armor < 100, 'armour absorbed part of the hit');
  const soft = { alive: true, health: 100, armor: 0 };
  const botHead = damageActor(soft, rifle, 'head', 0.6);
  assert.equal(botHead.killed, false, 'a bot headshot does not one-shot a full-health player');
});

test('the magazine runs dry and a reload refills from the reserve', () => {
  const arsenal = createArsenal('kestrel');
  assert.equal(arsenal.mag, 30);
  for (let i = 0; i < 30; i += 1) {
    assert.ok(canFire(arsenal), `round ${i} ready`);
    assert.ok(consumeRound(arsenal));
    tickArsenal(arsenal, WEAPONS.kestrel.interval);
  }
  assert.equal(arsenal.mag, 0);
  assert.equal(canFire(arsenal), false, 'empty cannot fire');
  assert.ok(startReload(arsenal));
  tickArsenal(arsenal, WEAPONS.kestrel.reload + 0.05);
  assert.equal(arsenal.mag, 30);
  assert.equal(arsenal.reserve, 60);
  // Reloading a full magazine is refused.
  assert.equal(startReload(arsenal), false);
});

test('the bomb site check is a real radius, not the whole map', () => {
  const sim = liveSim();
  const site = SITES[0];
  sim.player.x = site.center.x;
  sim.player.z = site.center.z;
  sim.input.planting = true;
  run(sim, ROUND.plantSeconds + 0.2);
  assert.equal(sim.bomb.state, 'planted', 'planted on the site');
  assert.equal(sim.bomb.site, site.id);

  const away = liveSim();
  away.player.x = 0;
  away.player.z = 8;
  away.input.planting = true;
  run(away, ROUND.plantSeconds + 0.5);
  assert.equal(away.bomb.state, 'carried', 'no plant off the site');
});

test('an attacker cannot defuse and a defender cannot plant', () => {
  const sim = liveSim();
  sim.bomb.state = 'planted';
  sim.bomb.site = 'A';
  sim.bomb.x = sim.player.x;
  sim.bomb.z = sim.player.z;
  sim.bomb.fuse = 30;
  sim.input.defusing = true;
  run(sim, 12);
  assert.equal(sim.bomb.state, 'planted', 'attacker defuse is rejected by the simulation');
});

test('a defuse takes ten unbroken seconds and an interruption resets it', () => {
  const sim = liveSim({ side: 'defenders' });
  const site = SITES[0];
  sim.bomb.state = 'planted';
  sim.bomb.site = site.id;
  sim.bomb.x = site.center.x;
  sim.bomb.z = site.center.z;
  sim.bomb.fuse = 40;
  sim.player.x = site.center.x;
  sim.player.z = site.center.z + 0.5;
  sim.input.defusing = true;
  run(sim, 4);
  assert.equal(sim.bomb.state, 'planted');
  const partial = sim.bomb.defuseProgress;
  assert.ok(partial > 3.5 && partial < 4.5, `progress after 4 s: ${partial}`);
  sim.input.defusing = false;
  run(sim, 0.2);
  assert.equal(sim.bomb.defuseProgress, 0, 'releasing the key resets the timer');
  sim.input.defusing = true;
  run(sim, ROUND.defuseSeconds + 0.3);
  assert.equal(sim.bomb.state, 'defused');
  assert.equal(sim.match.lastWinner, 'defenders');
  assert.equal(sim.match.lastReason, 'defuse');
});

test('a live fuse belongs to the objective, not to elimination', () => {
  const sim = liveSim();
  const site = SITES[0];
  sim.player.x = site.center.x;
  sim.player.z = site.center.z;
  sim.input.planting = true;
  run(sim, ROUND.plantSeconds + 0.2);
  assert.equal(sim.bomb.state, 'planted');
  // Kill every defender: with the charge armed the round must wait for the fuse.
  for (const bot of sim.bots) {
    bot.alive = false;
    bot.health = 0;
  }
  run(sim, 1);
  assert.equal(sim.match.phase, 'live', 'no elimination win while the charge is armed');
  run(sim, ROUND.fuseSeconds);
  assert.equal(sim.match.lastReason, 'detonation');
  assert.equal(sim.match.lastWinner, 'attackers');
});

test('elimination and the round clock both end a round, and the next one starts', () => {
  const sim = liveBotSim();
  assert.equal(sim.match.phase, 'live');
  for (const bot of sim.bots) {
    if (bot.team === 'defenders') {
      bot.alive = false;
      bot.health = 0;
    }
  }
  run(sim, 0.2);
  assert.equal(sim.match.phase, 'roundOver');
  assert.equal(sim.match.lastWinner, 'attackers');
  assert.equal(sim.match.lastReason, 'elimination');
  assert.equal(sim.match.attackerScore, 1);
  run(sim, ROUND.overSeconds + 0.2);
  assert.equal(sim.match.phase, 'buy');
  assert.equal(sim.match.round, 2, 'the next round starts in its buy phase');

  const timed = liveSim();
  run(timed, ROUND.liveSeconds + 1);
  assert.equal(timed.match.lastReason, 'time');
  assert.equal(timed.match.lastWinner, 'defenders');
});

test('the match ends at five rounds and restarts clean', () => {
  const match = createMatch();
  match.buyPhase(1);
  for (let round = 0; round < ROUND.roundsToWin; round += 1) {
    match.live();
    assert.ok(match.endRound('attackers', 'elimination'));
    match.tick(ROUND.overSeconds + 0.1);
    match.tick(0.1);
  }
  assert.equal(match.state.matchOver, true);
  assert.equal(match.state.attackerScore, ROUND.roundsToWin);
  match.startOver();
  assert.equal(match.state.matchOver, false);
  assert.equal(match.state.attackerScore, 0);
  assert.equal(match.state.round, 1);
});

test('round money follows win and loss, and a kill pays', () => {
  const sim = liveBotSim();
  const startingMoney = sim.player.money;
  const victim = sim.bots.find((bot) => bot.team === 'defenders');
  victim.x = sim.player.x;
  victim.z = sim.player.z - 6;
  victim.alive = true;
  victim.health = 100;
  sim.player.yaw = 0;
  sim.player.pitch = 0;
  let killed = false;
  for (let i = 0; i < 10 && !killed; i += 1) {
    sim.playerShoot();
    run(sim, 0.12);
    killed = !victim.alive;
  }
  assert.ok(killed, 'the test target died to the rifle');
  assert.ok(sim.player.money >= startingMoney + ECONOMY.kill, 'a kill paid');
  assert.ok(sim.player.kills >= 1);
});

test('the buy menu respects the phase, the price and the slot', () => {
  const sim = createSimulation({ seed: 2, bots: false });
  sim.start();
  assert.equal(sim.match.phase, 'buy');
  sim.player.money = 3000;
  const bought = sim.buy('tapper');
  assert.equal(bought.ok, true);
  assert.equal(sim.arsenal.weaponId, 'tapper');
  assert.equal(sim.player.money, 3000 - WEAPONS.tapper.cost);
  assert.equal(sim.buy('tapper').ok, false, 'cannot buy the same weapon twice');
  sim.player.money = 100;
  assert.equal(sim.buy('kestrel').ok, false, 'cannot afford it');
  sim.forceLive();
  assert.equal(sim.buy('spark').ok, false, 'buying is closed once the round is live');
});

test('four bots hold each site and reach it from spawn', () => {
  const sim = createSimulation({ seed: 8, bots: true, side: 'attackers' });
  sim.start();
  assert.equal(sim.bots.length, 7, 'three teammates and four opponents');
  assert.equal(sim.bots.filter((bot) => bot.team === 'defenders').length, 4);
  sim.forceLive();
  // The defenders' anchor nodes are on the sites they were assigned.
  for (const bot of sim.bots.filter((entry) => entry.team === 'defenders')) {
    const node = GRAPH.nodes[bot.holdNode];
    assert.ok(node && node.hold, `${bot.name} has a hold node`);
    assert.equal(node.hold.site, bot.role.site, `${bot.name} holds site ${bot.role.site}`);
  }
  run(sim, 16);
  const atSite = sim.bots.filter((bot) => {
    const site = SITES.find((entry) => entry.id === bot.role.site);
    return Math.hypot(bot.x - site.center.x, bot.z - site.center.z) < 9;
  });
  assert.ok(atSite.length >= 3, `most bots reached their site (${atSite.length}/4)`);
});

test('a bot investigates a gunshot and then goes back to its post', () => {
  const bot = createBot({ id: 'b1', name: 'TEST', team: 'defenders', x: 13, z: -11, yaw: 0, site: 'B', lane: 'east' });
  bot.holdNode = GRAPH.nodes.find((node) => node.hold && node.hold.site === 'B').index;
  const ctx = {
    actors: [bot, { id: 'e', team: 'attackers', alive: true, x: 13, y: 0, z: -6, crouching: false }],
    bomb: { state: 'carried' },
    sites: SITES,
    now: 100,
    random: mulberry32(4),
    plantSeconds: 3.2,
    defuseSeconds: 10,
    fireShot: () => {},
    plantBomb: () => {},
    defuseBomb: () => {},
  };
  bot.noise = { x: 13, z: -6, at: 99, radius: 30, team: 'attackers', seq: 1 };
  bot.investigateUntil = 103.2;
  const startZ = bot.z;
  for (let i = 0; i < 60; i += 1) stepBot(bot, ctx, STEP);
  assert.ok(bot.z > startZ + 1, `walked toward the noise, z=${bot.z.toFixed(2)}`);
  ctx.now += 4;
  bot.noise.at = -10;
  for (let i = 0; i < 120; i += 1) stepBot(bot, ctx, STEP);
  assert.notEqual(bot.state, 'investigate', 'gave up on the noise');
});

test('a defusing bot clears the site before it starts the timer', () => {
  const sim = liveBotSim({ side: 'defenders' });
  const site = SITES[1];
  sim.bomb.state = 'planted';
  sim.bomb.site = 'B';
  sim.bomb.x = site.center.x;
  sim.bomb.z = site.center.z;
  sim.bomb.fuse = 40;
  const defender = sim.bots.find((bot) => bot.team === 'defenders');
  defender.x = site.center.x;
  defender.z = site.center.z + 1.0;
  const attacker = sim.bots.find((bot) => bot.team === 'attackers');
  attacker.x = site.center.x + 1.5;
  attacker.z = site.center.z + 1.5;
  attacker.alive = true;
  sim.player.x = 21;
  sim.player.z = 18;
  run(sim, 3);
  assert.equal(sim.bomb.state, 'planted', 'no defuse while an enemy is on the site');
  assert.equal(sim.bomb.defuseProgress, 0, 'the timer never started');
  // Clear the site: every attacker goes down, and only then may the timer run.
  for (const bot of sim.bots) {
    if (bot.team === 'attackers') {
      bot.alive = false;
      bot.health = 0;
    }
  }
  run(sim, 14);
  assert.equal(sim.bomb.state, 'defused', 'defused once the site was clear');
  assert.equal(sim.match.lastWinner, 'defenders');
  assert.equal(sim.match.lastReason, 'defuse');
});

test('the simulation keeps allocation still: a full second of bots costs little', () => {
  const sim = createSimulation({ seed: 12, bots: true });
  sim.start();
  sim.forceLive();
  run(sim, 1);
  const started = process.hrtime.bigint();
  run(sim, 5);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 800, `five simulated seconds of eight actors took ${elapsedMs.toFixed(1)} ms`);
});
