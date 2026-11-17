// Every texture is painted here with a canvas at load time: no files, no network, no borrowed
// art. Each surface texture tiles: patterns are drawn across the canvas edge, and the world's
// box faces are UV-scaled to metres (scaleBoxUv), so brick stays brick-sized on a chimney and
// on a lintel. One seeded PRNG paints the same pixels on every run.
//
// The value structure the whole map is graded against:
//   shadow      12-20%  floor in shade, wall faces turned away from the key
//   mid         35-55%  brick and steel in the fill light
//   lit         65-80%  faces square to the key light
//   highlight   85-95%  lamp pools, painted markings, muzzle and impact flashes
//   accent      amber for the objective, cyan for the defending crew
import * as THREE from 'three';
import { mulberry32 } from '../mathx.js';

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function textureOf(canvas, { wrap = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.anisotropy = 8;
  return texture;
}

// A rect drawn again across the left and right edges, so a tiling texture has no seam.
function wrappedRect(context, x, y, width, height, size, fill) {
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  if (x < 0) context.fillRect(x + size, y, width, height);
  if (x + width > size) context.fillRect(x - size, y, width, height);
}

function speckle(context, size, count, colours, random, spread = 2.4) {
  for (let i = 0; i < count; i += 1) {
    context.fillStyle = colours[Math.floor(random() * colours.length)];
    context.fillRect(random() * size, random() * size, 0.6 + random() * spread, 0.6 + random() * spread);
  }
}

// Grime running down a wall: vertical strokes that fade out, low alpha, drawn twice across the
// seam so the streaks continue on the neighbouring tile.
function grime(context, size, count, colour, random, alpha = 0.18) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const width = 1 + random() * 7;
    const top = random() * size * 0.45;
    const height = size * (0.25 + random() * 0.6);
    const gradient = context.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.globalAlpha = alpha * (0.4 + random() * 0.6);
    context.fillStyle = gradient;
    context.fillRect(x, top, width, height);
    if (x + width > size) context.fillRect(x - size, top, width, height);
  }
  context.globalAlpha = 1;
}

// Brick: 1.2 m tile, 64 px courses, 128 px bricks, dark mortar, soot, chipped corners. The warm
// end of the palette: the kiln side of the map.
export function brickTexture(seed = 23) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#1f1815';
  context.fillRect(0, 0, size, size);
  const course = 64;
  const brick = 128;
  for (let row = 0; row < size / course; row += 1) {
    const offset = row % 2 === 0 ? 0 : brick / 2;
    for (let column = -1; column <= size / brick; column += 1) {
      const x = column * brick + offset;
      const y = row * course;
      const shade = 96 + Math.floor(random() * 58);
      wrappedRect(context, x + 3, y + 3, brick - 6, course - 6, size, `rgb(${shade + 40},${Math.floor(shade * 0.55)},${Math.floor(shade * 0.38)})`);
      wrappedRect(context, x + 3, y + 3, brick - 6, 3, size, 'rgba(255,232,208,0.14)');
      wrappedRect(context, x + 3, y + course - 7, brick - 6, 4, size, 'rgba(0,0,0,0.42)');
      if (random() < 0.18) {
        wrappedRect(context, x + 6 + random() * (brick - 26), y + course - 12, 6 + random() * 9, 8, size, 'rgba(26,18,14,0.8)');
      }
    }
  }
  speckle(context, size, 3400, ['#2a1d16', '#7d5238', '#b07a55'], random, 2.6);
  grime(context, size, 30, 'rgba(18,14,12,0.9)', random, 0.24);
  return textureOf(canvas);
}

