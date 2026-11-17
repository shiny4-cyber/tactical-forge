// Builds the visible map from the same BOXES the simulation collides against: one mesh per
// box, a material per kind, a gradient sky dome, dusk lighting and the floor markings.
import * as THREE from 'three';
import { BOXES, LAMPS, SIGNS, MAP } from '../map.js';
import { concreteTexture, brickTexture, steelTexture, crateTexture, skyTexture, signTexture, siteTexture, stripeTexture } from './textures.js';

export function createWorldView(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const floorTexture = concreteTexture(11, 9);
  const brick = brickTexture(23, 2);
  const steel = steelTexture(31, 2);
  const crate = crateTexture(41);

  const materials = {
    wall: new THREE.MeshStandardMaterial({ color: new THREE.Color('#9a9288'), map: floorTexture, roughness: 0.95, metalness: 0.02 }),
    brick: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c08f74'), map: brick, roughness: 0.92, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: new THREE.Color('#8fa2ab'), map: steel, roughness: 0.62, metalness: 0.35 }),
    crate: new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8b47c'), map: crate, roughness: 0.86, metalness: 0.0 }),
    tank: new THREE.MeshStandardMaterial({ color: new THREE.Color('#93b6bd'), map: steel, roughness: 0.5, metalness: 0.45 }),
    floor: new THREE.MeshStandardMaterial({ color: new THREE.Color('#948d82'), map: concreteTexture(7, 10), roughness: 1.0, metalness: 0.0 }),
  };

  // Sky dome first, so anything missing a material still renders against a gradient, never black.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(210, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(new THREE.Color('#a08a78'), 55, 175);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 40), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  group.add(floor);

  const boxes = [];
  for (const box of BOXES) {
    const material = materials[box.kind] ?? materials.wall;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), material);
    mesh.position.set(box.x, box.y, box.z);
    mesh.userData.kind = box.kind;
    mesh.castShadow = box.kind !== 'metal' || box.h > 2;
    mesh.receiveShadow = true;
    group.add(mesh);
    boxes.push(mesh);
  }

  // Site decals: a painted circle and letter at each objective, laid flat on the floor.
  for (const site of MAP.sites) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4),
      new THREE.MeshBasicMaterial({ map: siteTexture(site.id), transparent: true, depthWrite: false, toneMapped: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.02, site.center.z);
    decal.renderOrder = 2;
    group.add(decal);
  }

  // Lane stripes: two painted runs down each approach, so the two lanes read from spawn.
  const stripe = stripeTexture();
  const stripeMaterial = new THREE.MeshBasicMaterial({ map: stripe, transparent: true, depthWrite: false, toneMapped: false });
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

  // Sign plates, each on a dark backing box so it reads as mounted, not floating.
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

  // Dusk light: a warm low sun, a cool sky fill, and the lamps as real point lights.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#c6d8f0'), new THREE.Color('#7c6a58'), 1.05);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(new THREE.Color('#ffdcc0'), 0.34));

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd0a0'), 2.7);
  sun.position.set(-26, 34, 30);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0007;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(new THREE.Color('#7ba0c8'), 0.75);
  rim.position.set(24, 16, -30);
  scene.add(rim);

  const lampMeshes = [];
  for (const lamp of LAMPS) {
    const light = new THREE.PointLight(new THREE.Color(lamp.color), lamp.intensity, 26, 1.6);
    light.position.set(lamp.x, lamp.y, lamp.z);
    scene.add(light);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(lamp.color), toneMapped: false }),
    );
    bulb.position.set(lamp.x, lamp.y, lamp.z);
    scene.add(bulb);
    lampMeshes.push(bulb);
  }

  return { group, boxes, materials, sky, lampMeshes, sun };
}
