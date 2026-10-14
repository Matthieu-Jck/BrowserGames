// probe-mesh.ts — the player probe, built from primitives. Installed upgrades are
// literally visible: barrels, dishes, tanks, bays grow on the chassis.
import * as THREE from 'three';
import { stdMat, glowSprite } from './space-props';
import { getUpgrade } from '@/content/registry';

export interface ProbeMeshOpts {
  upgrades: string[];
  corrupted?: boolean;          // rogue replica palette
  accent?: string;
}

export function buildProbeMesh(opts: ProbeMeshOpts): THREE.Group {
  const grp = new THREE.Group();
  const bodyMat = stdMat(opts.corrupted ? 0x6a5560 : 0x9fb4c4);
  const darkMat = stdMat(0x3a4a5c);

  // chassis + nose
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 2.1), bodyMat);
  body.position.y = 0.85;
  grp.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.5), darkMat);
  nose.position.set(0, 0.78, 1.25);
  grp.add(nose);

  // six rover wheels
  const wheels: THREE.Mesh[] = [];
  const wGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
  const wMat = stdMat(0x222c36, { roughness: 0.95, metalness: 0.1 });
  for (let i = -1; i <= 1; i++) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wGeo, wMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 0.92, 0.34, i * 0.8);
      grp.add(w);
      wheels.push(w);
    }
  }

  // visuals from upgrades
  const visuals = opts.upgrades.map((id) => { try { return getUpgrade(id).visual; } catch { return undefined; } });
  const countOf = (v: string): number => visuals.filter((x) => x === v).length;

  // scanner mast + dish (always; grows with scanner upgrades)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), darkMat);
  mast.position.set(-0.4, 1.6, -0.5);
  grp.add(mast);
  const dishSize = 0.28 + 0.09 * countOf('dish');
  const dish = new THREE.Mesh(new THREE.ConeGeometry(dishSize, 0.22, 12, 1, true), stdMat(0xd8e6ee, { side: THREE.DoubleSide }));
  dish.position.set(-0.4, 2.05, -0.5);
  dish.rotation.x = -0.6;
  grp.add(dish);

  // solar panels (always one pair, more with 'panel' visuals)
  const panels = 1 + Math.min(1, countOf('panel'));
  for (let i = 0; i < panels; i++) {
    const side = i === 0 ? -1 : 1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.1), darkMat);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.04, 0.85),
      stdMat(0x1d4f8a, { emissive: 0x0d2c55, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 }));
    arm.position.set(side * 1.3, 1.05, -0.2);
    panel.position.set(side * 2.1, 1.05, -0.2);
    grp.add(arm, panel);
  }

  // weapon barrels
  const barrels = Math.min(3, 1 + countOf('barrel'));
  for (let i = 0; i < barrels; i++) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.8, 8),
      stdMat(0x55636e, { emissive: opts.corrupted ? 0x661111 : 0x113344, emissiveIntensity: 0.6 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(-0.45 + i * 0.45, 1.35, 1.35);
    grp.add(barrel);
  }

  // drill
  if (countOf('drill') > 0) {
    const drill = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 8), stdMat(0x8a8f96));
    drill.rotation.x = Math.PI / 2;
    drill.position.set(0.45, 0.55, 1.65);
    grp.add(drill);
    grp.userData['drill'] = drill;
  }
  // tanks
  for (let i = 0; i < Math.min(2, countOf('tank')); i++) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 3, 8), stdMat(0xb09a55));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 1.42 + i * 0.3, 0.4);
    grp.add(tank);
  }
  // replication bay
  if (countOf('bay') > 0) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.55), stdMat(0x7a8a6a, { emissive: 0x1c2c10, emissiveIntensity: 0.7 }));
    bay.position.set(0, 0.95, -1.3);
    grp.add(bay);
  }
  // shield ring
  if (countOf('ring') > 0) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.035, 6, 36),
      stdMat(0x59d6e8, { emissive: 0x2a8898, emissiveIntensity: 1.2, transparent: true, opacity: 0.55 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.0;
    grp.add(ring);
    grp.userData['shieldRing'] = ring;
  }
  // spikes
  if (countOf('spike') > 0) {
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 5), stdMat(0xc4622d, { emissive: 0x521f08, emissiveIntensity: 0.7 }));
      const a = (i / 4) * Math.PI * 2 + 0.4;
      spike.position.set(Math.cos(a) * 0.85, 1.3, Math.sin(a) * 0.9);
      spike.rotation.z = Math.cos(a) * 0.8;
      grp.add(spike);
    }
  }

  // archive pod — humanity's seed, golden (always carried; story)
  const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0),
    stdMat(0xd4af37, { emissive: 0x4a3505, emissiveIntensity: 1, metalness: 0.9, roughness: 0.25 }));
  pod.position.set(0, 1.55, -0.1);
  grp.add(pod);

  // exhaust glow
  const exhaust = glowSprite(opts.accent ?? '#7fd4ff', 1.4, 0.0);
  exhaust.position.set(0, 0.62, -2.0);
  grp.add(exhaust);

  // corrupted replicas get asymmetric mutations
  if (opts.corrupted) {
    grp.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.color) { m.color.offsetHSL(0, 0.08, -0.14); }
      if (m && m.emissive) { m.emissive.setHex(0x551515); m.emissiveIntensity = 0.5; }
    });
    const growth = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), stdMat(0x442222, { emissive: 0x661111, emissiveIntensity: 0.5, roughness: 0.95 }));
    growth.position.set(0.7, 1.2, -0.6);
    grp.add(growth);
  }

  grp.userData['wheels'] = wheels;
  grp.userData['dish'] = dish;
  grp.userData['exhaust'] = exhaust;
  grp.userData['animate'] = (t: number, dt: number) => {
    dish.rotation.y = Math.sin(t * 0.6) * 1.1;
    const drill = grp.userData['drill'] as THREE.Mesh | undefined;
    if (drill) drill.rotation.z += dt * 2;
    const ring = grp.userData['shieldRing'] as THREE.Mesh | undefined;
    if (ring) ring.rotation.z += dt * 0.4;
    pod.rotation.y += dt * 0.8;
  };
  return grp;
}
