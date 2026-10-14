// space-props.ts — starfields, nebulas, glow/text sprites. Canvas textures only.
// Ported from replicatas_old/probe.js.
import * as THREE from 'three';
import { makeRng } from '@/core/rng';

const texCache = new Map<string, THREE.CanvasTexture>();

export function glowTexture(color = '#6fe0ef'): THREE.CanvasTexture {
  const cached = texCache.get(color);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color + 'aa');
  grad.addColorStop(1, '#00000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  (t as THREE.CanvasTexture & { __shared?: boolean }).__shared = true;
  texCache.set(color, t);
  return t;
}

export function glowSprite(color: string, size = 2, opacity = 0.9): THREE.Sprite {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(color), color: 0xffffff, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

export function starfield(seed: string | number = 1, count = 2600, radius = 900): THREE.Points {
  const rng = makeRng(seed + ':stars');
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rng.next() * 2 - 1;
    const th = rng.next() * Math.PI * 2;
    const r = radius * (0.55 + 0.45 * rng.next());
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    const tint = rng.next();
    const b = 0.5 + 0.5 * rng.next();
    col[i * 3] = b * (tint < 0.12 ? 1.0 : 0.85);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (tint > 0.8 ? 1.0 : 0.92);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: true, vertexColors: true, transparent: true,
    opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

export function nebulas(seed: string, scale = 1): THREE.Group {
  const rng = makeRng(seed + ':neb');
  const grp = new THREE.Group();
  const colors = ['#23445e', '#3c2a55', '#1d4a45'];
  for (let i = 0; i < 3; i++) {
    const s = glowSprite(colors[i % colors.length]!, (340 + rng.next() * 260) * scale, 0.16);
    const a = rng.next() * Math.PI * 2;
    s.position.set(Math.cos(a) * 520, (rng.next() - 0.5) * 320, Math.sin(a) * 520);
    grp.add(s);
  }
  return grp;
}

export function stdMat(color: number | string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, metalness: 0.35, ...opts });
}
