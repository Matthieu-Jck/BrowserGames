// dispose.ts — deep GPU cleanup. Prevents leaks across many scene rebuilds.
import * as THREE from 'three';

interface SharedTexture extends THREE.Texture { __shared?: boolean }

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap'] as const) {
          const tex = (m as unknown as Record<string, SharedTexture | undefined>)[k];
          if (tex && tex.dispose && !tex.__shared) tex.dispose();
        }
        m.dispose();
      }
    }
  });
}
