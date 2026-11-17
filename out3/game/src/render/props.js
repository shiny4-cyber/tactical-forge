// Props the simulation owns but does not draw: the cinder charge and the thrown grenades.
// Both are small pooled meshes posed from state every frame.
import * as THREE from 'three';

export function createPropsView(scene) {
  const caseMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2f33'), roughness: 0.7, metalness: 0.3 });
  const ledMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4a3a'), toneMapped: false });
  const bomb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3), caseMaterial);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), ledMaterial);
  led.position.set(0.12, 0.15, 0);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), caseMaterial);
  handle.position.set(-0.08, 0.16, 0);
  handle.rotation.x = Math.PI / 2;
  bomb.add(body, led, handle);
  bomb.visible = false;
  scene.add(bomb);

  const bombLight = new THREE.PointLight(new THREE.Color('#ff4a3a'), 0, 8, 2);
  scene.add(bombLight);

  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4c5a48'), roughness: 0.7, metalness: 0.3 });
  const grenades = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), grenadeMaterial);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push(mesh);
  }

  let blink = 0;

  return {
    update(dt, bombState, liveGrenades) {
      blink += dt * (bombState.state === 'planted' ? 7 : 2);
      const on = Math.sin(blink) > 0.2;
      ledMaterial.color.setHex(on ? 0xff4a3a : 0x4a1410);
      bombLight.intensity = on && bombState.state === 'planted' ? 3 : 0;
      if (bombState.state === 'planted' || bombState.state === 'dropped') {
        bomb.visible = true;
        bomb.position.set(bombState.x, bombState.state === 'planted' ? 0.12 : 0.14, bombState.z);
        bomb.rotation.y += dt * 0.4;
      } else {
        bomb.visible = false;
        bombLight.intensity = 0;
      }
      for (let i = 0; i < grenades.length; i += 1) {
        const grenade = liveGrenades[i];
        if (!grenade) {
          grenades[i].visible = false;
          continue;
        }
        grenades[i].visible = true;
        grenades[i].position.set(grenade.x, grenade.y, grenade.z);
        grenades[i].rotation.x += dt * 8;
      }
    },
  };
}
