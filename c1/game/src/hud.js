// The DOM HUD: it reads the simulation's numbers into elements found once at load. Nothing is
// created per frame and the simulation never hears from it.
import { WEAPONS } from './combat.js';
import { BUY_LIST } from './combat.js';

const pad = (value) => String(value).padStart(2, '0');

export function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
}

export function createHud() {
  const el = {
    root: document.getElementById('hud'),
    timer: document.getElementById('hud-timer'),
    round: document.getElementById('hud-round'),
    phase: document.getElementById('hud-phase'),
    scoreA: document.getElementById('hud-score-packers'),
    scoreD: document.getElementById('hud-score-wardens'),
    health: document.getElementById('hud-health-fill'),
    healthText: document.getElementById('hud-health-text'),
    armor: document.getElementById('hud-armor-fill'),
    armorText: document.getElementById('hud-armor-text'),
    money: document.getElementById('hud-money'),
    weapon: document.getElementById('hud-weapon'),
    mag: document.getElementById('hud-mag'),
    reserve: document.getElementById('hud-reserve'),
    ammo: document.getElementById('hud-ammo'),
    bomb: document.getElementById('hud-bomb'),
    feed: document.getElementById('hud-feed'),
    objective: document.getElementById('hud-objective'),
    crosshair: document.getElementById('crosshair'),
    hitmarker: document.getElementById('hitmarker'),
    vignette: document.getElementById('vignette'),
    banner: document.getElementById('banner'),
    bannerTitle: document.getElementById('banner-title'),
    bannerCopy: document.getElementById('banner-copy'),
    buy: document.getElementById('buy'),
    buyList: document.getElementById('buy-list'),
    buyMoney: document.getElementById('buy-money'),
    start: document.getElementById('start'),
    startCopy: document.getElementById('start-copy'),
    startButton: document.getElementById('start-button'),
    sideButtons: document.querySelectorAll('[data-side]'),
    dead: document.getElementById('dead'),
    stats: document.getElementById('hud-stats'),
  };

  let last = {};
  let bannerTimer = 0;
  let hitTimer = 0;
  let buyHandlersBound = false;

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  return {
    el,
    update(sim) {
      const state = sim.match;
      const player = sim.player;
      setText(el.timer, 'timer', formatClock(state.phase === 'live' ? state.phaseTime : state.phaseTime));
      setText(el.round, 'round', `R${state.round}`);
      const phaseLabel =
        state.phase === 'buy' ? 'BUY PHASE' : state.phase === 'live' ? 'LIVE' : state.phase === 'roundOver' ? 'ROUND OVER' : 'MATCH OVER';
      setText(el.phase, 'phase', phaseLabel);
      setText(el.scoreA, 'scoreA', String(state.attackerScore));
      setText(el.scoreD, 'scoreD', String(state.defenderScore));
      setText(el.healthText, 'healthText', String(Math.max(0, Math.round(player.health))));
      setText(el.armorText, 'armorText', String(Math.max(0, Math.round(player.armor))));
      setText(el.money, 'money', `$${Math.round(player.money)}`);
      if (last.health !== Math.round(player.health)) {
        last.health = Math.round(player.health);
        el.health.style.width = `${Math.max(0, player.health)}%`;
        el.health.classList.toggle('low', player.health <= 35);
      }
      if (last.armor !== Math.round(player.armor)) {
        last.armor = Math.round(player.armor);
        el.armor.style.width = `${Math.max(0, player.armor)}%`;
      }
      const weapon = WEAPONS[sim.arsenal.weaponId];
      setText(el.weapon, 'weapon', weapon.name);
      setText(el.mag, 'mag', String(sim.arsenal.mag));
      setText(el.reserve, 'reserve', `/ ${sim.arsenal.reserve}`);
      el.ammo.classList.toggle('empty', sim.arsenal.mag === 0);
      el.ammo.classList.toggle('reloading', sim.arsenal.reloadLeft > 0);

      const bomb = state.bomb;
      let bombText = '';
      let bombTone = '';
      if (bomb.state === 'planted') {
        bombText = `CHARGE ARMED · ${bomb.fuse.toFixed(1)}s`;
        bombTone = 'danger';
      } else if (bomb.state === 'dropped') {
        bombText = 'CHARGE DROPPED';
        bombTone = 'warn';
      } else if (bomb.carrier === 'player') {
        bombText = 'YOU CARRY THE CHARGE';
        bombTone = 'carry';
      } else if (bomb.state === 'defused') {
        bombText = 'CHARGE DEFUSED';
        bombTone = '';
      }
      if (last.bombText !== bombText) {
        last.bombText = bombText;
        el.bomb.textContent = bombText;
        el.bomb.className = bombTone ? `bomb ${bombTone}` : 'bomb';
        el.bomb.hidden = bombText === '';
      }

      // The objective line: what this phase asks of the player.
      let objective = '';
      if (state.phase === 'buy') objective = 'BUY · B OPENS THE SHOP';
      else if (player.team === 'attackers') objective = bomb.state === 'planted' ? 'DEFEND THE CHARGE' : 'PLANT AT SITE A OR B (HOLD E)';
      else objective = bomb.state === 'planted' ? 'DEFUSE THE CHARGE (HOLD E)' : 'HOLD A OR B · STOP THE PLANT';
      setText(el.objective, 'objective', objective);

      setText(el.stats, 'stats', `${sim.stats.kills}K ${sim.stats.deaths}D · ${sim.stats.hits}/${sim.stats.shots} HITS`);
      el.dead.hidden = player.alive || state.phase === 'buy';
      el.vignette.style.opacity = String(Math.max(0, Math.min(0.85, (100 - player.health) / 130)));
    },
    setSpread(pixels) {
      const gap = Math.round(4 + pixels * 30);
      if (last.gap === gap) return;
      last.gap = gap;
      el.crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on'), killed ? 320 : 90);
    },
    damage() {
      el.vignette.classList.add('hit');
      setTimeout(() => el.vignette.classList.remove('hit'), 140);
    },
    banner(title, copy, seconds = 4) {
      el.bannerTitle.textContent = title;
      el.bannerCopy.textContent = copy;
      el.banner.hidden = false;
      clearTimeout(bannerTimer);
      if (seconds > 0) bannerTimer = setTimeout(() => (el.banner.hidden = true), seconds * 1000);
    },
    hideBanner() {
      el.banner.hidden = true;
    },
    showBuy(money, onPick) {
      el.buy.hidden = false;
      el.buyMoney.textContent = `$${Math.round(money)}`;
      if (!buyHandlersBound) {
        buyHandlersBound = true;
        el.buyList.addEventListener('click', (event) => {
          const row = event.target.closest('[data-item]');
          if (row) onPick(row.dataset.item);
        });
      }
      for (const row of el.buyList.querySelectorAll('[data-item]')) {
        const item = BUY_LIST.find((entry) => entry.id === row.dataset.item);
        const affordable = money >= item.cost;
        row.classList.toggle('unaffordable', !affordable);
        row.querySelector('.price').textContent = `$${item.cost}`;
      }
    },
    updateBuy(money) {
      el.buyMoney.textContent = `$${Math.round(money)}`;
      for (const row of el.buyList.querySelectorAll('[data-item]')) {
        const item = BUY_LIST.find((entry) => entry.id === row.dataset.item);
        row.classList.toggle('unaffordable', money < item.cost);
      }
    },
    hideBuy() {
      el.buy.hidden = true;
    },
    buyOpen() {
      return !el.buy.hidden;
    },
    showStart() {
      el.start.hidden = false;
    },
    hideStart() {
      el.start.hidden = true;
    },
    startOpen() {
      return !el.start.hidden;
    },
    setSide(side) {
      for (const button of el.sideButtons) button.classList.toggle('active', button.dataset.side === side);
    },
    flashFeed() {
      el.feed.classList.remove('pulse');
      void el.feed.offsetWidth;
      el.feed.classList.add('pulse');
    },
    renderFeed(entries) {
      if (!entries.length) {
        el.feed.innerHTML = '';
        return;
      }
      el.feed.innerHTML = entries
        .slice(-5)
        .map((entry) => `<li><b>${entry.killer}</b> <span>${entry.part === 'head' ? 'HEADSHOT' : entry.part === 'blast' ? 'BLAST' : entry.weapon}</span> ${entry.victim}</li>`)
        .join('');
    },
  };
}
