// Tracers, impacts, blood and explosions. Every effect lives in a fixed pool allocated at
// load: the render loop only moves and hides objects, it never creates one.
import * as THREE from 'three';

const TRACER_COUNT = 28;
const IMPACT_COUNT = 20;
const BLOOD_COUNT = 14;
const BLAST_COUNT = 3;

function tracerPool(scene) {
  const pool = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.9, toneMapped: false }),
    );
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    pool.push({ line, positions, life: 0 });
  }
  return { pool, next: 0 };
}

function quadPool(scene, count, size, color, opacity) {
  const pool = [];
  const geometry = new THREE.PlaneGeometry(size, size);
  for (let i = 0; i < count; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, life: 0, maxLife: 0.2 });
  }
  return { pool, next: 0 };
}

export function createEffects(scene) {
  const tracers = tracerPool(scene);
  const impacts = quadPool(scene, IMPACT_COUNT, 0.22, '#ffd08a', 0.85);
  const blood = quadPool(scene, BLOOD_COUNT, 0.3, '#c33a2c', 0.75);
  const blasts = [];
  for (let i = 0; i < BLAST_COUNT; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb257'), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const light = new THREE.PointLight(new THREE.Color('#ff9a4a'), 0, 18, 2);
    scene.add(light);
    blasts.push({ mesh, light, life: 0, maxLife: 0.55, size: 1 });
  }

  function spawnTracer(ax, ay, az, bx, by, bz) {
    const slot = tracers.pool[tracers.next % TRACER_COUNT];
    tracers.next += 1;
    slot.positions[0] = ax;
    slot.positions[1] = ay;
    slot.positions[2] = az;
    slot.positions[3] = bx;
    slot.positions[4] = by;
    slot.positions[5] = bz;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.visible = true;
    slot.line.material.opacity = 0.95;
    slot.life = 0.07;
  }

  function spawnQuad(pool, x, y, z, sizeScale = 1) {
    const slot = pool.pool[pool.next % pool.pool.length];
    pool.next += 1;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(sizeScale);
    slot.mesh.visible = true;
    slot.mesh.material.opacity = pool === impacts ? 0.9 : 0.8;
    slot.life = slot.maxLife;
  }

  function spawnBlast(x, y, z, big) {
    let slot = blasts[0];
    for (const candidate of blasts) if (candidate.life < slot.life) slot = candidate;
    slot.mesh.position.set(x, y, z);
    slot.light.position.set(x, y + 0.6, z);
    slot.life = slot.maxLife;
    slot.size = big ? 6.5 : 3.2;
    slot.mesh.visible = true;
    slot.light.intensity = big ? 90 : 30;
  }

  function handle(events) {
    if (!events) return;
    for (const event of events) {
      if (event.type === 'shot' && event.tx !== undefined) {
        spawnTracer(event.x, event.y, event.z, event.tx, event.ty, event.tz);
      } else if (event.type === 'impact') {
        spawnQuad(impacts, event.x, event.y, event.z);
      } else if (event.type === 'hit') {
        spawnQuad(blood, event.x, event.y, event.z, event.part === 'head' ? 1.6 : 1);
      } else if (event.type === 'explosion') {
        spawnBlast(event.x, event.y, event.z, event.big === true);
      }
    }
  }

  function update(dt, camera) {
    for (const slot of tracers.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.line.material.opacity = Math.max(0, slot.life / 0.07) * 0.95;
      if (slot.life <= 0) slot.line.visible = false;
    }
    for (const pool of [impacts, blood]) {
      for (const slot of pool.pool) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.mesh.material.opacity = Math.max(0, slot.life / slot.maxLife) * 0.85;
        if (camera) slot.mesh.quaternion.copy(camera.quaternion);
        if (slot.life <= 0) slot.mesh.visible = false;
      }
    }
    for (const slot of blasts) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const t = 1 - slot.life / slot.maxLife;
      slot.mesh.scale.setScalar(0.4 + t * slot.size);
      slot.mesh.material.opacity = Math.max(0, 0.9 - t) * 1.1;
      slot.light.intensity = Math.max(0, (1 - t)) * (slot.size > 4 ? 80 : 30);
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        slot.light.intensity = 0;
      }
    }
  }

  return { handle, update };
}