// Concrete: the shell, the plinths and the props. Aggregate speckle, damp stains, hairline
// cracks, and an expansion joint on the tile edge so the grid reads at any size.
export function concreteTexture(seed = 11) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#6b665e';
  context.fillRect(0, 0, size, size);
  speckle(context, size, 5200, ['#57534c', '#7d776d', '#4a463f', '#8a8378'], random, 3.4);
  for (let i = 0; i < 26; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 12 + random() * 70;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(36,34,30,0.22)');
    gradient.addColorStop(1, 'rgba(36,34,30,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.strokeStyle = 'rgba(28,26,24,0.55)';
  context.lineWidth = 1.5;
  for (let i = 0; i < 9; i += 1) {
    let x = random() * size;
    let y = random() * size;
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 5; step += 1) {
      x += (random() - 0.5) * 40;
      y += 10 + random() * 26;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  context.strokeStyle = 'rgba(22,20,18,0.6)';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 2);
  context.lineTo(size, 2);
  context.moveTo(2, 0);
  context.lineTo(2, size);
  context.stroke();
  context.strokeStyle = 'rgba(200,190,175,0.12)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 7);
  context.lineTo(size, 7);
  context.moveTo(7, 0);
  context.lineTo(7, size);
  context.stroke();
  return textureOf(canvas);
}

// Painted steel: the cistern pen and the lamp posts. Cool blue-grey, panel seams, rivets, rust
// running from the seams, a lit edge along each panel.
export function steelTexture(seed = 31) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  const base = context.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, '#6b7a84');
  base.addColorStop(0.45, '#54626a');
  base.addColorStop(1, '#3f4b52');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(20,26,30,0.8)';
  context.lineWidth = 3;
  for (let i = 0; i <= 2; i += 1) {
    context.beginPath();
    context.moveTo(0, (i * size) / 2);
    context.lineTo(size, (i * size) / 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(size / 2, 0);
  context.lineTo(size / 2, size);
  context.stroke();
  context.strokeStyle = 'rgba(196,212,222,0.24)';
  context.lineWidth = 2;
  for (let i = 0; i <= 2; i += 1) {
    context.beginPath();
    context.moveTo(0, (i * size) / 2 + 4);
    context.lineTo(size, (i * size) / 2 + 4);
    context.stroke();
  }
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = 18 + column * 66 + (row % 2) * 8;
      const y = 18 + row * 66;
      context.fillStyle = 'rgba(22,28,32,0.85)';
      context.beginPath();
      context.arc(x, y, 3.4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(198,212,222,0.5)';
      context.beginPath();
      context.arc(x - 1, y - 1, 1.4, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (let i = 0; i < 18; i += 1) {
    const x = random() * size;
    const top = random() * size;
    const height = 20 + random() * 120;
    const gradient = context.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, 'rgba(126,72,36,0.55)');
    gradient.addColorStop(1, 'rgba(126,72,36,0)');
    context.fillStyle = gradient;
    context.fillRect(x, top, 2 + random() * 9, height);
  }
  speckle(context, size, 900, ['#3d484e', '#7f9099'], random, 2.2);
  return textureOf(canvas);
}

// Crate: pale timber with battens and a stencilled depot mark. High contrast against the floor,
// because a half-height crate is the map's main cover.
export function crateTexture(seed = 41) {
  const size = 256;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#7d5c34';
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 7; i += 1) {
    const shade = 132 + Math.floor(random() * 48);
    context.fillStyle = `rgb(${shade + 34},${Math.floor(shade * 0.76)},${Math.floor(shade * 0.44)})`;
    context.fillRect(0, (i * size) / 7 + 1, size, size / 7 - 3);
    context.fillStyle = 'rgba(52,34,18,0.35)';
    context.fillRect(0, (i * size) / 7 + size / 7 - 2, size, 2);
  }
  context.fillStyle = 'rgba(46,30,15,0.6)';
  context.fillRect(0, 0, size, 14);
  context.fillRect(0, size - 14, size, 14);
  context.fillRect(0, 0, 14, size);
  context.fillRect(size - 14, 0, 14, size);
  context.strokeStyle = 'rgba(38,24,13,0.5)';
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(14, 14);
  context.lineTo(size - 14, size - 14);
  context.stroke();
  context.fillStyle = 'rgba(240,225,200,0.34)';
  context.font = 'bold 26px ui-monospace, monospace';
  context.fillText('K9', size - 66, 66);
  speckle(context, size, 700, ['#5b4229', '#a8875a', '#3f2d1b'], random, 2.4);
  return textureOf(canvas);
}

// The floor: concrete tiles with a 1 m scored grid, oil and water stains, scuffs. Contact
// shading is baked into the ground mesh's vertex colours instead of this texture.
export function floorTexture(seed = 7) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#5d5750';
  context.fillRect(0, 0, size, size);
  speckle(context, size, 6000, ['#4c4740', '#6f6860', '#3d3933', '#7b746a', '#565049'], random, 3.4);
  for (let i = 0; i < 22; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 20 + random() * 90;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, random() < 0.6 ? 'rgba(24,22,20,0.28)' : 'rgba(126,116,100,0.16)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.strokeStyle = 'rgba(22,20,18,0.6)';
  context.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    context.beginPath();
    context.moveTo((i * size) / 4, 0);
    context.lineTo((i * size) / 4, size);
    context.moveTo(0, (i * size) / 4);
    context.lineTo(size, (i * size) / 4);
    context.stroke();
  }
  context.strokeStyle = 'rgba(190,180,164,0.11)';
  context.lineWidth = 1.6;
  for (let i = 0; i <= 4; i += 1) {
    context.beginPath();
    context.moveTo((i * size) / 4 + 3, 0);
    context.lineTo((i * size) / 4 + 3, size);
    context.moveTo(0, (i * size) / 4 + 3);
    context.lineTo(size, (i * size) / 4 + 3);
    context.stroke();
  }
  return textureOf(canvas);
}

// The sky: a vertical gradient dome. A canvas gradient cannot render black, which a shader sky
// can on software WebGL, so this is the reliable choice for capture.
export function skyTexture() {
  const canvas = canvasOf(64, 512);
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#22375c');
  gradient.addColorStop(0.34, '#4f6f9c');
  gradient.addColorStop(0.58, '#9d8478');
  gradient.addColorStop(0.8, '#d9a271');
  gradient.addColorStop(1, '#f0c491');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 512);
  return textureOf(canvas, { wrap: false });
}

