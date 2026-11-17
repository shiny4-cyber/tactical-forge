// The bodies: one mesh group per bot, driven by the simulation's state, plus the first-person
// weapon in front of the camera. The renderer never decides anything; it poses what sim says.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.14;

function teamColor(team) {
  return new THREE.Color(team === 'attackers' ? PALETTE.attackers : PALETTE.defenders);
}

export function createActorView(scene, actor) {
  const color = teamColor(actor.team);
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(actor.team === 'attackers' ? '#584434' : '#33454c'), roughness: 0.85 });
  const plate = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2f33'), roughness: 0.6, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.45), roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b98d68'), roughness: 0.8 });

  const group = new THREE.Group();
  const hips = new THREE.Group();
  group.add(hips);

  const legGeometry = new THREE.BoxGeometry(0.17, 0.78, 0.19);
  const leftLeg = new THREE.Mesh(legGeometry, cloth);
  leftLeg.position.set(-0.13, 0.39, 0);
  const rightLeg = new THREE.Mesh(legGeometry, cloth);
  rightLeg.position.set(0.13, 0.39, 0);
  hips.add(leftLeg, rightLeg);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), cloth);
  torso.position.set(0, 1.1, 0);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.36), plate);
  vest.position.set(0, 1.16, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.38), accent);
  band.position.set(0, 1.3, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), skin);
  head.position.set(0, 1.55, 0);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.152, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate);
  helmet.position.set(0, 1.575, 0);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), cloth);
  shoulders.position.set(0, 1.38, 0);
  hips.add(torso, vest, band, head, helmet, shoulders);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), plate);
  gun.position.set(0.16, 1.18, -0.34);
  hips.add(gun);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.userData.actor = actor.id;
  scene.add(group);

  return {
    group,
    hips,
    material: { cloth, accent, plate },
    actor,
    fall: 0,
    flash: 0,
    update(dt, now) {
      const alive = actor.alive;
      group.position.set(actor.x, actor.y, actor.z);
      group.rotation.y = actor.yaw;
      const crouch = actor.crouching ? HEIGHT_CROUCH / HEIGHT_STAND : 1;
      hips.scale.y = crouch;
      head.rotation.x = -actor.pitch * 0.8;
      if (alive) {
        const stride = Math.sin(actor.stepPhase ?? 0) * 0.16;
        leftLeg.rotation.x = stride;
        rightLeg.rotation.x = -stride;
        hips.position.y = Math.abs(Math.cos(actor.stepPhase ?? 0)) * 0.02;
        // A hit flashes the vest accent; the flash decays over a sixth of a second.
        this.flash = Math.max(0, this.flash - dt);
        accent.emissiveIntensity = 1 + this.flash * 6;
      } else {
        // A dead body folds onto its side and stays there as cover and as information.
        this.fall = Math.min(1, this.fall + dt * 3.2);
        group.rotation.z = this.fall * 1.45;
        group.position.y = actor.y + this.fall * 0.16;
        leftLeg.rotation.x = 0.2;
        rightLeg.rotation.x = -0.2;
        accent.emissiveIntensity = Math.max(0, 1 - this.fall * 0.8);
      }
    },
    hit() {
      this.flash = 1;
    },
    dispose() {
      scene.remove(group);
    },
  };
}

// The first-person rifle: boxes, a muzzle flash and a reload dip. It hangs off the camera, so
// it inherits the look and needs no world transform of its own.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c3238'), roughness: 0.45, metalness: 0.6 });
  const polymer = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3d464d'), roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6a5140'), roughness: 0.9 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.44), metal);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.075, 0.34), polymer);
  handguard.position.set(0, 0.005, -0.36);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.34, 8), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.62);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.26), polymer);
  stock.position.set(0, -0.012, 0.33);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.1), polymer);
  magazine.position.set(0, -0.13, -0.05);
  magazine.rotation.x = 0.16;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), metal);
  sight.position.set(0, 0.08, -0.12);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.12), glove);
  hand.position.set(0, -0.075, 0.09);
  const foreHand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.13), glove);
  foreHand.position.set(0, -0.06, -0.32);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd08a'), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  flash.position.set(0, 0.02, -0.82);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffcf8a'), 0, 6, 2);
  flashLight.position.set(0, 0.05, -0.7);

  group.add(receiver, handguard, barrel, stock, magazine, sight, hand, foreHand, flash, flashLight);
  group.position.set(0.2, -0.19, -0.42);
  camera.add(group);

  return {
    group,
    update(dt, player, arsenal) {
      // Recoil pulls the rifle back and up; reloading dips it out of the sight line.
      const kick = Math.max(0, player.recoilPitch);
      const reload = arsenal.reloadLeft > 0 ? Math.min(1, arsenal.reloadLeft / 1.2) : 0;
      group.position.z = -0.42 + kick * 0.5 + reload * 0.12;
      group.position.y = -0.19 + kick * 0.12 - reload * 0.16;
      group.rotation.x = kick * 1.4 + reload * 0.55;
      const bob = player.alive ? Math.sin(player.stepPhase) * 0.008 : 0;
      group.position.x = 0.2 + bob;
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 18);
      flash.rotation.z += dt * 12;
      flashLight.intensity = flash.material.opacity * 9;
    },
    fire() {
      flash.material.opacity = 1;
      flash.rotation.z = Math.random() * Math.PI;
    },
  };
}
