// KILN NINE: the map as data. Nothing here touches three.js or the DOM, so the tests can
// collide, path and shoot against exactly the geometry the renderer draws.
//
// Layout, from the defenders' side of the yard:
//   - Two approach lanes, west and east, split by the solid kiln block in the middle.
//   - Site A, the kiln floor, a roofed building in the north-west with a south door and an
//     east door; crates inside give two angles onto each entrance.
//   - Site B, the cistern yard, an open pen in the north-east with one wide south mouth and
//     a west mouth, a cistern tank in the middle and a low wall to fight from.
//   - A north corridor behind both sites links them, so a rotate is shorter than the lane.
//
// Every solid is an axis-aligned box: {x, y, z} is its centre, {w, h, d} its full size,
// `kind` picks the material and `solid` says whether it blocks movement and bullets.

export const MAP = {
  name: 'KILN NINE',
  bounds: { minX: -24, maxX: 24, minZ: -20, maxZ: 20 },
  wallHeight: 5,
  floor: { minX: -24, maxX: 24, minZ: -20, maxZ: 20 },
  sites: [
    { id: 'A', name: 'KILN FLOOR', center: { x: -13, y: 0, z: -12 }, radius: 3.4 },
    { id: 'B', name: 'CISTERN YARD', center: { x: 13, y: 0, z: -11 }, radius: 3.4 },
  ],
  attackerSpawn: { x: 0, y: 0, z: 16.5, yaw: Math.PI },
  defenderSpawn: { x: 0, y: 0, z: -18, yaw: 0 },
  attackerSpawns: [
    { x: -6, z: 17 },
    { x: 0, z: 17.5 },
    { x: 6, z: 17 },
    { x: 0, z: 15 },
  ],
  defenderSpawns: [
    { x: -13, z: -13.5 },
    { x: -9, z: -9.5 },
    { x: 13, z: -12.5 },
    { x: 9, z: -7.5 },
  ],
};

