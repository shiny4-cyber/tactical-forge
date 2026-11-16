// Boot and the loop. One fixed-step simulation (60 Hz) drives every system below it; the
// renderer reads that state once per animation frame and draws it. No gameplay decision is
// made here except the ones a player makes: where to point, when to fire, what to buy.
import * as THREE from 'three';
import { createSimulation } from './sim.js';
import { createWorldView } from './render/worldview.js';
import { createActorView, createViewmodel } from './render/actors.js';
import { createEffects } from './render/effects.js';
import { createPropsView } from './render/props.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { WEAPONS, spreadFor } from './combat.js';
import { MAP } from './map.js';
import { ROUND } from './match.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 5;
const LOOK_SENSITIVITY = 0.0022;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '3', 10) || 3;
const side = params.get('side') === 'defenders' ? 'defenders' : 'attackers';
const noBots = params.get('nobots') === '1';
const fastBuy = params.get('fast') === '1';

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorldView(scene);
const effects = createEffects(scene);
const props = createPropsView(scene);
const viewmodel = createViewmodel(camera);
const hud = createHud();
const audio = createAudio();

const sim = createSimulation({ seed, bots: !noBots, side });
sim.start();
if (fastBuy) sim.match.phaseTime = 0.6;

const actorViews = sim.bots.map((bot) => createActorView(scene, bot));
const input = createInput(renderer.domElement, { onLockChange });
const clock = { last: performance.now(), accumulator: 0 };
let frozen = shotName !== null;
let lastPhaseSerial = sim.match.phaseSerial;
let lastHealth = sim.player.health;
let bannerUntil = 0;
let cameraShake = 0;
let shopOpen = false;

function spawnCopy(sideName) {
  return sideName === 'defenders' ? 'You are a WARDEN: hold a site, stop the plant, defuse the charge.' : 'You are a PACKER: take a lane, plant the charge at A or B.';
}

document.getElementById('start-copy').textContent = `${spawnCopy(sim.side)} First to ${ROUND.roundsToWin} rounds.`;

function onLockChange(locked) {
  if (shotName) return;
  if (locked) {
    hud.hideStart();
    audio.unlock();
  } else if (!hud.startOpen() && sim.match.phase !== 'matchOver') {
    hud.showStart();
  }
}

function bindInput() {
  input.onPress('KeyR', () => {
    if (sim.match.phase === 'live') startReload();
  });
  input.onPress('KeyB', () => {
    if (sim.match.phase !== 'buy') return;
    shopOpen = !shopOpen;
    if (shopOpen) hud.showBuy(sim.player.money, buyItem);
    else hud.hideBuy();
  });
  input.onPress('Escape', () => {
    if (shopOpen) {
      shopOpen = false;
      hud.hideBuy();
    }
  });
  input.onPress('KeyG', () => {
    if (sim.match.phase === 'live' && sim.player.grenades > 0) sim.throwGrenade();
  });
  input.onPress('KeyM', () => audio.toggleMute());
  input.onPress('Enter', () => {
    if (sim.match.phase === 'matchOver') restartMatch();
  });
}
bindInput();

function startReload() {
  if (sim.arsenal.reloadLeft > 0) return;
  if (sim.arsenal.mag >= WEAPONS[sim.arsenal.weaponId].mag) return;
  if (sim.arsenal.reserve <= 0) return;
  sim.arsenal.reloadLeft = WEAPONS[sim.arsenal.weaponId].reload;
  audio.reload();
}

function buyItem(id) {
  const result = sim.buy(id);
  if (result.ok) {
    audio.click();
    hud.showBuy(sim.player.money, buyItem);
    if (id === 'pitch') hud.banner('PITCH FRAG', 'G throws it. One per round.', 2.4);
  } else {
    hud.banner('CANNOT BUY', result.reason.toUpperCase(), 1.6);
  }
}

function restartMatch() {
  sim.restart();
  hud.hideBanner();
  hud.hideBuy();
  shopOpen = false;
  lastPhaseSerial = sim.match.phaseSerial;
}

