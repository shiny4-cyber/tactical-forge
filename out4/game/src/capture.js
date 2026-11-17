// Capture staging. Loaded only when the page is opened with ?shot=, so the game itself never
// pays for it. It poses a deterministic frame through the same state and render calls the loop
// makes; nothing here is composited, and no rule of the simulation is bypassed.
import { MAP } from './map.js';

function placeActor(actor, x, z, yaw, crouching = false) {
  actor.x = x;
  actor.z = z;
  actor.y = 0;
  actor.yaw = yaw;
  actor.pitch = 0;
  actor.alive = true;
  actor.health = 100;
  actor.crouching = crouching;
  actor.height = crouching ? 1.14 : 1.72;
}

export function createCaptureStage(deps) {
  const { sim, hud, renderer, scene, camera, consumeState, syncCamera, handleEvents } = deps;

  function stage(name) {
    sim.match.phase = 'live';
    sim.match.phaseTime = 78;
    sim.match.phaseSerial += 1;
    sim.match.attackerScore = 2;
    sim.match.defenderScore = 1;
    sim.match.round = 4;
    sim.player.alive = true;
    sim.player.health = 100;
    sim.player.armor = 100;
    sim.player.money = 4350;
    sim.arsenal.mag = 24;
    sim.arsenal.reserve = 90;
    sim.bots.forEach((bot) => {
      bot.alive = true;
      bot.health = 100;
    });
    hud.hideStart();
    hud.hideBuy();
    hud.hideBanner();
    const defenders = sim.bots.filter((bot) => bot.team === 'defenders');
    const attackers = sim.bots.filter((bot) => bot.team === 'attackers');

    if (name === 'buy') {
      // The armory over a live buy phase: the shop with prices against a fresh round.
      sim.match.phase = 'buy';
      sim.match.phaseTime = 9;
      sim.match.attackerScore = 0;
      sim.match.defenderScore = 0;
      sim.match.round = 1;
      sim.player.weaponId = 'kestrel';
      placeActor(sim.player, 6.4, 14.0, 0.25);
      sim.player.pitch = -0.04;
      defenders.forEach((bot, index) => placeActor(bot, -18 + index * 2.2, -6, 0.4));
      attackers.forEach((bot, index) => placeActor(bot, -6.2 + index * 3.1, 18.4, Math.PI));
      sim.bomb.state = 'carried';
      sim.bomb.carrier = 'player';
      sim.now = 6;
      hud.showBuy(sim.player.money, () => {});
      hud.update(sim);
      hud.renderFeed([]);
      return;
    }

    if (name === 'fire') {
      // East lane duel: the cistern mouth in the sight line, a defender in it, muzzle flash up.
      placeActor(sim.player, 12.4, 0.6, 0.0);
      sim.player.pitch = -0.01;
      placeActor(defenders[0], 12.4, -6.6, 0.0);
      placeActor(defenders[1], 15.4, -8.2, 0.4, true);
      placeActor(defenders[2], 9.6, -10.4, 0.9);
      placeActor(defenders[3], 12.4, -13.6, 2.9);
      attackers.forEach((bot, index) => placeActor(bot, 10.6 - index * 1.1, 3.2 + index * 0.9, 0.1));
      sim.bomb.state = 'carried';
      sim.bomb.carrier = 'player';
      sim.now = 402;
      consumeState();
      renderer.render(scene, camera);
      sim.playerShoot();
      sim.playerShoot();
      handleEvents(sim.drainEvents());
      sim.stats.kills = 2;
      sim.stats.deaths = 0;
      sim.stats.hits = 9;
      sim.stats.shots = 14;
      sim.killFeed.push({ killer: 'YOU', victim: 'VANE', weapon: 'KESTREL', part: 'head', at: sim.now });
      sim.killFeed.push({ killer: 'ASH', victim: 'MOTH', weapon: 'KESTREL', part: 'body', at: sim.now });
      sim.killFeed.push({ killer: 'BRICK', victim: 'SABLE', weapon: 'TAPPER', part: 'body', at: sim.now });
      hud.hitMarker(true);
      hud.setSpread(0.002);
      hud.update(sim);
      hud.renderFeed(sim.killFeed);
      return;
    }

    if (name === 'plant') {
      // Site B: the charge down at the cistern, the player covering the mouth over it.
      placeActor(sim.player, 13.0, -8.7, 0);
      sim.player.pitch = -0.32;
      const site = MAP.sites.find((entry) => entry.id === 'B');
      sim.bomb.state = 'planted';
      sim.bomb.site = 'B';
      sim.bomb.x = site.center.x;
      sim.bomb.z = site.center.z;
      sim.bomb.fuse = 26.4;
      sim.bomb.carrier = null;
      placeActor(defenders[0], 15.8, -12.6, 2.2, true);
      placeActor(defenders[1], 9.6, -12.8, -1.4);
      placeActor(defenders[2], 16.2, -8.6, 2.6);
      placeActor(defenders[3], 8.8, -6.4, -0.5);
      attackers.forEach((bot, index) => placeActor(bot, 8.9 + index * 0.6, -10.8 - index * 1.5, 2.4));
      sim.now = 388;
      hud.banner('CHARGE ARMED', 'SITE B · 26.4s TO DETONATION', 0);
      hud.update(sim);
      hud.renderFeed([
        { killer: 'YOU', victim: 'RIDGE', weapon: 'KESTREL', part: 'body', at: sim.now },
        { killer: 'MOTH', victim: 'COIL', weapon: 'MARROW', part: 'body', at: sim.now },
      ]);
      return;
    }

    // Cover: the west lane, the site A door and its sign, a crate stack for cover, the yard
    // beyond. This is the frame that has to sell the map.
    placeActor(sim.player, -17.6, 10.2, -0.22);
    sim.player.pitch = -0.02;
    placeActor(defenders[0], -13.6, -9.4, 0.05, true);
    placeActor(defenders[1], -16.8, -12.4, -0.6);
    placeActor(defenders[2], 12.9, -9.6, 3.1);
    placeActor(defenders[3], 15.4, -13.2, 2.4);
    attackers.forEach((bot, index) => placeActor(bot, -17.2 + index * 1.5, 5.4 + index * 0.9, 0.12));
    sim.bomb.state = 'carried';
    sim.bomb.carrier = 'player';
    sim.now = 372;
    hud.setSpread(0.0018);
    hud.update(sim);
    hud.renderFeed([
      { killer: 'YOU', victim: 'VANE', weapon: 'KESTREL', part: 'head', at: sim.now },
      { killer: 'BRICK', victim: 'SABLE', weapon: 'TAPPER', part: 'body', at: sim.now },
    ]);
    hud.banner('KILN NINE', 'PACKERS 2 — 1 WARDENS · WEST LANE TO SITE A', 0);
  }

  // Render the staged frame twice, then declare it ready: a capture is taken after the second
  // paint, when the canvas holds exactly this state.
  function paintTwice() {
    let painted = 0;
    function paint() {
      requestAnimationFrame(paint);
      syncCamera();
      consumeState();
      renderer.render(scene, camera);
      painted += 1;
      if (painted === 2) {
        const info = renderer.info.render;
        window.__captureInfo = {
          triangles: info.triangles,
          calls: info.calls,
          width: renderer.domElement.width,
          height: renderer.domElement.height,
          state: window.__debug(),
        };
        window.__shotReady = true;
      }
    }
    requestAnimationFrame(paint);
  }

  return { stage, paintTwice };
}
