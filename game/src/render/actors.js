// The bodies: one mesh group per bot, driven by the simulation's state, plus the first-person
// weapon in front of the camera. The renderer never decides anything; it poses what sim says.
//
// Silhouette rule: the two crews must be tellable apart at 30 m by shape before colour. PACKERS
// (attackers) carry a bulky back pack and a brimmed helmet; WARDENS (defenders) wear a shoulder
// cape and a thin antenna, and no pack. Both carry one saturated shoulder patch in the crew
// colour, which is the only strongly saturated thing on either body.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { blobShadowTexture, flashTexture } from './textures.js';

const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.14;

function teamColor(team) {
  return new THREE.Color(team === 'attackers' ? PALETTE.attackers : PALETTE.defenders);
}

let shadowTexture = null;
function shadowMaterial() {
  if (!shadowTexture) shadowTexture = blobShadowTexture();
  return new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    toneMapped: false,
    color: new THREE.Color('#000000'),
  });
}

export function createActorView(scene, actor) {
  const color = teamColor(actor.team);
  const attacker = actor.team === 'attackers';
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(attacker ? '#4d3a2b' : '#2f4048'), roughness: 0.9 });
  const clothLight = new THREE.MeshStandardMaterial({ color: new THREE.Color(attacker ? '#6d533c' : '#41565f'), roughness: 0.86 });
  const plate = new THREE.MeshStandardMaterial({ color: new THREE.Color('#242a2e'), roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.5), roughness: 0.45 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b0855f'), roughness: 0.82 });

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
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.085, 0.38), accent);
  band.position.set(0, 1.32, 0);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), clothLight);
  shoulders.position.set(0, 1.38, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), skin);
  head.position.set(0, 1.55, 0);
  hips.add(torso, vest, band, shoulders, head);

  // Shape cue, one per crew.
  if (attacker) {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.2), clothLight);
    pack.position.set(0, 1.16, 0.24);
    const packStrap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.22), plate);
    packStrap.position.set(0, 1.34, 0.2);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.158, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    helmet.position.set(0, 1.585, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.1), plate);
    brim.position.set(0, 1.56, -0.14);
    hips.add(pack, packStrap, helmet, brim);
  } else {
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.06), clothLight);
    cape.position.set(0, 1.2, 0.2);
    cape.rotation.x = 0.12;
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.3), clothLight);
    collar.position.set(0, 1.44, 0.02);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 5), plate);
    antenna.position.set(-0.24, 1.5, 0.06);
    antenna.rotation.z = 0.18;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.3), plate);
    cap.position.set(0, 1.57, 0);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.12), plate);
    visor.position.set(0, 1.55, -0.15);
    hips.add(cape, collar, antenna, cap, visor);
  }

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), plate);
  gun.position.set(0.16, 1.18, -0.34);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), clothLight);
  gunGrip.position.set(0.16, 1.1, -0.16);
  hips.add(gun, gunGrip);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.userData.actor = actor.id;
  scene.add(group);

  // Contact shadow: a soft blob on the floor, so a body sits on the ground instead of hovering.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  scene.add(shadow);

  return {
    group,
    hips,
    shadow,
    material: { cloth, clothLight, accent, plate },
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
      shadow.position.set(actor.x, actor.y + 0.012, actor.z);
      shadow.scale.setScalar(actor.crouching ? 0.86 : 1);
      if (alive) {
        const stride = Math.sin(actor.stepPhase ?? 0) * 0.16;
        leftLeg.rotation.x = stride;
        rightLeg.rotation.x = -stride;
        hips.position.y = Math.abs(Math.cos(actor.stepPhase ?? 0)) * 0.02;
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
        shadow.material.opacity = Math.max(0.2, 0.7 - this.fall * 0.4);
      }
    },
    hit() {
      this.flash = 1;
    },
    dispose() {
      scene.remove(group);
      scene.remove(shadow);
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
  };
}