document.getElementById('start-button').addEventListener('click', () => {
  audio.unlock();
  input.requestLock();
});
for (const button of document.querySelectorAll('[data-side]')) {
  button.addEventListener('click', () => {
    const next = button.dataset.side;
    if (next === sim.side) return;
    // Switching sides restarts the match on a fresh simulation with the same seed.
    window.location.search = `?side=${next}${fastBuy ? '&fast=1' : ''}${noBots ? '&nobots=1' : ''}`;
  });
}
hud.setSide(sim.side);

function syncCamera() {
  const player = sim.player;
  const shake = cameraShake > 0 ? (Math.random() - 0.5) * cameraShake : 0;
  camera.position.set(player.x, player.y + player.eye, player.z);
  camera.rotation.set(player.pitch + player.recoilPitch + shake, player.yaw + player.recoilYaw, 0);
  if (!player.alive) {
    camera.position.y = player.y + 0.4;
    camera.rotation.x = -0.25;
  }
}

function handleEvents(events) {
  if (!events) return;
  effects.handle(events);
  for (const event of events) {
    if (event.type === 'shot') {
      if (event.id === 'player') {
        const weapon = WEAPONS[sim.arsenal.weaponId];
        audio.shot(weapon.kind);
        viewmodel.fire();
        cameraShake = 0.006;
      } else if (event.team !== sim.player.team) {
        audio.enemyShot();
      }
    } else if (event.type === 'hit') {
      if (event.byPlayer) {
        hud.hitMarker(event.killed);
        if (event.part === 'head') audio.headshot();
        else audio.hit();
      }
      const view = actorViews.find((entry) => entry.actor.id === event.victim);
      if (view) view.hit();
      if (event.onPlayer) {
        hud.damage();
        audio.hurt();
        cameraShake = 0.02;
      }
    } else if (event.type === 'explosion') {
      audio.explosion();
      cameraShake = 0.05;
      const distance = Math.hypot(event.x - sim.player.x, event.z - sim.player.z);
      if (distance < 20) hud.damage();
    } else if (event.type === 'planted') {
      audio.plant();
    } else if (event.type === 'defused') {
      audio.defuse();
    } else if (event.type === 'kill') {
      hud.flashFeed();
    }
  }
}

function consumeState() {
  syncCamera();
  for (const view of actorViews) view.update(FIXED_STEP, sim.now);
  props.update(FIXED_STEP, sim.bomb, sim.grenades);
  viewmodel.update(FIXED_STEP, sim.player, sim.arsenal);
  hud.update(sim);
  hud.renderFeed(sim.killFeed);
  hud.setSpread(spreadFor(WEAPONS[sim.arsenal.weaponId], sim.player.speed, sim.player.crouching));
  cameraShake *= 0.86;
}

function reactToPhase() {
  const match = sim.match;
  if (match.phaseSerial === lastPhaseSerial) return;
  lastPhaseSerial = match.phaseSerial;
  if (match.phase === 'buy') {
    hud.hideBanner();
    shopOpen = true;
    hud.showBuy(sim.player.money, buyItem);
    hud.banner(`ROUND ${match.round}`, 'BUY PHASE · B CLOSES THE SHOP', 3);
  } else if (match.phase === 'live') {
    hud.hideBuy();
    shopOpen = false;
    hud.hideBanner();
  } else if (match.phase === 'roundOver') {
    const won = match.lastWinner === sim.player.team;
    const winnerName = match.lastWinner === 'attackers' ? 'PACKERS' : 'WARDENS';
    hud.banner(`${winnerName} WIN`, `${match.lastReason.toUpperCase()} · ${match.attackerScore} — ${match.defenderScore}`, ROUND.overSeconds);
    if (won) audio.win();
    else audio.lose();
    input.exitLock();
  } else if (match.phase === 'matchOver') {
    const won = (sim.player.team === 'attackers' ? match.attackerScore : match.defenderScore) > (sim.player.team === 'attackers' ? match.defenderScore : match.attackerScore);
    hud.banner(won ? 'MATCH WON' : 'MATCH LOST', `${match.attackerScore} — ${match.defenderScore} · PRESS ENTER OR CLICK TO PLAY AGAIN`, 0);
  }
}