// kind: floor | wall | brick | metal | crate | glass | tank
export const BOXES = [
  // Outer shell. 1 m thick, 5 m tall: nothing walks or shoots through it.
  { x: 0, y: 2.5, z: -20, w: 48, h: 5, d: 1, kind: 'wall', solid: true },
  { x: 0, y: 2.5, z: 20, w: 48, h: 5, d: 1, kind: 'wall', solid: true },
  { x: -24, y: 2.5, z: 0, w: 1, h: 5, d: 40, kind: 'wall', solid: true },
  { x: 24, y: 2.5, z: 0, w: 1, h: 5, d: 40, kind: 'wall', solid: true },

  // The kiln block: a solid brick mass in the middle of the yard, 8 x 12 m.
  { x: 0, y: 2.6, z: 0, w: 8, h: 5.2, d: 12, kind: 'brick', solid: true },
  // Its chimney stack, so the middle of the map is a landmark from any lane.
  { x: 0, y: 6.5, z: 3.4, w: 1.8, h: 8, d: 1.8, kind: 'brick', solid: true },

  // Site A: the kiln floor building, interior x [-18,-8], z [-16,-8].
  { x: -13, y: 2.5, z: -16.5, w: 11, h: 5, d: 1, kind: 'brick', solid: true }, // north
  { x: -18.5, y: 2.5, z: -12, w: 1, h: 5, d: 10, kind: 'brick', solid: true }, // west
  // South wall with a 2.4 m door at x [-15.2,-12.8].
  { x: -17.6, y: 2.5, z: -7.5, w: 2.8, h: 5, d: 1, kind: 'brick', solid: true },
  { x: -10.1, y: 2.5, z: -7.5, w: 4.2, h: 5, d: 1, kind: 'brick', solid: true },
  { x: -14, y: 4.1, z: -7.5, w: 2.4, h: 1.8, d: 1, kind: 'brick', solid: true }, // door lintel
  // East wall with a 2.4 m door at z [-13.2,-10.8].
  { x: -7.5, y: 2.5, z: -15.9, w: 1, h: 5, d: 3.2, kind: 'brick', solid: true },
  { x: -7.5, y: 2.5, z: -9.1, w: 1, h: 5, d: 2.6, kind: 'brick', solid: true },
  { x: -7.5, y: 4.1, z: -12, w: 1, h: 1.8, d: 2.4, kind: 'brick', solid: true },
  // A low parapet on the roof line reads as a kiln, and hides nothing.
  { x: -13, y: 5.25, z: -12, w: 11.4, h: 0.5, d: 10.4, kind: 'metal', solid: false },
  // Inside: two crate stacks that make the floor fightable.
  { x: -16.2, y: 0.7, z: -14.4, w: 2.2, h: 1.4, d: 2.2, kind: 'crate', solid: true },
  { x: -9.8, y: 0.55, z: -14.6, w: 1.8, h: 1.1, d: 1.8, kind: 'crate', solid: true },
  { x: -16.4, y: 0.55, z: -9.6, w: 2.0, h: 1.1, d: 1.6, kind: 'crate', solid: true },

  // Site B: the cistern yard, open to the sky, x [8,18], z [-16,-6].
  { x: 8, y: 2.2, z: -11, w: 1, h: 4.4, d: 10, kind: 'metal', solid: true }, // west wall, mouth at its south end
  { x: 18, y: 2.2, z: -11, w: 1, h: 4.4, d: 10, kind: 'metal', solid: true }, // east wall
  { x: 13, y: 2.2, z: -16, w: 10, h: 4.4, d: 1, kind: 'metal', solid: true }, // north wall
  // South wall with a 3.6 m mouth at x [10.6,14.2]; the last 2 m is left open as the west mouth.
  { x: 9.3, y: 2.2, z: -6, w: 2.6, h: 4.4, d: 1, kind: 'metal', solid: true },
  { x: 16.1, y: 2.2, z: -6, w: 3.8, h: 4.4, d: 1, kind: 'metal', solid: true },
  // The cistern tank: the site's landmark and hard cover.
  { x: 13, y: 1.5, z: -13.4, w: 3.4, h: 3, d: 3.4, kind: 'tank', solid: true },
  // Low wall to hold from, and a crate to peek over.
  { x: 11, y: 0.55, z: -8.6, w: 3.4, h: 1.1, d: 0.6, kind: 'crate', solid: true },
  { x: 15.8, y: 0.7, z: -9.2, w: 2.0, h: 1.4, d: 2.0, kind: 'crate', solid: true },

  // Lane cover. West lane runs x about -19 between the shell and site A.
  { x: -19.4, y: 0.65, z: 4, w: 2.4, h: 1.3, d: 2.4, kind: 'crate', solid: true },
  { x: -20.2, y: 0.65, z: -2, w: 1.8, h: 1.3, d: 3.2, kind: 'crate', solid: true },
  { x: -21.4, y: 1.6, z: 12, w: 1.2, h: 3.2, d: 1.2, kind: 'metal', solid: true },
  // East lane runs x about 19-21.
  { x: 20.4, y: 0.65, z: 5, w: 2.4, h: 1.3, d: 2.4, kind: 'crate', solid: true },
  { x: 19.0, y: 0.65, z: -3, w: 2.0, h: 1.3, d: 3.0, kind: 'crate', solid: true },
  { x: 21.6, y: 1.6, z: 11, w: 1.2, h: 3.2, d: 1.2, kind: 'metal', solid: true },
  // Mid, either side of the kiln block: one crate each side to break the long sightline.
  { x: -6.6, y: 0.6, z: 8.4, w: 2.0, h: 1.2, d: 2.0, kind: 'crate', solid: true },
  { x: 6.6, y: 0.6, z: 8.4, w: 2.0, h: 1.2, d: 2.0, kind: 'crate', solid: true },
  { x: -8.8, y: 0.6, z: -4.2, w: 1.6, h: 1.2, d: 2.2, kind: 'crate', solid: true },
  { x: 8.8, y: 0.6, z: -4.2, w: 1.6, h: 1.2, d: 2.2, kind: 'crate', solid: true },
  // North corridor cover, behind both sites.
  { x: 0, y: 0.55, z: -18, w: 2.6, h: 1.1, d: 1.6, kind: 'crate', solid: true },
  // Attacker side: the two spawn screens and a stack to fight from.
  { x: -10, y: 0.6, z: 14, w: 2.2, h: 1.2, d: 2.2, kind: 'crate', solid: true },
  { x: 10, y: 0.6, z: 14, w: 2.2, h: 1.2, d: 2.2, kind: 'crate', solid: true },
  { x: 0, y: 1.1, z: 12.6, w: 4.2, h: 2.2, d: 0.7, kind: 'metal', solid: true },
  // Spawn-side lamps on posts, non-solid, so the yard is not a dark box.
  { x: -14, y: 2.4, z: 12, w: 0.25, h: 4.8, d: 0.25, kind: 'metal', solid: false },
  { x: 14, y: 2.4, z: 12, w: 0.25, h: 4.8, d: 0.25, kind: 'metal', solid: false },
];

