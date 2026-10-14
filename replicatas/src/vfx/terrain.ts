// terrain.ts — FBM vertex-colored flat-shaded terrain diorama (the combat arena
// ground), ported from replicatas_old/planet.js.
import * as THREE from 'three';
import { makeNoise2, makeRng } from '@/core/rng';
import { PLANET_TYPES, type PlanetType } from '@/map/planet-gen';
import { starfield, glowSprite } from './space-props';

export const WORLD = 240;
const HALF = WORLD / 2;

export interface TerrainResult {
  group: THREE.Group;
  heightAt(x: number, z: number): number;
}

export function buildTerrain(seedKey: string, type: PlanetType): TerrainResult {
  const T = PLANET_TYPES[type];
  const noise = makeNoise2(seedKey + ':terrain');
  const rng = makeRng(seedKey + ':props');
  const group = new THREE.Group();
  const amp = 7;
  const freq = 0.018;

  const heightAt = (x: number, z: number): number => {
    const n = noise.fbm(x * freq + 31.7, z * freq + 11.3, 5);
    return (n - 0.45) * amp;
  };

  if (type !== 'void') {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, 90, 90);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes['position'] as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const pal = T.palette.terrain.map((h) => new THREE.Color(h));
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const f = Math.max(0, Math.min(0.999, h / amp + 0.5));
      const idx = Math.min(2, Math.floor(f * 3));
      tmp.copy(pal[idx]!).lerp(pal[idx + 1]!, f * 3 - idx);
      const shade = 0.82 + noise.noise(x * 0.11, z * 0.11) * 0.36;
      colors[i * 3] = tmp.r * shade;
      colors[i * 3 + 1] = tmp.g * shade;
      colors[i * 3 + 2] = tmp.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.05,
    }));
    group.add(terrain);

    if (T.palette.water) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD),
        new THREE.MeshStandardMaterial({ color: T.palette.water, transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.5 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = -amp * 0.16;
      group.add(water);
    }
    addProps(group, T.props, rng, heightAt);
  } else {
    group.add(starfield(seedKey, 1600, 600));
  }

  // sky / fog / lights
  const hemi = new THREE.HemisphereLight(0xd8e8f2, 0x3a3a36, 0.85 + T.sun * 0.85);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, T.sun * 2.1);
  sun.position.set(60, 90, 30);
  group.add(sun);
  if (T.sun < 0.75 && type !== 'void') group.add(starfield(seedKey, 1000, 600));
  const sunGlow = glowSprite(T.sun > 0.9 ? '#fff0cc' : '#aa8866', 60, 0.5 * T.sun);
  sunGlow.position.set(220, 160, 100);
  group.add(sunGlow);

  return { group, heightAt: type === 'void' ? () => 0 : heightAt };
}

function addProps(group: THREE.Group, style: string, rng: ReturnType<typeof makeRng>, heightAt: (x: number, z: number) => number): void {
  if (style === 'none') return;
  const defs: Record<string, () => THREE.BufferGeometry> = {
    rocks: () => new THREE.IcosahedronGeometry(rng.range(0.8, 2.6), 0),
    shards: () => new THREE.ConeGeometry(rng.range(0.5, 1.4), rng.range(2, 6), 5),
    vents: () => new THREE.CylinderGeometry(rng.range(0.4, 1), rng.range(1, 2.4), rng.range(2, 5), 6),
    spires: () => new THREE.ConeGeometry(rng.range(0.6, 1.6), rng.range(4, 10), 6),
    crystals: () => new THREE.OctahedronGeometry(rng.range(0.7, 2.0), 0),
    wreckage: () => new THREE.BoxGeometry(rng.range(1, 4), rng.range(0.4, 3.5), rng.range(1, 4)),
    flora: () => new THREE.ConeGeometry(rng.range(0.8, 1.8), rng.range(2.5, 6), 7),
    ruins: () => new THREE.BoxGeometry(rng.range(0.8, 2.2), rng.range(3, 8), rng.range(0.8, 2.2)),
  };
  const colors: Record<string, number> = {
    rocks: 0x6b5a48, shards: 0xbfe6ee, vents: 0x3a2018, spires: 0x4a3a5e,
    crystals: 0x9e6fd4, wreckage: 0x37475e, flora: 0x3a7a3a, ruins: 0x4a4254,
  };
  const make = defs[style] ?? defs['rocks']!;
  const emis = style === 'crystals' ? 0x442277 : style === 'vents' ? 0x551500 : 0x000000;
  for (let i = 0; i < 56; i++) {
    const m = new THREE.Mesh(make(), new THREE.MeshStandardMaterial({
      color: colors[style] ?? 0x666666, flatShading: true, roughness: 0.9,
      emissive: emis, emissiveIntensity: 0.6,
    }));
    const x = rng.range(-HALF, HALF), z = rng.range(-HALF, HALF);
    if (Math.hypot(x, z) < 16) continue;
    m.position.set(x, heightAt(x, z) + (style === 'wreckage' ? 0.2 : 0), z);
    m.rotation.y = rng.range(0, Math.PI * 2);
    if (style === 'wreckage') m.rotation.z = rng.range(-0.3, 0.3);
    group.add(m);
  }
}
