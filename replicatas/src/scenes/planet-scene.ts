// planet-scene.ts — orbital approach: the destination planet fills a third of
// the frame. Backdrop for surface map, events, rewards, forge, fabricator.
import * as THREE from 'three';
import { starfield, glowSprite } from '@/vfx/space-props';
import { buildProbeMesh } from '@/vfx/probe-mesh';
import { disposeObject } from '@/vfx/dispose';
import { planetTexture } from '@/vfx/textures';
import { PLANET_TYPES, type PlanetSpec } from '@/map/planet-gen';

export class PlanetScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3000);
  private planetGroup = new THREE.Group();
  private probe: THREE.Group | null = null;
  private planetMesh: THREE.Mesh | null = null;

  constructor() {
    this.scene.background = new THREE.Color('#0b1322');
    this.scene.add(starfield('planetbg', 2000, 800));
    this.scene.add(this.planetGroup);
    const hemi = new THREE.HemisphereLight(0xcfe2ea, 0x1a2230, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(60, 20, 50);
    this.scene.add(sun);
    this.camera.position.set(0, 0.6, 10);
  }

  enter(spec: PlanetSpec, upgrades: string[]): void {
    this.planetGroup.children.forEach((c) => disposeObject(c));
    this.planetGroup.clear();

    const def = PLANET_TYPES[spec.type];
    const tex = planetTexture(spec.seedKey, spec.type);
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(7.5, 48, 32),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.05 }),
    );
    planet.position.set(-7.5, 0.5, -6);
    this.planetGroup.add(planet);
    this.planetMesh = planet;

    const atmo = glowSprite(def.palette.atmo, 21, 0.32);
    atmo.position.copy(planet.position);
    this.planetGroup.add(atmo);

    if (spec.type === 'gasmoon') {
      const parent = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 22),
        new THREE.MeshStandardMaterial({ color: 0x76588c, emissive: 0x241a33, emissiveIntensity: 0.5 }));
      parent.position.set(16, 6, -60);
      this.planetGroup.add(parent);
    }
    if (spec.type === 'derelict' || spec.type === 'tomb') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(10.4, 0.18, 8, 80),
        new THREE.MeshStandardMaterial({ color: 0x3c4a5c, emissive: 0x10141a, emissiveIntensity: 0.6 }));
      ring.position.copy(planet.position);
      ring.rotation.x = Math.PI / 2.6;
      this.planetGroup.add(ring);
    }

    if (this.probe) { this.scene.remove(this.probe); disposeObject(this.probe); this.probe = null; }
    this.probe = buildProbeMesh({ upgrades });
    this.probe.scale.setScalar(0.6);
    this.probe.position.set(4.2, -2.2, 2);
    this.probe.rotation.y = -0.6;
    this.scene.add(this.probe);
  }

  update(dt: number, t: number): void {
    if (this.planetMesh) this.planetMesh.rotation.y += dt * 0.03;
    if (this.probe) {
      this.probe.position.y = -2.2 + Math.sin(t * 0.7) * 0.1;
      const anim = this.probe.userData['animate'] as ((t: number, dt: number) => void) | undefined;
      anim?.(t, dt);
    }
  }
}