// A sign plate: dark backing, stencilled text, drawn at 4x so the letters hold up close.
export function signTexture(text, sub, accent = '#ffb257') {
  const width = 512;
  const height = 192;
  const canvas = canvasOf(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#14161a';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = accent;
  context.lineWidth = 6;
  context.strokeRect(10, 10, width - 20, height - 20);
  context.fillStyle = '#f4efe4';
  context.font = 'bold 76px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, sub ? height / 2 - 16 : height / 2);
  if (sub) {
    context.fillStyle = accent;
    context.font = '600 30px ui-monospace, monospace';
    context.fillText(sub, width / 2, height / 2 + 48);
  }
  return textureOf(canvas, { wrap: false });
}

// The bomb site decal: a painted boundary, a wash and the site letter, laid on the floor.
export function siteTexture(letter, accent = '255,178,87') {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.strokeStyle = `rgba(${accent},0.92)`;
  context.lineWidth = 22;
  context.setLineDash([80, 40]);
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 34, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  const wash = context.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size / 2 - 40);
  wash.addColorStop(0, `rgba(${accent},0.32)`);
  wash.addColorStop(1, `rgba(${accent},0.05)`);
  context.fillStyle = wash;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 44, 0, Math.PI * 2);
  context.fill();
  // Sprayed stencil edge: a rough ring, so the paint reads as applied by hand.
  context.fillStyle = `rgba(${accent},0.6)`;
  for (let i = 0; i < 120; i += 1) {
    const angle = (i / 120) * Math.PI * 2;
    const radius = size / 2 - 58 + Math.sin(i * 2.3) * 4;
    context.fillRect(size / 2 + Math.cos(angle) * radius, size / 2 + Math.sin(angle) * radius, 4, 4);
  }
  context.fillStyle = 'rgba(255,236,214,0.95)';
  context.font = 'bold 300px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letter, size / 2, size / 2 + 12);
  return textureOf(canvas, { wrap: false });
}

// A lane stripe: amber dashes with worn gaps, painted once and stretched down the lane.
export function stripeTexture() {
  const canvas = canvasOf(128, 512);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 128, 512);
  context.fillStyle = 'rgba(255,178,87,0.62)';
  for (let y = 0; y < 512; y += 96) context.fillRect(34, y, 60, 58);
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 40; i += 1) context.fillRect(30 + ((i * 37) % 70), (i * 53) % 512, 6, 10);
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = 'rgba(30,28,26,0.3)';
  context.lineWidth = 4;
  context.strokeRect(2, 2, 124, 508);
  return textureOf(canvas);
}

// A hazard chevron plate: painted warning stripes for the mouth of each site.
export function hazardTexture() {
  const canvas = canvasOf(256, 256);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = 'rgba(255,178,87,0.55)';
  for (let i = -256; i < 512; i += 64) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i + 30, 0);
    context.lineTo(i + 286, 256);
    context.lineTo(i + 256, 256);
    context.closePath();
    context.fill();
  }
  context.strokeStyle = 'rgba(20,18,16,0.5)';
  context.lineWidth = 8;
  context.strokeRect(4, 4, 248, 248);
  return textureOf(canvas, { wrap: false });
}

// A soft radial sprite: smoke, dust, lamp glow, muzzle spill all reuse it.
export function puffTexture(inner = 'rgba(255,244,225,0.95)') {
  const size = 128;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.45)'));
  gradient.addColorStop(1, 'rgba(255,244,225,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return textureOf(canvas, { wrap: false });
}

// A four-point star for the muzzle flash itself: brighter than any surface in the scene.
export function flashTexture() {
  const size = 128;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,248,230,1)');
  gradient.addColorStop(0.25, 'rgba(255,206,140,0.9)');
  gradient.addColorStop(1, 'rgba(255,170,90,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'lighter';
  context.fillStyle = 'rgba(255,236,200,0.9)';
  context.fillRect(size / 2 - 4, 6, 8, size - 12);
  context.fillRect(6, size / 2 - 4, size - 12, 8);
  return textureOf(canvas, { wrap: false });
}

// A soft blob for a character's contact shadow on the floor.
export function blobShadowTexture() {
  const size = 128;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return textureOf(canvas, { wrap: false });
}

// A single dust mote: a tiny soft dot, drawn once for the point cloud.
export function moteTexture() {
  const size = 32;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,232,196,0.9)');
  gradient.addColorStop(1, 'rgba(255,232,196,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return textureOf(canvas, { wrap: false });
}

// World-scaled UVs: each box face is mapped in metres, so a 1.2 m brick tile stays 1.2 m on the
// chimney and on a lintel. BoxGeometry's groups are +X, -X, +Y, -Y, +Z, -Z in that order, four
// vertices each.
export function scaleBoxUv(geometry, width, height, depth, tile) {
  const uv = geometry.attributes.uv;
  const faces = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  for (let group = 0; group < 6; group += 1) {
    const [u, v] = faces[group];
    for (let corner = 0; corner < 4; corner += 1) {
      const index = group * 4 + corner;
      uv.setXY(index, (uv.getX(index) * u) / tile, (uv.getY(index) * v) / tile);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}