// Lamps: position plus colour, used by the renderer and by nothing in the simulation.
export const LAMPS = [
  { x: -14, y: 4.9, z: 12, color: 0xffb257, intensity: 22 },
  { x: 14, y: 4.9, z: 12, color: 0xffb257, intensity: 22 },
  { x: -13, y: 3.2, z: -11.9, color: 0xffd9a0, intensity: 16 },
  { x: 13, y: 3.4, z: -10.6, color: 0x8fe6ff, intensity: 14 },
  { x: 0, y: 3.0, z: -18, color: 0xff9a5c, intensity: 10 },
];

// Signs the renderer paints as canvas plates. Positions face the camera side of the lane.
export const SIGNS = [
  { text: 'KILN NINE', sub: 'WORKS 9 / SHIFT 3', x: 0, y: 3.6, z: 19.4, yaw: Math.PI, w: 6, h: 1.6 },
  { text: 'SITE A', sub: 'KILN FLOOR', x: -14, y: 3.1, z: -7.98, yaw: 0, w: 2.6, h: 1.0 },
  { text: 'SITE B', sub: 'CISTERN YARD', x: 13, y: 3.4, z: -6.02, yaw: 0, w: 2.6, h: 1.0 },
  { text: 'A', sub: '', x: -18.98, y: 2.4, z: -12, yaw: Math.PI / 2, w: 1.2, h: 1.2 },
  { text: 'B', sub: '', x: 18.98, y: 2.4, z: -9.4, yaw: -Math.PI / 2, w: 1.2, h: 1.2 },
];

