// space-scene.ts — starfields + nebulas + drifting probe. Serves title, galaxy
// map backdrop, voyage warp, intro/act cutscenes, and the black-hole dive.
import * as THREE from 'three';
import { starfield, glowSprite, stdMat } from '@/vfx/space-props';
import { buildProbeMesh } from '@/vfx/probe-mesh';
import { disposeObject } from '@/vfx/dispose';

export type SpaceMode = 'title' | 'galaxy' | 'voyage' | 'earth' | 'earthfall' | 'blackhole' | 'ending';

export class SpaceScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
  private stars1: THREE.Points;
  private stars2: THREE.Points;
  private probe: THREE.Group | null = null;
  private extras = new THREE.Group();
  private mode: SpaceMode = 'title';
  warpSpeed = 0;                // 0 = drift, 1 = full warp
  private accretion: THREE.Mesh | null = null;

  constructor() {
    this.scene.background = new THREE.Color('#0b1322');
    this.stars1 = starfield('space:a', 2400, 900);
    this.stars2 = starfield('space:b', 2400, 900);
    this.stars2.position.z = -1400;
    this.scene.add(this.stars1, this.stars2, this.extras);
    const hemi = new THREE.HemisphereLight(0xcfe2ea, 0x1a2230, 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
    sun.position.set(50, 30, 40);
    this.scene.add(sun);
    this.camera.position.set(0, 1.6, 9);
  }

  setProbe(upgrades: string[]): void {
    if (this.probe) { this.scene.remove(this.probe); disposeObject(this.probe); }
    this.probe = buildProbeMesh({ upgrades });
    this.probe.position.set(0, -0.6, 0);
    this.probe.rotation.y = 0.7;
    this.scene.add(this.probe);
  }

  enter(mode: SpaceMode, opts: { upgrades?: string[] } = {}): void {
    this.mode = mode;
    this.extras.clear();
    this.accretion = null;
    this.warpSpeed = 0;
    this.setProbe(opts.upgrades ?? []);

    switch (mode) {
      case 'earth':
      case 'earthfall': {
        const earth = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 24),
          stdMat(0x2a5a8a, { emissive: mode === 'earthfall' ? 0xaa3300 : 0x0a1c33, emissiveIntensity: mode === 'earthfall' ? 0.9 : 0.4, flatShading: false }));
        earth.position.set(-40, -6, -70);
        this.extras.add(earth);
        const atmo = glowSprite(mode === 'earthfall' ? '#ff7744' : '#6fb4e0', 72, 0.4);
        atmo.position.copy(earth.position);
        this.extras.add(atmo);
        this.camera.position.set(0, 1.5, 11);
        break;
      }
      case 'blackhole': {
        const hole = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        hole.position.set(0, 4, -120);
        this.extras.add(hole);
        const disk = new THREE.Mesh(new THREE.TorusGeometry(34, 5, 10, 64),
          new THREE.MeshBasicMaterial({ color: 0xcc8844, transparent: true, opacity: 0.85 }));
        disk.position.copy(hole.position);
        disk.rotation.x = Math.PI / 2.4;
        this.extras.add(disk);
        this.accretion = disk;
        const lens = glowSprite('#b48cff', 90, 0.4);
        lens.position.copy(hole.position);
        this.extras.add(lens);
        this.camera.position.set(0, 1.5, 10);
        break;
      }
      case 'ending': {
        const sun2 = glowSprite('#fff0cc', 80, 0.7);
        sun2.position.set(60, 20, -160);
        this.extras.add(sun2);
        const earth = new THREE.Mesh(new THREE.SphereGeometry(22, 32, 24),
          stdMat(0x2a5a8a, { emissive: 0x0a1c33, emissiveIntensity: 0.5, flatShading: false }));
        earth.position.set(-30, -4, -80);
        this.extras.add(earth);
        break;
      }
      default:
        this.camera.position.set(0, 1.6, 9);
    }
    if (this.probe) this.probe.visible = mode !== 'ending';
  }

  update(dt: number, t: number): void {
    // leapfrogging starfields: scroll speed gives free warp streaks
    const speed = 20 + this.warpSpeed * 900;
    for (const s of [this.stars1, this.stars2]) {
      s.position.z += speed * dt;
      if (s.position.z > 900) s.position.z -= 2800;
    }
    this.camera.fov = 62 + this.warpSpeed * 26;
    this.camera.updateProjectionMatrix();

    if (this.probe) {
      this.probe.position.y = -0.6 + Math.sin(t * 0.6) * 0.15;
      this.probe.rotation.y = 0.7 + Math.sin(t * 0.22) * 0.12;
      const anim = this.probe.userData['animate'] as ((t: number, dt: number) => void) | undefined;
      anim?.(t, dt);
      const exhaust = this.probe.userData['exhaust'] as THREE.Sprite | undefined;
      if (exhaust) (exhaust.material as THREE.SpriteMaterial).opacity = 0.15 + this.warpSpeed * 0.7;
    }
    if (this.accretion) this.accretion.rotation.z += dt * 0.4;
    if (this.mode === 'blackhole') {
      // slow fall toward the hole
      this.camera.position.z -= dt * 1.2;
    }
  }
}