// The first-person rifle: boxes, two-tone, an inverted-hull outline and a muzzle flash. It hangs
// off the camera, so it inherits the look and needs no world transform of its own. The outline is
// what stops it reading as a grey rectangle against a grey wall: same geometry, back faces only,
// scaled up a few per cent.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1f252a'), roughness: 0.42, metalness: 0.6 });
  const mid = new THREE.MeshStandardMaterial({ color: new THREE.Color('#39444b'), roughness: 0.7, metalness: 0.25 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5b6a72'), roughness: 0.55, metalness: 0.35 });
  const glove = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b5140'), roughness: 0.92 });
  const outline = new THREE.MeshBasicMaterial({ color: new THREE.Color('#090b0d'), side: THREE.BackSide });

  const parts = [];
  function add(mesh, outlineScale = 1.09) {
    group.add(mesh);
    parts.push(mesh);
    if (outlineScale > 0) {
      const shell = new THREE.Mesh(mesh.geometry, outline);
      shell.position.copy(mesh.position);
      shell.rotation.copy(mesh.rotation);
      shell.scale.setScalar(outlineScale);
      group.add(shell);
    }
    return mesh;
  }

  const receiver = add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.42), mid));
  const topCover = add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.3), light), 1.05);
  topCover.position.set(0, 0.068, -0.02);
  const handguard = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.34), dark));
  handguard.position.set(0, 0.004, -0.36);
  const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.3), light), 1.0);
  rail.position.set(0, 0.052, -0.36);
  const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.32, 8), dark), 1.15);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.62);
  const muzzleBrake = add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.08), light), 1.12);
  muzzleBrake.position.set(0, 0.012, -0.8);
  const stock = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.26), mid));
  stock.position.set(0, -0.012, 0.32);
  const cheek = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.16), light), 1.04);
  cheek.position.set(0, 0.05, 0.3);
  const magazine = add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.1), dark));
  magazine.position.set(0, -0.13, -0.05);
  magazine.rotation.x = 0.16;
  const magRibA = add(new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.018, 0.104), light), 1.0);
  magRibA.position.set(0, -0.09, -0.05);
  const magRibB = add(new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.018, 0.104), light), 1.0);
  magRibB.position.set(0, -0.15, -0.05);
  const sight = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.06), dark));
  sight.position.set(0, 0.088, -0.12);
  const frontPost = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), light), 1.0);
  frontPost.position.set(0, 0.075, -0.48);
  const charging = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.07), light), 1.0);
  charging.position.set(0.05, 0.03, 0.02);
  const hand = add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.12), glove), 1.06);
  hand.position.set(0, -0.075, 0.09);
  const foreHand = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.13), glove), 1.06);
  foreHand.position.set(0, -0.062, -0.32);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  flash.position.set(0, 0.02, -0.86);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffcf8a'), 0, 6, 2);
  flashLight.position.set(0, 0.05, -0.72);

  group.add(flash, flashLight);
  group.position.set(0.2, -0.19, -0.42);
  camera.add(group);

  return {
    group,
    parts,
    update(dt, player, arsenal) {
      // Recoil pulls the rifle back and up; reloading dips it out of the sight line.
      const kick = Math.max(0, player.recoilPitch);
      const reload = arsenal.reloadLeft > 0 ? Math.min(1, arsenal.reloadLeft / 1.2) : 0;
      group.position.z = -0.42 + kick * 0.5 + reload * 0.12;
      group.position.y = -0.19 + kick * 0.12 - reload * 0.16;
      group.rotation.x = kick * 1.4 + reload * 0.55;
      const bob = player.alive ? Math.sin(player.stepPhase) * 0.008 : 0;
      group.position.x = 0.2 + bob;
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 16);
      flash.rotation.z += dt * 12;
      flashLight.intensity = flash.material.opacity * 7;
    },
    fire() {
      flash.material.opacity = 1;
      flash.rotation.z = Math.random() * Math.PI;
    },
  };
}