// Navigation nodes. `hold` marks a defender anchor and the site it watches; `lane` groups
// them so a route can be checked in tests. Coordinates are on the floor, y is ignored.
export const NODES = [
  // Attacker spawn and the two lane mouths.
  { id: 's0', x: 0, z: 16, lane: 'spawn' },
  { id: 's1', x: -8, z: 15, lane: 'spawn' },
  { id: 's2', x: 8, z: 15, lane: 'spawn' },
  { id: 'w0', x: -14, z: 12, lane: 'west' },
  { id: 'w1', x: -19, z: 8, lane: 'west' },
  { id: 'w2', x: -20.5, z: 0, lane: 'west' },
  { id: 'w3', x: -19.5, z: -5, lane: 'west' },
  { id: 'w4', x: -19, z: -10, lane: 'west' },
  { id: 'e0', x: 14, z: 12, lane: 'east' },
  { id: 'e1', x: 19, z: 8, lane: 'east' },
  { id: 'e2', x: 20.5, z: 0, lane: 'east' },
  { id: 'e3', x: 19.5, z: -5, lane: 'east' },
  { id: 'e4', x: 19.5, z: -9, lane: 'east' },
  { id: 'e5', x: 17.5, z: -14, lane: 'east' },
  // Middle, through the gap south of the kiln block and north of it.
  { id: 'm0', x: -5.6, z: 9.5, lane: 'mid' },
  { id: 'm1', x: 5.6, z: 9.5, lane: 'mid' },
  { id: 'm2', x: -5.6, z: 7.4, lane: 'mid' },
  { id: 'm3', x: 5.6, z: 7.4, lane: 'mid' },
  { id: 'm4', x: -5.6, z: -8.6, lane: 'mid' },
  { id: 'm5', x: 5.6, z: -8.6, lane: 'mid' },
  // Site A: the south door, the east door, the floor, and two hold spots.
  { id: 'a0', x: -14, z: -6.2, lane: 'siteA' },
  { id: 'a1', x: -14, z: -8.9, lane: 'siteA' },
  { id: 'a2', x: -13, z: -12, lane: 'siteA', site: 'A' },
  { id: 'a3', x: -10, z: -11, lane: 'siteA' },
  { id: 'a4', x: -16.8, z: -10.2, lane: 'siteA', hold: { site: 'A', yaw: 0.35 } },
  { id: 'a5', x: -10.6, z: -14.4, lane: 'siteA', hold: { site: 'A', yaw: -2.6 } },
  { id: 'a6', x: -7.0, z: -7.5, lane: 'siteA' },
  { id: 'a7', x: -8.9, z: -12, lane: 'siteA' },
  // Site B: south mouth, west mouth, floor, holds.
  { id: 'b0', x: 12.6, z: -4.6, lane: 'siteB' },
  { id: 'b1', x: 12.4, z: -7.0, lane: 'siteB' },
  { id: 'b2', x: 13, z: -11, lane: 'siteB', site: 'B' },
  { id: 'b3', x: 15.6, z: -7.6, lane: 'siteB' },
  { id: 'b4', x: 15.6, z: -13.8, lane: 'siteB', hold: { site: 'B', yaw: 2.4 } },
  { id: 'b5', x: 9.4, z: -13.6, lane: 'siteB', hold: { site: 'B', yaw: -2.2 } },
  { id: 'b6', x: 9.0, z: -7.0, lane: 'siteB' },
  { id: 'b7', x: 16.6, z: -10.4, lane: 'siteB', hold: { site: 'B', yaw: 3.0 } },
  // North corridor behind the sites: the short rotate.
  { id: 'n0', x: -6, z: -18, lane: 'north' },
  { id: 'n1', x: 0, z: -18, lane: 'north' },
  { id: 'n2', x: 6, z: -18, lane: 'north' },
  { id: 'n3', x: -13, z: -17.6, lane: 'north' },
  { id: 'n4', x: -13, z: -18.6, lane: 'north' },
  { id: 'n5', x: 17.5, z: -18, lane: 'north' },
  { id: 'n6', x: 17.5, z: -15.4, lane: 'north' },
];

// Extra edges where a straight line is wider than the automatic radius (long lanes) or
// crosses a doorway the ray at chest height clears only narrowly.
export const EXTRA_EDGES = [
  ['s0', 'm2'], ['s1', 'w0'], ['s2', 'e0'], ['w0', 'w2'], ['e0', 'e2'],
  ['w2', 'w4'], ['e2', 'e4'], ['w4', 'a0'], ['e4', 'e0'], ['m2', 'm4'], ['m3', 'm5'],
  ['a3', 'm4'], ['b6', 'b1'], ['b1', 'b0'], ['b3', 'e5'], ['b6', 'e3'],
  ['n4', 'n3'], ['n5', 'n6'], ['a5', 'n0'], ['b4', 'n6'], ['n0', 'n1'], ['n1', 'n2'],
];
