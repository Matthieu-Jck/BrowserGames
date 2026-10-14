// entity.js — the thing from the lower floors. Matte black, 2.4m tall.
// It freezes while your flashlight pins it; hold the beam long enough and it
// flees. Look away in the dark and it closes fast.

import * as THREE from 'three';
import { CELL, W, H } from './map.js';

const KILL_DIST = 1.0;
const SEAR_TIME = 2.4;

export class Entity {
  constructor(scene, world) {
    this.world = world;
    this.scene = scene;

    const mat = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 1.0 });
    const g = this.group = new THREE.Group();

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.5, 4, 10), mat);
    body.position.y = 1.35;
    body.scale.set(1, 1.08, 0.7);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mat);
    head.position.y = 2.32;
    head.scale.set(0.85, 1.25, 0.9);
    this.head = head;
    const armGeo = new THREE.CapsuleGeometry(0.05, 1.05, 3, 6);
    const armL = new THREE.Mesh(armGeo, mat);
    const armR = new THREE.Mesh(armGeo, mat);
    armL.position.set(-0.34, 1.45, 0); armR.position.set(0.34, 1.45, 0);
    armL.rotation.z = 0.12; armR.rotation.z = -0.12;
    for (const m of [body, head, armL, armR]) m.castShadow = true;
    g.add(body, head, armL, armR);

    // the eyes are the only part of it that emits
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xcfd8e8 });
    this.eyes = [];
    for (const sx of [-0.055, 0.055]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), eyeMat);
      e.position.set(sx, 2.36, -0.13);
      g.add(e); this.eyes.push(e);
    }

    g.visible = false;
    scene.add(g);

    this.state = 'hidden';   // hidden | cameo | stalk | frozen | flee
    this.sear = 0;
    this.path = null;
    this.repathT = 0;
    this.fleeUntil = 0;
    this.twitchT = 0;
    this.time = 0;
    this.onKill = null;
    this.onSeared = null;
  }

  get pos() { return this.group.position; }

  placeCameo(x, z, faceX, faceZ) {
    this.group.position.set(x, 0, z);
    this.group.lookAt(faceX, 0, faceZ);
    this.group.visible = true;
    this.state = 'cameo';
  }

  vanish() {
    this.group.visible = false;
    this.state = 'hidden';
  }

  startHunt(playerPos) {
    this._teleportFar(playerPos, 12, 20);
    this.state = 'stalk';
    this.group.visible = true;
  }

  stopHunt() { this.vanish(); }

  _teleportFar(playerPos, minD, maxD) {
    // pick a random open cell at the right distance with a path to the player
    for (let tries = 0; tries < 80; tries++) {
      const cx = 1 + Math.floor(Math.random() * (W - 2));
      const cy = 1 + Math.floor(Math.random() * (H - 2));
      if (this.world.isSolid(cx, cy)) continue;
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < minD || d > maxD) continue;
      if (this.world.findPath(x, z, playerPos.x, playerPos.z)) {
        this.group.position.set(x, 0, z);
        return;
      }
    }
    this.group.position.set(playerPos.x, 0, playerPos.z + 16); // fallback
  }

  update(dt, player) {
    player.searing = false; // set back below while the beam pins it
    if (this.state === 'hidden') return;
    this.time += dt;

    // idle animation: breathing sway + head twitch
    this.group.children[0].position.y = 1.35 + Math.sin(this.time * 1.7) * 0.02;
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.head.rotation.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.3);
      this.twitchT = 0.6 + Math.random() * 2.4;
    }
    for (const e of this.eyes) e.visible = Math.sin(this.time * 13) > -0.92;

    if (this.state === 'cameo') return; // scripted: the director moves/clears it

    const p = player.pos;
    const headPos = new THREE.Vector3(this.pos.x, 2.2, this.pos.z);
    const lit = player.flashlightLit(headPos, 22);
    const dist = Math.hypot(this.pos.x - p.x, this.pos.z - p.z);

    if (this.state === 'flee') {
      if (this.time > this.fleeUntil) this.state = 'stalk';
      return;
    }

    // light pins it
    if (lit) {
      this.state = 'frozen';
      player.searing = true;
      this.sear += dt;
      if (this.sear > SEAR_TIME) {
        this.sear = 0;
        this.state = 'flee';
        this.fleeUntil = this.time + 6 + Math.random() * 4;
        this._teleportFar(p, 14, 24);
        if (this.onSeared) this.onSeared();
      }
      this.group.lookAt(p.x, 0, p.z);
      return;
    }
    this.sear = Math.max(0, this.sear - dt * 0.5);
    this.state = 'stalk';

    // unobserved it moves fast; watched (but unlit, in the dark) it creeps
    const observed = player.looksAt(headPos, 0.55) && this.world.los(p.x, p.z, this.pos.x, this.pos.z);
    const speed = observed ? 1.0 : 2.7;

    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.path = this.world.findPath(this.pos.x, this.pos.z, p.x, p.z);
      this.repathT = 0.45;
    }
    let target = null;
    if (this.world.los(this.pos.x, this.pos.z, p.x, p.z)) {
      target = { x: p.x, z: p.z };
    } else if (this.path && this.path.length > 1) {
      target = this.path[1];
      if (Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < 0.5) {
        this.path.shift();
        target = this.path[1] || target;
      }
    }
    if (target) {
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / d) * speed * dt;
      this.pos.z += (dz / d) * speed * dt;
      this.group.lookAt(p.x, 0, p.z);
    }

    if (dist < KILL_DIST && this.onKill) this.onKill();
  }

  // 0..1 — drives heartbeat + post-processing fear
  threat(playerPos) {
    if (this.state === 'hidden' || this.state === 'cameo') return 0;
    const d = Math.hypot(this.pos.x - playerPos.x, this.pos.z - playerPos.z);
    return Math.max(0, Math.min(1, 1 - d / 16));
  }
}
