// Builds the visible map from the same BOXES the simulation collides against: one mesh per box
// with metre-scaled UVs, a painted floor whose vertex colours carry the contact shading, a
// gradient sky, and one deliberate light rig.
//
// The rig is the art direction: a single warm key from the north-west (so every face turned
// south or east is lit and the rest falls into a readable shadow), a cool sky fill and a low
// ambient that keeps shadowed walls above 12%, warm practical lamps over the two sites, and a
// cool rim so silhouettes separate from the sky. Values are graded to the table in textures.js.
import * as THREE from 'three';
import { BOXES, LAMPS, SIGNS, MAP } from '../map.js';
import {
  brickTexture,
  concreteTexture,
  steelTexture,
  crateTexture,
  floorTexture,
  skyTexture,
  signTexture,
  siteTexture,
  stripeTexture,
  hazardTexture,
  puffTexture,
  scaleBoxUv,
} from './textures.js';

const TILE = { brick: 1.2, wall: 2.2, metal: 1.6, tank: 1.6, crate: 1.0, floor: 4.0 };

// Distance from a point to a rectangle in the floor plane: the contact-shading input.
function distanceToBox(x, z, box) {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}

export function createWorldView(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    wall: new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfcac1'), map: concreteTexture(11), roughness: 0.94, metalness: 0.02 }),
    brick: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e2c6b4'), map: brickTexture(23), roughness: 0.9, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9c7cf'), map: steelTexture(31), roughness: 0.58, metalness: 0.4 }),
    crate: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ead3ac'), map: crateTexture(41), roughness: 0.88, metalness: 0.0 }),
    tank: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c3d6dc'), map: steelTexture(37), roughness: 0.46, metalness: 0.5 }),
  };

  // The sky dome is added first, so anything that fails to draw still shows a gradient, never black.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(210, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(new THREE.Color('#9a8574'), 46, 160);

  // --- floor ---------------------------------------------------------------------------------
  // One 1 m grid, so the contact shading is per-vertex: dark where a wall or a crate meets the
  // concrete, a second darker band right at the joint (the trim read), clean 2 m out.
  const floorGeometry = new THREE.PlaneGeometry(48, 40, 48, 40);
  const position = floorGeometry.attributes.position;
  const colour = new Float32Array(position.count * 3);
  const solidFootprints = BOXES.filter((box) => box.solid && box.y - box.h / 2 < 0.6).map((box) => ({
    minX: box.x - box.w / 2,
    maxX: box.x + box.w / 2,
    minZ: box.z - box.d / 2,
    maxZ: box.z + box.d / 2,
  }));
  for (let i = 0; i < position.count; i += 1) {
    // The plane is built in XY and rotated; its local x is world x, its local y is world -z.
    const x = position.getX(i);
    const z = -position.getY(i);
    let nearest = Infinity;
    for (const footprint of solidFootprints) {
      const d = distanceToBox(x, z, footprint);
      if (d < nearest) nearest = d;
    }
    const contact = Math.min(1, Math.exp(-nearest / 0.8));
    const trim = nearest < 0.16 ? 0.22 : 0;
    const shade = Math.max(0.24, 1 - contact * 0.62 - trim);
    // A hair of cool tint in the shade keeps the shadow from reading as dirt.
    colour[i * 3] = shade;
    colour[i * 3 + 1] = shade * 0.985;
    colour[i * 3 + 2] = shade * 0.97;
  }
  floorGeometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b9b2a6'),
    map: floorTexture(7),
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  floorMaterial.map.repeat.set(48 / TILE.floor, 40 / TILE.floor);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // --- boxes ---------------------------------------------------------------------------------
  const boxes = [];
  for (const box of BOXES) {
    const material = materials[box.kind] ?? materials.wall;
    const geometry = new THREE.BoxGeometry(box.w, box.h, box.d);
    scaleBoxUv(geometry, box.w, box.h, box.d, TILE[box.kind] ?? TILE.wall);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(box.x, box.y, box.z);
    mesh.userData.kind = box.kind;
    mesh.castShadow = box.kind !== 'metal' || box.h > 2;
    mesh.receiveShadow = true;
    group.add(mesh);
    boxes.push(mesh);
  }

  // --- painted markings ----------------------------------------------------------------------
  for (const site of MAP.sites) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 7.2),
      new THREE.MeshBasicMaterial({ map: siteTexture(site.id), transparent: true, depthWrite: false, toneMapped: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.02, site.center.z);
    decal.renderOrder = 2;
    group.add(decal);
  }

  const stripeMaterial = new THREE.MeshBasicMaterial({ map: stripeTexture(), transparent: true, depthWrite: false, toneMapped: false });
  for (const [x, z, length] of [
    [-19.5, 6, 26],
    [-16.5, 10, 12],
    [19.5, 6, 26],
    [16.5, 10, 12],
  ]) {
    const path = new THREE.Mesh(new THREE.PlaneGeometry(0.7, length), stripeMaterial);
    path.rotation.x = -Math.PI / 2;
    path.position.set(x, 0.015, z);
    path.renderOrder = 1;
    group.add(path);
  }

  // Hazard bands across the mouth of each site, so the entrances read from the lane.
  const hazard = new THREE.MeshBasicMaterial({ map: hazardTexture(), transparent: true, depthWrite: false, toneMapped: false });
  for (const [x, z, width, yaw] of [
    [-14, -6.9, 3.0, 0],
    [12.4, -5.7, 3.4, 0],
    [9.2, -8.6, 2.4, Math.PI / 2],
  ]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.9), hazard);
    band.rotation.x = -Math.PI / 2;
    band.rotation.z = yaw;
    band.position.set(x, 0.018, z);
    band.renderOrder = 1;
    group.add(band);
  }

  // --- signage -------------------------------------------------------------------------------
  for (const sign of SIGNS) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(sign.w, sign.h),
      new THREE.MeshBasicMaterial({ map: signTexture(sign.text, sign.sub), toneMapped: false }),
    );
    plate.position.set(sign.x + Math.sin(sign.yaw) * 0.06, sign.y, sign.z + Math.cos(sign.yaw) * 0.06);
    plate.rotation.y = sign.yaw;
    group.add(plate);
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(sign.w + 0.16, sign.h + 0.16, 0.08),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.9 }),
    );
    backing.position.set(sign.x, sign.y, sign.z);
    backing.rotation.y = sign.yaw;
    group.add(backing);
  }

  // --- light rig -----------------------------------------------------------------------------
  // Fill: cool sky over warm ground bounce, so a shadowed wall keeps its colour and stays above
  // the 12% floor of the value table.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#a9c4e6'), new THREE.Color('#6a5847'), 0.62));
  scene.add(new THREE.AmbientLight(new THREE.Color('#ffd9bd'), 0.16));

  // Key: one warm sun low in the north-west. Shadow bias is tuned for a 1 m wall, not for a
  // character, because the walls are where the contact read matters.
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd2a1'), 3.2);
  sun.position.set(-30, 30, -24);
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Rim: cool, from the south-east, so silhouettes separate from the sky and from the brick.
  const rim = new THREE.DirectionalLight(new THREE.Color('#7ea6d2'), 0.62);
  rim.position.set(26, 14, 30);
  scene.add(rim);

  // Practical lamps: five small ones around the yard, and a warm pool over each site. The site
  // lights are the only warm highlights in the north half of the map, which is what makes a
  // site read as "the objective" from a lane.
  const lampMeshes = [];
  const lampGlow = new THREE.MeshBasicMaterial({
    map: puffTexture('rgba(255,214,160,0.9)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const allLamps = [
    ...LAMPS,
    { x: -13, y: 3.5, z: -11.6, color: 0xffb257, intensity: 42, distance: 19 },
    { x: 13, y: 3.6, z: -10.4, color: 0x9fe6ff, intensity: 26, distance: 16 },
  ];
  for (const lamp of allLamps) {
    const light = new THREE.PointLight(new THREE.Color(lamp.color), lamp.intensity, lamp.distance ?? 26, 1.7);
    light.position.set(lamp.x, lamp.y, lamp.z);
    scene.add(light);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(lamp.color), toneMapped: false }),
    );
    bulb.position.set(lamp.x, lamp.y, lamp.z);
    scene.add(bulb);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), lampGlow);
    halo.position.set(lamp.x, lamp.y, lamp.z);
    halo.userData.billboard = true;
    scene.add(halo);
    lampMeshes.push(bulb, halo);
  }

  return { group, boxes, materials, sky, lampMeshes, sun, floor };
}
