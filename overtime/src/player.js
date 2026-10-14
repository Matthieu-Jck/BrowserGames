// player.js — first-person controller: mouse look, axis-separated collision,
// head bob, stamina, and the flashlight (the game's one shadow-casting light).

import * as THREE from 'three';
import { CELL } from './map.js';

const RADIUS = 0.34;
const EYE = 1.62;

export class Player {
  constructor(camera, world, scene) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3(world.markers.start.x, EYE, world.markers.start.z);
    this.yaw = Math.PI;      // face the dead elevator on spawn
    this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.keys = new Set();
    this.enabled = false;

    this.stamina = 100;
    this.battery = 100;
    this.flashOn = false;
    this.flashFlickerT = 0;  // events steal the light for a moment
    this.searing = false;    // director sets this while the beam pins the thing

    this.bobT = 0;
    this.lastStepPhase = 0;
    this.onFootstep = null;
    this.onToggleFlash = null;

    // flashlight: spot with shadows, slightly lagged for handheld feel
    this.flash = new THREE.SpotLight(0xfff2d8, 0, 30, 0.46, 0.45, 1.8);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = 30;
    this.flash.shadow.bias = -0.0004;
    this.flash.shadow.normalBias = 0.02;
    this.flashTarget = new THREE.Object3D();
    scene.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;
    this.smoothDir = new THREE.Vector3(0, 0, -1);

    document.addEventListener('keydown', e => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.toggleFlash();
    });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    document.addEventListener('mousedown', e => {
      if (this.enabled && e.button === 2) this.toggleFlash();
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('mousemove', e => {
      if (!this.enabled || document.pointerLockElement === null) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  toggleFlash() {
    this.flashOn = !this.flashOn;
    if (this.onToggleFlash) this.onToggleFlash(this.flashOn);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // circle-vs-AABB, resolved one axis at a time
  _blocked(x, z) {
    const cx0 = Math.floor((x - RADIUS) / CELL), cx1 = Math.floor((x + RADIUS) / CELL);
    const cy0 = Math.floor((z - RADIUS) / CELL), cy1 = Math.floor((z + RADIUS) / CELL);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (this.world.isSolid(cx, cy)) return true;
    for (const c of this.world.colliders)
      if (x + RADIUS > c.x0 && x - RADIUS < c.x1 && z + RADIUS > c.z0 && z - RADIUS < c.z1) return true;
    // closed elevator doors
    if (this.world.doorBlocked()) {
      const ex = this.world.elevatorCx, ez = this.world.elevatorZ;
      if (x + RADIUS > ex - 1.6 && x - RADIUS < ex + 1.6 && z + RADIUS > ez - 0.1 && z - RADIUS < ez + 0.4) return true;
    }
    return false;
  }

  update(dt) {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    const moving = (mx || mz) && this.enabled;

    const wantSprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && moving && this.stamina > 1;
    const speed = wantSprint ? 5.0 : 3.0;
    this.stamina = wantSprint
      ? Math.max(0, this.stamina - 22 * dt)
      : Math.min(100, this.stamina + 14 * dt);

    // rotate input vector into world space (yaw=0 faces -z)
    let dx = 0, dz = 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      const fx = mx / len, fz = mz / len;
      dx = (Math.cos(-this.yaw) * fx - Math.sin(-this.yaw) * fz) * speed;
      dz = (Math.sin(-this.yaw) * fx + Math.cos(-this.yaw) * fz) * speed;
    }

    this.vel.x += (dx - this.vel.x) * Math.min(1, dt * 10);
    this.vel.y += (dz - this.vel.y) * Math.min(1, dt * 10);

    let nx = this.pos.x + this.vel.x * dt;
    if (!this._blocked(nx, this.pos.z)) this.pos.x = nx; else this.vel.x = 0;
    let nz = this.pos.z + this.vel.y * dt;
    if (!this._blocked(this.pos.x, nz)) this.pos.z = nz; else this.vel.y = 0;

    // head bob + footsteps keyed to bob phase
    const speedNow = Math.hypot(this.vel.x, this.vel.y);
    if (speedNow > 0.4) {
      this.bobT += dt * (wantSprint ? 11 : 7.5);
      const phase = Math.floor(this.bobT / Math.PI);
      if (phase !== this.lastStepPhase) {
        this.lastStepPhase = phase;
        if (this.onFootstep) this.onFootstep(wantSprint);
      }
    }
    const bobAmt = Math.min(1, speedNow / 3);
    const bobY = Math.sin(this.bobT * 2) * 0.034 * bobAmt;
    const roll = Math.sin(this.bobT) * 0.011 * bobAmt;

    this.camera.position.set(this.pos.x, EYE + bobY, this.pos.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, roll, 'YXZ'));

    // battery
    if (this.flashOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - dt * (this.searing ? 1.6 : 0.42));
    }
    let flashIntensity = 0;
    if (this.flashOn && this.battery > 0) {
      flashIntensity = 300;
      if (this.battery < 18) { // dying cell sputters
        const n = Math.sin(this.world.time * 19) * Math.sin(this.world.time * 5.1);
        if (n > 0.45 + (this.battery / 18) * 0.5) flashIntensity = 50;
      }
    }
    if (this.flashFlickerT > 0) {
      this.flashFlickerT -= dt;
      flashIntensity *= Math.random() < 0.5 ? 0.05 : 0.7;
    }
    this.flash.intensity = flashIntensity;

    // beam lags the camera slightly
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.smoothDir.lerp(fwd, Math.min(1, dt * 9)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.flash.position.copy(this.camera.position)
      .addScaledVector(right, 0.18)
      .add(new THREE.Vector3(0, -0.22, 0));
    this.flashTarget.position.copy(this.camera.position).addScaledVector(this.smoothDir, 12);
  }

  flashlightLit(targetPos, maxDist = 20) {
    if (!this.flashOn || this.battery <= 0 || this.flashFlickerT > 0) return false;
    const to = new THREE.Vector3().subVectors(targetPos, this.camera.position);
    const d = to.length();
    if (d > maxDist) return false;
    to.normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (fwd.dot(to) < Math.cos(0.5)) return false;
    return this.world.los(this.pos.x, this.pos.z, targetPos.x, targetPos.z);
  }

  looksAt(targetPos, coneCos = 0.4) {
    const to = new THREE.Vector3().subVectors(targetPos, this.camera.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return fwd.dot(to) > coneCos;
  }

  addBattery(amount = 55) { this.battery = Math.min(100, this.battery + amount); }
}