function updatePlayerInput() {
  const player = sim.player;
  const look = input.takeLook();
  if (input.state.locked && player.alive) {
    player.yaw -= look.x * LOOK_SENSITIVITY;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * LOOK_SENSITIVITY));
  }
  const keys = new Set();
  if (input.state.locked) {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ShiftLeft']) {
      if (input.state.keys.has(code)) keys.add(code);
    }
  }
  sim.input.keys = keys;
  sim.input.firing = input.state.locked && input.state.firing && player.alive;
  sim.input.planting = input.state.keys.has('KeyE') && player.alive;
  sim.input.defusing = input.state.keys.has('KeyE') && player.alive;
  if (sim.input.firing && sim.match.phase === 'live') {
    if (sim.arsenal.reloadLeft > 0) sim.input.firing = false;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min((now - clock.last) / 1000, 0.1);
  clock.last = now;
  if (frozen) {
    syncCamera();
    renderer.render(scene, camera);
    return;
  }
  if (sim.player.alive === false && lastHealth > 0) {
    hud.banner('ELIMINATED', 'SPECTATING · THE ROUND PLAYS OUT', 3);
    input.exitLock();
  }
  lastHealth = sim.player.health;
  updatePlayerInput();
  clock.accumulator += delta;
  let steps = 0;
  while (clock.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
    sim.step(FIXED_STEP);
    clock.accumulator -= FIXED_STEP;
    steps += 1;
    handleEvents(sim.drainEvents());
    reactToPhase();
  }
  if (clock.accumulator > FIXED_STEP * 8) clock.accumulator = 0;
  consumeState();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------------------------
// Test and capture hooks. They are the same calls the loop makes, so a capture cannot show a
// state the game would not reach; they exist so a headless browser can drive time explicitly.
// ---------------------------------------------------------------------------------------------
function advance(seconds) {
  const count = Math.max(1, Math.round(seconds / FIXED_STEP));
  for (let i = 0; i < count; i += 1) {
    sim.step(FIXED_STEP);
    handleEvents(sim.drainEvents());
    reactToPhase();
  }
  consumeState();
}

window.__debug = () => ({
  phase: sim.match.phase,
  round: sim.match.round,
  timer: Number(sim.match.phaseTime.toFixed(2)),
  score: { attackers: sim.match.attackerScore, defenders: sim.match.defenderScore },
  player: {
    team: sim.player.team,
    alive: sim.player.alive,
    hp: Math.round(sim.player.health),
    armor: Math.round(sim.player.armor),
    x: Number(sim.player.x.toFixed(2)),
    z: Number(sim.player.z.toFixed(2)),
    yaw: Number(sim.player.yaw.toFixed(3)),
    money: sim.player.money,
  },
  ammo: { mag: sim.arsenal.mag, reserve: sim.arsenal.reserve, weapon: sim.arsenal.weaponId, reloading: sim.arsenal.reloadLeft > 0 },
  bomb: { state: sim.bomb.state, site: sim.bomb.site, fuse: Number(sim.bomb.fuse.toFixed(2)), carrier: sim.bomb.carrier, defuse: Number((sim.bomb.defuseProgress ?? 0).toFixed(2)) },
  result: { winner: sim.match.lastWinner, reason: sim.match.lastReason },
  roundOver: sim.match.phase === 'roundOver',
  matchOver: sim.match.phase === 'matchOver',
  bots: sim.bots.map((bot) => ({ id: bot.id, name: bot.name, team: bot.team, alive: bot.alive, hp: Math.round(bot.health), x: Number(bot.x.toFixed(2)), z: Number(bot.z.toFixed(2)), state: bot.state })),
  stats: sim.stats,
});
window.__advance = (seconds) => {
  advance(seconds);
  renderer.render(scene, camera);
  return window.__debug();
};
window.__tp = (x, z, yaw = sim.player.yaw, pitch = 0) => {
  sim.player.x = x;
  sim.player.z = z;
  sim.player.y = 0;
  sim.player.yaw = yaw;
  sim.player.pitch = pitch;
  sim.player.vx = 0;
  sim.player.vz = 0;
  consumeState();
  renderer.render(scene, camera);
};
window.__key = (code, down) => {
  if (down) input.press(code);
  else input.release(code);
};
window.__fire = (shots = 1) => {
  for (let i = 0; i < shots; i += 1) {
    if (!sim.playerShoot()) break;
    sim.step(FIXED_STEP);
  }
  handleEvents(sim.drainEvents());
  consumeState();
  renderer.render(scene, camera);
  return { mag: sim.arsenal.mag, reserve: sim.arsenal.reserve };
};
window.__buy = (id) => {
  const result = sim.buy(id);
  consumeState();
  renderer.render(scene, camera);
  return result;
};
// Plant and defuse are the same key in the game; these hooks hold it for a test. They press
// the real key as well, so the loop's own input mapping keeps agreeing with the hook.
function holdInteract(down) {
  if (down) input.press('KeyE');
  else input.release('KeyE');
  sim.input.planting = down;
  sim.input.defusing = down;
  return sim.bomb.state;
}
window.__plant = (hold) => holdInteract(hold);
window.__defuse = (hold) => holdInteract(hold);
// Test fixture: arm the charge at a site so a defuse can be exercised without a live plant.
// Nothing in the game calls it; it is the same state a successful plant produces.
window.__armBomb = (siteId = 'A') => {
  const site = MAP.sites.find((entry) => entry.id === siteId) ?? MAP.sites[0];
  sim.match.phase = 'live';
  sim.bomb.state = 'planted';
  sim.bomb.site = site.id;
  sim.bomb.x = site.center.x;
  sim.bomb.z = site.center.z;
  sim.bomb.fuse = ROUND.fuseSeconds;
  sim.bomb.carrier = null;
  sim.bomb.defuseProgress = 0;
  sim.bomb.defuserId = null;
  consumeState();
  return { state: sim.bomb.state, site: site.id, fuse: sim.bomb.fuse };
};
window.__reload = () => {
  startReload();
  return sim.arsenal.reloadLeft;
};
window.__startMatch = () => {
  hud.hideStart();
};
window.__side = () => sim.side;
window.__shotReady = false;
window.__captureInfo = null;

// ---------------------------------------------------------------------------------------------
// Capture mode: ?shot=<name> stages one deterministic frame, renders it twice and freezes.
// ---------------------------------------------------------------------------------------------
if (shotName) {
  // Capture staging lives in its own module and is loaded only for ?shot=.
  const { createCaptureStage } = await import('./capture.js');
  const capture = createCaptureStage({ sim, hud, renderer, scene, camera, consumeState, syncCamera, handleEvents });
  capture.stage(shotName);
  frozen = true;
  capture.paintTwice();
} else {
  hud.showStart();
  requestAnimationFrame(frame);
}

// What is actually in frame: a 3x3 probe of the view, for a capture audit that cannot look at
// the picture. Each entry names the surface and its distance from the eye.
const probeRay = new THREE.Raycaster();
function surfaceOf(object) {
  let node = object;
  while (node) {
    if (node.userData?.kind) return node.userData.kind;
    if (node.userData?.actor) return `actor:${node.userData.actor}`;
    node = node.parent;
  }
  return object.type;
}
window.__view = () => {
  const targets = [...world.boxes];
  for (const view of actorViews) targets.push(view.group);
  const out = [];
  for (const [sx, sy] of [[0, 0], [-0.45, 0], [0.45, 0], [0, -0.45], [0, 0.45], [-0.45, -0.45], [0.45, 0.45]]) {
    probeRay.setFromCamera({ x: sx, y: sy }, camera);
    const hits = probeRay.intersectObjects(targets, true);
    const hit = hits[0];
    out.push({
      sx,
      sy,
      surface: hit ? surfaceOf(hit.object) : 'sky',
      distance: hit ? Number(hit.distance.toFixed(2)) : null,
    });
  }
  return out;
};
window.__hudText = () => ({
  timer: document.getElementById('hud-timer').textContent,
  score: [document.getElementById('hud-score-packers').textContent, document.getElementById('hud-score-wardens').textContent],
  hp: document.getElementById('hud-health-text').textContent,
  ammo: document.getElementById('hud-mag').textContent,
  reserve: document.getElementById('hud-reserve').textContent,
  weapon: document.getElementById('hud-weapon').textContent,
  money: document.getElementById('hud-money').textContent,
  phase: document.getElementById('hud-phase').textContent,
  objective: document.getElementById('hud-objective').textContent,
  bomb: document.getElementById('hud-bomb').textContent,
});

// Small window handle for the browser tests: nothing here changes simulation rules.
window.__game = { sim, camera, renderer, scene, world, effects };
