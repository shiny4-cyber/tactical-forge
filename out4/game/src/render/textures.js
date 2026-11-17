// Every texture is painted here with a canvas at load time: no files, no network, no borrowed
// art. Noise comes from a seeded PRNG, so two runs paint the same pixels.
import * as THREE from 'three';
import { mulberry32 } from '../mathx.js';

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function finish(canvas, { repeatX = 1, repeatY = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

function speckle(context, width, height, count, colors, random, size = 3) {
  for (let i = 0; i < count; i += 1) {
    context.fillStyle = colors[Math.floor(random() * colors.length)];
    const x = random() * width;
    const y = random() * height;
    const s = 1 + random() * size;
    context.fillRect(x, y, s, s);
  }
}

function streaks(context, width, height, count, color, random) {
  context.strokeStyle = color;
  context.lineWidth = 1;
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    context.globalAlpha = 0.05 + random() * 0.12;
    context.beginPath();
    context.moveTo(x, random() * height * 0.3);
    context.lineTo(x + (random() - 0.5) * 20, height * (0.5 + random() * 0.5));
    context.stroke();
  }
  context.globalAlpha = 1;
}

// Concrete: cold grey with a hint of blue, so the warm lamps separate from it.
export function concreteTexture(seed = 11, repeat = 8) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#4c4a45';
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i += 1) {
    const shade = 60 + Math.floor(random() * 40);
    context.fillStyle = `rgb(${shade},${shade - 2},${shade - 6})`;
    const x = random() * size;
    const y = random() * size;
    context.fillRect(x, y, 1 + random() * 3, 1 + random() * 3);
  }
  // Expansion joints.
  context.strokeStyle = 'rgba(20,20,22,0.55)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, size / 2);
  context.lineTo(size, size / 2);
  context.moveTo(size / 2, 0);
  context.lineTo(size / 2, size);
  context.stroke();
  streaks(context, size, size, 30, '#2b2b2d', random);
  return finish(canvas, { repeatX: repeat, repeatY: repeat });
}

// Brick: warm brown-red, so the kiln side of the map reads warm against the cold steel.
export function brickTexture(seed = 23, repeat = 3) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#3a2a22';
  context.fillRect(0, 0, size, size);
  const rows = 16;
  const brickHeight = size / rows;
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 0 ? 0 : size / 16;
    for (let column = -1; column < 9; column += 1) {
      const x = column * (size / 8) + offset;
      const shade = 96 + Math.floor(random() * 42);
      context.fillStyle = `rgb(${shade + 32},${Math.floor(shade * 0.62)},${Math.floor(shade * 0.45)})`;
      context.fillRect(x + 2, row * brickHeight + 2, size / 8 - 4, brickHeight - 4);
    }
  }
  speckle(context, size, size, 900, ['#2a1d18', '#6b4632'], random, 2);
  return finish(canvas, { repeatX: repeat, repeatY: repeat });
}

// Painted steel: cool blue-grey, riveted, with rust bleeding from the seams.
export function steelTexture(seed = 31, repeat = 2) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  const gradient = context.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#5a666d');
  gradient.addColorStop(0.5, '#48545b');
  gradient.addColorStop(1, '#39444a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(24,30,34,0.75)';
  context.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    context.beginPath();
    context.moveTo(0, (i * size) / 4);
    context.lineTo(size, (i * size) / 4);
    context.stroke();
  }
  for (let i = 0; i < 60; i += 1) {
    const x = random() * size;
    const y = random() * size;
    context.fillStyle = 'rgba(40,46,50,0.9)';
    context.beginPath();
    context.arc(x, y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(150,160,166,0.5)';
    context.beginPath();
    context.arc(x - 0.8, y - 0.8, 1.1, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = 'rgba(126,74,38,0.35)';
  for (let i = 0; i < 26; i += 1) {
    context.fillRect(random() * size, random() * size, 2 + random() * 8, 1 + random() * 30);
  }
  return finish(canvas, { repeatX: repeat, repeatY: repeat });
}

// Crate: pale timber with battens, drawn to read as cover at a glance.
export function crateTexture(seed = 41) {
  const size = 256;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  const random = mulberry32(seed);
  context.fillStyle = '#8a6a3f';
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i += 1) {
    const shade = 120 + Math.floor(random() * 40);
    context.fillStyle = `rgb(${shade + 30},${Math.floor(shade * 0.78)},${Math.floor(shade * 0.45)})`;
    context.fillRect(0, (i * size) / 8, size, size / 8 - 2);
  }
  context.fillStyle = '#4a3420';
  context.fillRect(0, 0, size, 10);
  context.fillRect(0, size - 10, size, 10);
  context.fillRect(0, 0, 10, size);
  context.fillRect(size - 10, 0, 10, size);
  context.strokeStyle = 'rgba(40,26,14,0.8)';
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(size, size);
  context.stroke();
  speckle(context, size, size, 200, ['#5b4229', '#a8875a'], random, 2);
  return finish(canvas);
}

// The sky: a vertical gradient dome. A canvas gradient cannot render black, which a shader sky
// can on software WebGL, so this is the reliable choice for capture.
export function skyTexture() {
  const canvas = canvasOf(64, 512);
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#2d4670');
  gradient.addColorStop(0.32, '#5b7ba6');
  gradient.addColorStop(0.58, '#a98a80');
  gradient.addColorStop(0.8, '#dda878');
  gradient.addColorStop(1, '#f2c48e');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 512);
  return finish(canvas);
}

// A sign plate: dark backing, stencilled text, drawn at 4x so the letters hold up close.
export function signTexture(text, sub, accent = '#ffb257') {
  const width = 512;
  const height = 192;
  const canvas = canvasOf(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#16181a';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = accent;
  context.lineWidth = 6;
  context.strokeRect(10, 10, width - 20, height - 20);
  context.fillStyle = '#f2ede2';
  context.font = 'bold 76px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, sub ? height / 2 - 16 : height / 2);
  if (sub) {
    context.fillStyle = accent;
    context.font = '600 30px ui-monospace, monospace';
    context.fillText(sub, width / 2, height / 2 + 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The bomb site decal: a painted circle with the site letter, laid on the floor.
export function siteTexture(letter) {
  const size = 512;
  const canvas = canvasOf(size, size);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.strokeStyle = 'rgba(255,178,87,0.85)';
  context.lineWidth = 18;
  context.setLineDash([70, 34]);
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 30, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(255,178,87,0.22)';
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 40, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(255,235,210,0.92)';
  context.font = 'bold 300px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letter, size / 2, size / 2 + 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A lane stripe: amber dashes, painted once and stretched.
export function stripeTexture() {
  const canvas = canvasOf(128, 512);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 128, 512);
  context.fillStyle = 'rgba(255,178,87,0.5)';
  for (let y = 0; y < 512; y += 96) context.fillRect(34, y, 60, 56);
  context.strokeStyle = 'rgba(30,28,26,0.35)';
  context.lineWidth = 4;
  context.strokeRect(2, 2, 124, 508);
  return finish(canvas);
}
