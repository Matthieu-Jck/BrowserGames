// combat-scene.ts — the battle diorama: FBM terrain in the planet's palette,
// probe at left, enemies at right, fx driven by the CombatEvent queue.
import * as THREE from 'three';
import { buildTerrain } from '@/vfx/terrain';
import { buildProbeMesh } from '@/vfx/probe-mesh';
import { buildEnemyMesh } from '@/vfx/enemy-mesh';
import { disposeObject } from '@/vfx/dispose';
import { FxLayer } from '@/vfx/fx';
import { PLANET_TYPES, type PlanetType } from '@/map/planet-gen';
import { getEnemy } from '@/content/registry';
import type { Archetype } from '@/combat/combat-types';

const ARCH_BEAM: Record<string, string> = {
  laser: '#6fe0ef', kinetic: '#ff8a4a', nuclear: '#d4f04a',
  speed: '#b8d7dd', repair: '#71e8a4', neutral: '#b8d7dd', paradox: '#b48cff',
};

export class CombatScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  fx = new FxLayer();
  private world: THREE.Group | null = null;
  private probe: THREE.Group | null = null;
  private enemyMeshes = new Map<string, THREE.Group>();
  private heightAt: (x: number, z: number) => number = () => 0;
  private camBase = new THREE.Vector3(-7.5, 5.2, 12.5);

  enter(seedKey: string, type: PlanetType, upgrades: string[], enemies: Array<{ id: string; enemyId: string }>): void {
    this.clear();
    const def = PLANET_TYPES[type];
    // lift the palette toward daylight so fights read clearly
    const sky = new THREE.Color(def.palette.sky).lerp(new THREE.Color('#7da4c4'), 0.22);
    const fogc = new THREE.Color(def.palette.fog).lerp(new THREE.Color('#7da4c4'), 0.18);
    this.scene.background = sky;
    this.scene.fog = type === 'void' ? null : new THREE.FogExp2(fogc.getHex(), 0.004);

    const t = buildTerrain(seedKey, type);
    this.world = t.group;
    this.heightAt = t.heightAt;
    this.scene.add(this.world);
    this.scene.add(this.fx.group);

    this.probe = buildProbeMesh({ upgrades });
    const py = this.heightAt(-6, 0);
    this.probe.position.set(-6, py, 0);
    this.probe.rotation.y = Math.PI / 2;
    this.scene.add(this.probe);

    this.layoutEnemies(enemies);

    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 1.6, 0);
  }

  layoutEnemies(enemies: Array<{ id: string; enemyId: string }>): void {
    for (const [, m] of this.enemyMeshes) { this.scene.remove(m); disposeObject(m); }
    this.enemyMeshes.clear();
    const n = enemies.length;
    enemies.forEach((e, i) => {
      const def = getEnemy(e.enemyId);
      const mesh = buildEnemyMesh(def.visual);
      const z = (i - (n - 1) / 2) * 4.2;
      const x = 5.5 + (i % 2) * 2.2;
      mesh.position.set(x, this.heightAt(x, z), z);
      mesh.rotation.y = -Math.PI / 2;
      this.scene.add(mesh);
      this.enemyMeshes.set(e.id, mesh);
    });
  }

  addEnemy(actorId: string, enemyId: string): void {
    const def = getEnemy(enemyId);
    const mesh = buildEnemyMesh(def.visual);
    const i = this.enemyMeshes.size;
    const z = (i - 1.5) * 3.8;
    const x = 6 + (i % 2) * 2;
    mesh.position.set(x, this.heightAt(x, z), z);
    mesh.rotation.y = -Math.PI / 2;
    mesh.scale.multiplyScalar(0.01);
    this.scene.add(mesh);
    this.enemyMeshes.set(actorId, mesh);
    const target = getEnemy(enemyId).visual.scale;
    const grow = (): void => {
      if (mesh.scale.x < target) {
        mesh.scale.addScalar(0.06);
        requestAnimationFrame(grow);
      }
    };
    grow();
    this.fx.ring(mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), '#71e8a4', 3);
  }

  enemyPos(actorId: string): THREE.Vector3 {
    const m = this.enemyMeshes.get(actorId);
    return m ? m.position.clone().add(new THREE.Vector3(0, 1.8, 0)) : new THREE.Vector3(6, 2, 0);
  }

  probePos(): THREE.Vector3 {
    return this.probe ? this.probe.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : new THREE.Vector3(-6, 2, 0);
  }

  playerAttack(targetId: string, archetype: Archetype | undefined, beam: boolean | undefined): void {
    const color = ARCH_BEAM[archetype ?? 'neutral'] ?? '#b8d7dd';
    const from = this.probePos();
    const to = this.enemyPos(targetId);
    if (beam || archetype === 'laser') this.fx.beam(from, to, color, 0.12);
    else this.fx.beam(from, to, color, 0.06);
    this.fx.burst(to, color, 10, 5);
    this.fx.addShake(0.18);
  }

  enemyAttack(actorId: string): void {
    const from = this.enemyPos(actorId);
    const to = this.probePos();
    this.fx.beam(from, to, '#ff5d4a', 0.09);
    this.fx.burst(to, '#ff8866', 10, 5);
    this.fx.addShake(0.3);
  }

  deathBurst(actorId: string): void {
    const m = this.enemyMeshes.get(actorId);
    if (!m) return;
    this.fx.burst(this.enemyPos(actorId), '#ffcc88', 22, 8);
    this.fx.ring(this.enemyPos(actorId), '#ff8844', 6);
    this.scene.remove(m);
    disposeObject(m);
    this.enemyMeshes.delete(actorId);
  }

  shieldFx(targetId: string): void {
    const pos = targetId === 'player' ? this.probePos() : this.enemyPos(targetId);
    this.fx.ring(pos, '#6fe0ef', 3.2);
  }

  healFx(targetId: string): void {
    const pos = targetId === 'player' ? this.probePos() : this.enemyPos(targetId);
    this.fx.ring(pos, '#71e8a4', 2.8);
  }

  update(dt: number, t: number): void {
    this.fx.update(dt);
    const probeAnim = this.probe?.userData['animate'] as ((t: number, dt: number) => void) | undefined;
    probeAnim?.(t, dt);
    for (const [, m] of this.enemyMeshes) {
      const anim = m.userData['animate'] as ((t: number, dt: number) => void) | undefined;
      anim?.(t, dt);
    }
    // camera shake
    const s = this.fx.shake;
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * s * 0.5,
      this.camBase.y + (Math.random() - 0.5) * s * 0.4,
      this.camBase.z + (Math.random() - 0.5) * s * 0.3,
    );
    this.camera.lookAt(0, 1.6, 0);
  }

  clear(): void {
    this.fx.clear();
    if (this.world) { this.scene.remove(this.world); disposeObject(this.world); this.world = null; }
    if (this.probe) { this.scene.remove(this.probe); disposeObject(this.probe); this.probe = null; }
    for (const [, m] of this.enemyMeshes) { this.scene.remove(m); disposeObject(m); }
    this.enemyMeshes.clear();
    this.scene.clear();
    this.scene.add(this.fx.group);
  }
}
