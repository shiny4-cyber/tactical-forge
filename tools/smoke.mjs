// Headless smoke probe: run one buy phase and twenty live seconds with bots and print what
// the simulation did. Kept out of the test suite; the assertions live in tests/.
import { createSimulation } from '../game/src/sim.js';
import { GRAPH } from '../game/src/nav.js';

const sim = createSimulation({ seed: 7, bots: true, side: 'attackers' });
sim.start();
console.log('nodes', GRAPH.nodes.length, 'edges', GRAPH.edges.reduce((sum, list) => sum + list.length, 0) / 2);
console.log('bots', sim.bots.length, 'phase', sim.match.phase, 'money', sim.player.money);
let steps = 0;
while (sim.match.phase !== 'live' && steps < 2000) {
  sim.step(1 / 60);
  steps += 1;
}
console.log('live after', (steps / 60).toFixed(2), 's', 'phase', sim.match.phase);
const startPositions = sim.bots.map((bot) => [bot.x.toFixed(2), bot.z.toFixed(2)]);
for (let i = 0; i < 60 * 25; i += 1) sim.step(1 / 60);
console.log('after 25s live:', sim.match.phase, sim.match.phaseTime.toFixed(1), 'aliveA', sim.aliveCount('attackers'), 'aliveD', sim.aliveCount('defenders'));
console.log('bomb', sim.bomb.state, sim.bomb.site, 'fuse', sim.bomb.fuse.toFixed(1));
console.log('player', sim.player.alive, sim.player.health, 'at', sim.player.x.toFixed(1), sim.player.z.toFixed(1));
console.log('bot moves:');
sim.bots.forEach((bot, index) => {
  console.log(' ', bot.name, bot.team.padEnd(9), bot.state.padEnd(9), 'from', startPositions[index].join(','), 'to', bot.x.toFixed(1) + ',' + bot.z.toFixed(1), 'hp', bot.health.toFixed(0));
});
console.log('kills', sim.killFeed.length, JSON.stringify(sim.killFeed.slice(-3)));
