// enemy-mesh.ts — interprets EnemyVisualSpec: 9 body-plan builders × palette ×
// idle animation cover the whole roster. Rogue replicas reuse the probe mesh.
import * as THREE from 'three';
import type { EnemyVisualSpec } from '@/combat/combat-types';
import { stdMat, glowSprite } from './space-props';
import { buildProbeMesh } from './probe-mesh';

type Animate = (t: number, dt: number) => void;

export function buildEnemyMesh(spec: EnemyVisualSpec): THREE.Group {
  const grp = new THREE.Group();
  const base = new THREE.Color(spec.palette.base);
  const accent = new THREE.Color(spec.palette.accent);
  const emissive = new THREE.Color(spec.palette.emissive);
  const bodyMat = stdMat(base.getHex(), { emissive: emissive.getHex(), emissiveIntensity: 0.28 });
  const accMat = stdMat(accent.getHex(), { emissive: emissive.getHex(), emissiveIntensity: 0.5 });
  let animate: Animate = () => {};
  const add = <T extends THREE.Object3D>(m: T): T => { grp.add(m); return m; };

  switch (spec.bodyPlan) {
    case 'crawler': {
      const body = add(new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 5), bodyMat));
      body.position.y = 1.5; body.rotation.x = 0.5;
      for (let i = 0; i < 6; i++) {
        const leg = add(new THREE.Mesh(new THREE.ConeGeometry(0.08, 1.6, 4), accMat));
        const a = (i / 6) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.8, 0.8, Math.sin(a) * 0.8);
        leg.rotation.z = Math.cos(a) * 0.8;
        leg.rotation.x = Math.sin(a) * 0.8;
      }
      const eyes = add(glowSprite(spec.palette.emissive, 0.7));
      eyes.position.set(0, 2.2, 0.5);
      animate = (t) => { body.rotation.y = Math.sin(t * 0.8) * 0.3; };
      break;
    }
    case 'floater': {
      const core = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.7), bodyMat));
      core.position.y = 2.0;
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 6, 24), accMat));
      ring.position.y = 2.0;
      const eye = add(glowSprite(spec.palette.emissive, 0.8));
      eye.position.set(0, 2.0, 0.6);
      animate = (t) => {
        core.rotation.y = t;
        ring.rotation.x = t * 0.7;
        core.position.y = 2 + Math.sin(t * 1.3) * 0.2;
        eye.position.y = core.position.y;
      };
      break;
    }
    case 'swarm': {
      const bits: Array<{ m: THREE.Mesh; ph: number }> = [];
      for (let i = 0; i < 12; i++) {
        const b = add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.2 + Math.random() * 0.18), i % 3 ? bodyMat : accMat));
        b.position.set((Math.random() - 0.5) * 2.2, 0.25 + Math.random() * 0.6, (Math.random() - 0.5) * 2.2);
        bits.push({ m: b, ph: Math.random() * 9 });
      }
      animate = (t) => bits.forEach((b) => {
        b.m.position.y = 0.35 + Math.abs(Math.sin(t * 3 + b.ph)) * 0.32;
        b.m.rotation.y += 0.05;
      });
      break;
    }
    case 'turret': {
      const baseM = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.6, 8), bodyMat));
      baseM.position.y = 0.3;
      const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), accMat));
      head.position.y = 0.9;
      const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 8), accMat));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.95, 0.7);
      const eye = add(glowSprite(spec.palette.emissive, 0.6));
      eye.position.set(0, 0.95, 1.2);
      animate = (t) => { head.rotation.y = Math.sin(t * 0.7) * 0.6; };
      break;
    }
    case 'probe': {
      const fake = buildProbeMesh({ upgrades: ['targeting_suite', 'scanner1', 'drop_tanks'], corrupted: true, accent: spec.palette.emissive });
      fake.scale.setScalar(1.1);
      add(fake);
      const fakeAnim = fake.userData['animate'] as Animate | undefined;
      animate = (t, dt) => fakeAnim?.(t, dt);
      break;
    }
    case 'colossus': {
      const torso = add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 2.4, 6), bodyMat));
      torso.position.y = 2.2;
      const halo = add(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 6, 28), accMat));
      halo.position.y = 3.6;
      halo.rotation.x = Math.PI / 2;
      const eye = add(glowSprite(spec.palette.emissive, 1.3));
      eye.position.set(0, 2.7, 0.95);
      animate = (t) => {
        halo.rotation.z = t * 0.5;
        torso.position.y = 2.2 + Math.sin(t) * 0.12;
        eye.position.y = torso.position.y + 0.5;
      };
      break;
    }
    case 'amorphous': {
      const blobs: Array<{ m: THREE.Mesh; ph: number }> = [];
      for (let i = 0; i < 7; i++) {
        const b = add(new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.45, 8, 6), i % 2 ? bodyMat : accMat));
        b.position.set((Math.random() - 0.5) * 2.0, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 2.0);
        blobs.push({ m: b, ph: Math.random() * 7 });
      }
      animate = (t) => blobs.forEach((b) => b.m.scale.setScalar(1 + Math.sin(t * 2.2 + b.ph) * 0.12));
      break;
    }
    case 'wisp': {
      const core = add(glowSprite(spec.palette.base, 3.0, 0.9));
      core.position.y = 2.2;
      const motes: Array<{ m: THREE.Sprite; ph: number; r: number }> = [];
      for (let i = 0; i < 8; i++) {
        const m2 = add(glowSprite(spec.palette.accent, 0.8, 0.8));
        motes.push({ m: m2, ph: Math.random() * 9, r: 0.9 + Math.random() * 1.3 });
      }
      animate = (t) => motes.forEach((mo) => {
        mo.m.position.set(Math.cos(t * 2 + mo.ph) * mo.r, 2.2 + Math.sin(t * 3.1 + mo.ph) * 0.9, Math.sin(t * 2 + mo.ph) * mo.r);
      });
      break;
    }
    case 'obelisk': {
      const obelisk = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.4, 0.9), stdMat(base.getHex(), { emissive: emissive.getHex(), emissiveIntensity: 0.4, metalness: 0.9, roughness: 0.2 })));
      obelisk.position.y = 2.4;
      const shards: Array<{ m: THREE.Mesh; ph: number }> = [];
      for (let i = 0; i < 4; i++) {
        const sh = add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.3), accMat));
        shards.push({ m: sh, ph: (i * Math.PI) / 2 });
      }
      const eye = add(glowSprite(spec.palette.emissive, 1.5));
      eye.position.set(0, 3.2, 0.55);
      animate = (t) => {
        obelisk.rotation.y = t * 0.4;
        obelisk.position.y = 2.4 + Math.sin(t * 0.8) * 0.25;
        shards.forEach((s) => s.m.position.set(Math.cos(t + s.ph) * 1.6, 2.4 + Math.sin(t * 1.7 + s.ph) * 0.8, Math.sin(t + s.ph) * 1.6));
      };
      break;
    }
  }

  grp.scale.setScalar(spec.scale);
  // idle layer
  const inner = animate;
  grp.userData['animate'] = ((t: number, dt: number) => {
    inner(t, dt);
    switch (spec.idle) {
      case 'hover': grp.position.y = Math.sin(t * 1.2) * 0.1; break;
      case 'pulse': { const s = spec.scale * (1 + Math.sin(t * 2.4) * 0.03); grp.scale.setScalar(s); break; }
      case 'rotate': grp.rotation.y += dt * 0.25; break;
      case 'skitter': grp.position.x = Math.sin(t * 5.1) * 0.06; break;
    }
  }) as Animate;
  return grp;
}
