// fx.ts — combat effects: beams, bursts, shakes. Pooled into a group the
// combat scene owns; everything self-disposes after its lifetime.
import * as THREE from 'three';
import { glowSprite, glowTexture } from './space-props';

interface Fx {
  obj: THREE.Object3D;
  life: number;
  max: number;
  update(k: number): void;
}

export class FxLayer {
  group = new THREE.Group();
  shake = 0;
  private items: Fx[] = [];

  beam(from: THREE.Vector3, to: THREE.Vector3, color: string, width = 0.12): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(width, width, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).add(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.group.add(mesh);
    this.items.push({
      obj: mesh, life: 0, max: 0.28,
      update: (k) => { mat.opacity = 0.9 * (1 - k); mesh.scale.x = mesh.scale.z = 1 - k * 0.6; },
    });
  }

  burst(at: THREE.Vector3, color: string, count = 14, speed = 7): void {
    const sprites: Array<{ s: THREE.Sprite; v: THREE.Vector3 }> = [];
    for (let i = 0; i < count; i++) {
      const s = glowSprite(color, 0.5 + Math.random() * 0.6, 0.95);
      s.position.copy(at);
      this.group.add(s);
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      sprites.push({ s, v });
    }
    const holder = new THREE.Group();
    this.items.push({
      obj: holder, life: 0, max: 0.6,
      update: (k) => {
        for (const { s, v } of sprites) {
          s.position.addScaledVector(v, 0.016);
          v.y -= 0.25;
          (s.material as THREE.SpriteMaterial).opacity = 0.95 * (1 - k);
        }
        if (k >= 1) for (const { s } of sprites) this.group.remove(s);
      },
    });
  }

  ring(at: THREE.Vector3, color: string, size = 4): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(color), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.copy(at);
    this.group.add(s);
    this.items.push({
      obj: s, life: 0, max: 0.45,
      update: (k) => {
        s.scale.setScalar(0.5 + k * size);
        (s.material as THREE.SpriteMaterial).opacity = 0.8 * (1 - k);
      },
    });
  }

  addShake(v: number): void {
    this.shake = Math.min(1.2, this.shake + v);
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const fx = this.items[i]!;
      fx.life += dt;
      const k = Math.min(1, fx.life / fx.max);
      fx.update(k);
      if (k >= 1) {
        this.group.remove(fx.obj);
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const fx of this.items) this.group.remove(fx.obj);
    this.items = [];
    this.group.clear();
  }
}
