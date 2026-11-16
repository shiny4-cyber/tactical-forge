// The match: a buy phase, a live round, a result, and the next round. It owns the clock, the
// score, the money and the bomb's timers; it never moves an actor or draws anything.
export const ROUND = {
  buySeconds: 12,
  liveSeconds: 100,
  overSeconds: 6,
  plantSeconds: 3.2,
  fuseSeconds: 40,
  defuseSeconds: 10,
  roundsToWin: 5,
};

export const ECONOMY = {
  start: 800,
  max: 16000,
  kill: 300,
  win: 3250,
  loss: 1400,
  lossStep: 500,
  lossMax: 3400,
  plant: 300,
  defuse: 300,
};

export function createBomb() {
  return {
    state: 'carried',
    carrier: null,
    site: null,
    x: 0,
    z: 0,
    fuse: 0,
    plantProgress: 0,
    defuseProgress: 0,
    defuserId: null,
    plantedBy: null,
    ticking: false,
  };
}

export function createMatch() {
  const match = {
    phase: 'buy',
    phaseTime: ROUND.buySeconds,
    round: 1,
    attackerScore: 0,
    defenderScore: 0,
    lastWinner: null,
    lastReason: null,
    phaseSerial: 0,
    matchOver: false,
    lossStreak: { attackers: 0, defenders: 0 },
    bomb: createBomb(),
    events: [],
  };

  function event(kind, text) {
    match.events.push({ kind, text });
    if (match.events.length > 24) match.events.shift();
  }

  function buyPhase(round) {
    match.round = round;
    match.phase = 'buy';
    match.phaseTime = ROUND.buySeconds;
    match.phaseSerial += 1;
    match.bomb = createBomb();
    event('phase', `ROUND ${round} / BUY PHASE`);
  }

  function live() {
    match.phase = 'live';
    match.phaseTime = ROUND.liveSeconds;
    match.phaseSerial += 1;
    event('phase', 'ROUND LIVE');
  }

  function endRound(winner, reason) {
    if (match.phase !== 'live') return false;
    match.phase = 'roundOver';
    match.phaseTime = ROUND.overSeconds;
    match.lastWinner = winner;
    match.lastReason = reason;
    match.phaseSerial += 1;
    if (winner === 'attackers') {
      match.attackerScore += 1;
      match.lossStreak.attackers = 0;
      match.lossStreak.defenders += 1;
    } else {
      match.defenderScore += 1;
      match.lossStreak.defenders = 0;
      match.lossStreak.attackers += 1;
    }
    if (match.attackerScore >= ROUND.roundsToWin || match.defenderScore >= ROUND.roundsToWin) {
      match.matchOver = true;
    }
    event('round', `${winner === 'attackers' ? 'PACKERS' : 'WARDENS'} WIN / ${reason.toUpperCase()}`);
    return true;
  }

  function winMoney(team) {
    return ECONOMY.win;
  }

  function lossMoney(team) {
    const streak = match.lossStreak[team];
    return Math.min(ECONOMY.lossMax, ECONOMY.loss + Math.max(0, streak - 1) * ECONOMY.lossStep);
  }

  function award(team) {
    const winner = team === 'attackers' ? 'attackers' : 'defenders';
    const loser = winner === 'attackers' ? 'defenders' : 'attackers';
    return { win: winMoney(winner), loss: lossMoney(loser) };
  }

  // Called once per fixed step by the simulation. Returns the phase transition when one
  // happened this step, so the caller can reset the world exactly once.
  function tick(dt) {
    if (match.phase === 'buy') {
      match.phaseTime = Math.max(0, match.phaseTime - dt);
      if (match.phaseTime === 0) {
        live();
        return 'live';
      }
      return null;
    }
    if (match.phase === 'live') {
      match.phaseTime = Math.max(0, match.phaseTime - dt);
      return null;
    }
    if (match.phase === 'roundOver') {
      match.phaseTime = Math.max(0, match.phaseTime - dt);
      if (match.phaseTime === 0) {
        if (match.matchOver) {
          match.phase = 'matchOver';
          match.phaseTime = 0;
          match.phaseSerial += 1;
          event('match', 'MATCH OVER');
          return 'matchOver';
        }
        buyPhase(match.round + 1);
        return 'buy';
      }
    }
    return null;
  }

  return {
    state: match,
    tick,
    endRound,
    award,
    buyPhase,
    live,
    startOver() {
      match.attackerScore = 0;
      match.defenderScore = 0;
      match.matchOver = false;
      match.lossStreak.attackers = 0;
      match.lossStreak.defenders = 0;
      match.events.length = 0;
      buyPhase(1);
    },
    event,
  };
}

// Money for a finished round, applied to the player by the simulation.
export function roundPayout(match, team) {
  const won = match.lastWinner === team;
  if (won) return ECONOMY.win;
  const streak = match.lossStreak[team];
  return Math.min(ECONOMY.lossMax, ECONOMY.loss + Math.max(0, streak - 1) * ECONOMY.lossStep);
}
