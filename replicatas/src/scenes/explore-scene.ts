// explore-scene.ts — you ARE the probe on the ground. Drag to look around,
// click a scanned beacon to drive there; the screen fades into whatever the
// scanner found: hostiles, ore seams, anomalies, forges, the departure pad.
import * as THREE from 'three';
import { buildTerrain } from '@/vfx/terrain';
import { buildProbeMesh } from '@/vfx/probe-mesh';
import { disposeObject } from '@/vfx/dispose';
import { FxLayer } from '@/vfx/fx';
import { glowSprite } from '@/vfx/space-props';
import { PLANET_TYPES, type PlanetType } from '@/map/planet-gen';
import type { NodeKind } from '@/map/surface-gen';

export interface Poi {
  id: string;
  kind: NodeKind;
  glyph: string;
  label: string | null;        // null → unknown signature
  sub?: string;                // e.g. enemy names at scanner 3+
  color: string;
  x: number;
  z: number;
}

const DRIVE_SPEED = 17;

export class ExploreScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  fx = new FxLayer();
  onPoiClick: (id: string) => void = () => { /* set by game */ };
  interactive = false;

  private key = '';
  private world: THREE.Group | null = null;
  private heightAt: (x: number, z: number) => number = () => 0;
  private probe: THREE.Group | null = null;
  private probePos = new THREE.Vector3();
  private heading = 0;
  private poiGroup = new THREE.Group();
  private poiMeshes = new Map<string, THREE.Group>();
  private yaw = Math.PI;       // camera bearing around the probe
  private pitch = 0.42;
  private driving: { target: THREE.Vector3; done: () => void } | null = null;
  private landing: { t: number; dur: number; fromY: number; done: () => void } | null = null;
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private lastY = 0;
  private raycaster = new THREE.Raycaster();

  constructor() {
    this.scene.add(this.poiGroup, this.fx.group);
    const canvas = document.getElementById('game');
    canvas?.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      this.dragging = true;
      this.dragMoved = 0;
      this.lastX = (e as PointerEvent).clientX;
      this.lastY = (e as PointerEvent).clientY;
    });
    addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.interactive) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.0062;
      this.pitch = Math.max(0.18, Math.min(0.9, this.pitch + dy * 0.003));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('pointerup', (e) => {
      const wasDrag = this.dragMoved > 7;
      this.dragging = false;
      if (!this.interactive || wasDrag || this.driving || this.landing) return;
      this.pickPoi(e.clientX, e.clientY);
    });
  }

  /** Build (or reuse) the terrain for this planet and sync probe + beacons. */
  ensure(seedKey: string, type: PlanetType, upgrades: string[], probeAt: { x: number; z: number }, pois: Poi[]): void {
    if (this.key !== seedKey) {
      this.key = seedKey;
      if (this.world) { this.scene.remove(this.world); disposeObject(this.world); }
      const def = PLANET_TYPES[type];
      const sky = new THREE.Color(def.palette.sky).lerp(new THREE.Color('#7da4c4'), 0.25);
      const fogc = new THREE.Color(def.palette.fog).lerp(new THREE.Color('#7da4c4'), 0.2);
      this.scene.background = sky;
      this.scene.fog = type === 'void' ? null : new THREE.FogExp2(fogc.getHex(), 0.0035);
      const t = buildTerrain(seedKey, type);
      this.world = t.group;
      this.heightAt = t.heightAt;
      this.scene.add(this.world);
      this.yaw = Math.PI;
    }
    // probe mesh rebuilt every visit so installed upgrades stay visible
    if (this.probe) { this.scene.remove(this.probe); disposeObject(this.probe); }
    this.probe = buildProbeMesh({ upgrades });
    this.probePos.set(probeAt.x, this.heightAt(probeAt.x, probeAt.z), probeAt.z);
    this.probe.position.copy(this.probePos);
    this.scene.add(this.probe);
    this.setPois(pois);
    // face the camera toward the action (average bearing to beacons)
    if (pois.length) {
      let sx = 0, sz = 0;
      for (const p of pois) { sx += p.x - probeAt.x; sz += p.z - probeAt.z; }
      this.yaw = Math.atan2(sx, sz) + Math.PI;
    }
  }

  private setPois(pois: Poi[]): void {
    for (const [, m] of this.poiMeshes) { this.poiGroup.remove(m); disposeObject(m); }
    this.poiMeshes.clear();
    for (const poi of pois) {
      const m = this.buildMarker(poi);
      m.position.set(poi.x, this.heightAt(poi.x, poi.z), poi.z);
      this.poiGroup.add(m);
      this.poiMeshes.set(poi.id, m);
    }
  }

  private buildMarker(poi: Poi): THREE.Group {
    const grp = new THREE.Group();
    grp.userData['poiId'] = poi.id;
    const c = new THREE.Color(poi.color);

    // light pillar
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.9, 22, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    pillar.position.y = 11;
    grp.add(pillar);

    const halo = glowSprite(poi.color, 7, 0.55);
    halo.position.y = 2.2;
    grp.add(halo);

    // floating label panel
    const label = this.labelSprite(poi);
    label.position.y = 8.5;
    grp.add(label);

    // click target (generous invisible cylinder)
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 5.5, 22, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = 10;
    hit.userData['poiId'] = poi.id;
    grp.add(hit);

    grp.userData['pulse'] = Math.random() * 7;
    return grp;
  }

  private labelSprite(poi: Poi): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 144;
    const g = c.getContext('2d')!;
    const title = poi.label ?? 'UNKNOWN SIGNATURE';
    // pill background
    g.fillStyle = 'rgba(13,22,38,0.82)';
    const w = Math.min(490, 130 + Math.max(title.length, (poi.sub ?? '').length) * 13);
    const x0 = (512 - w) / 2;
    g.beginPath();
    (g as CanvasRenderingContext2D & { roundRect(x: number, y: number, w: number, h: number, r: number): void })
      .roundRect(x0, poi.sub ? 18 : 34, w, poi.sub ? 108 : 76, 22);
    g.fill();
    g.strokeStyle = poi.color;
    g.lineWidth = 3;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = poi.color;
    g.font = '700 34px Rubik, sans-serif';
    g.fillText(`${poi.glyph}  ${title}`, 256, poi.sub ? 64 : 82);
    if (poi.sub) {
      g.fillStyle = '#cfdded';
      g.font = '500 26px Rubik, sans-serif';
      g.fillText(poi.sub, 256, 102);
    }
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(13, 3.65, 1);
    return s;
  }

  private pickPoi(px: number, py: number): void {
    const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.poiMeshes.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const id = o.userData['poiId'] as string | undefined;
        if (id) { this.onPoiClick(id); return; }
        o = o.parent;
      }
    }
  }

  /** Drive the probe to a beacon, then call done (game fades to the encounter). */
  driveTo(poiId: string, done: () => void): void {
    const m = this.poiMeshes.get(poiId);
    if (!m || !this.probe) { done(); return; }
    this.driving = { target: m.position.clone(), done };
  }

  /** Descent from orbit: the probe sets down on its landing site. */
  playLanding(done: () => void): void {
    if (!this.probe) { done(); return; }
    this.landing = { t: 0, dur: 2.4, fromY: 56, done };
    this.probe.position.y = this.probePos.y + 56;
  }

  update(dt: number, t: number): void {
    this.fx.update(dt);

    // markers idle
    for (const [, m] of this.poiMeshes) {
      const ph = (m.userData['pulse'] as number) + t * 2;
      const halo = m.children[1] as THREE.Sprite | undefined;
      if (halo) halo.scale.setScalar(6 + Math.sin(ph) * 0.9);
      const label = m.children[2];
      if (label) label.position.y = 8.5 + Math.sin(ph * 0.7) * 0.3;
    }

    const probeAnim = this.probe?.userData['animate'] as ((t: number, dt: number) => void) | undefined;
    probeAnim?.(t, dt);

    // landing descent
    if (this.landing && this.probe) {
      this.landing.t += dt;
      const k = Math.min(1, this.landing.t / this.landing.dur);
      const ease = 1 - (1 - k) * (1 - k);
      this.probe.position.y = this.probePos.y + this.landing.fromY * (1 - ease);
      const exhaust = this.probe.userData['exhaust'] as THREE.Sprite | undefined;
      if (exhaust) (exhaust.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - k);
      if (k >= 1) {
        const fin = this.landing.done;
        this.landing = null;
        this.fx.ring(this.probePos.clone().add(new THREE.Vector3(0, 1, 0)), '#d8c9a8', 9);
        this.fx.burst(this.probePos.clone().add(new THREE.Vector3(0, 0.6, 0)), '#cbb89a', 18, 6);
        this.fx.addShake(0.5);
        fin();
      }
    }

    // driving
    if (this.driving && this.probe && !this.landing) {
      const to = this.driving.target;
      const delta = to.clone().sub(this.probePos);
      delta.y = 0;
      const dist = delta.length();
      if (dist < 2.2) {
        const fin = this.driving.done;
        this.driving = null;
        fin();
      } else {
        const step = Math.min(dist, DRIVE_SPEED * dt);
        const dir = delta.normalize();
        this.probePos.addScaledVector(dir, step);
        this.probePos.y = this.heightAt(this.probePos.x, this.probePos.z);
        this.heading = Math.atan2(dir.x, dir.z);
        const wheels = this.probe.userData['wheels'] as THREE.Mesh[] | undefined;
        if (wheels) for (const w of wheels) w.rotation.x += dt * 9;
      }
    }
    if (this.probe && !this.landing) {
      this.probe.position.set(this.probePos.x, this.probePos.y, this.probePos.z);
      this.probe.rotation.y += (this.heading - this.probe.rotation.y) * Math.min(1, dt * 6);
    }

    // orbit camera around the probe
    const radius = 24;
    const cy = Math.sin(this.pitch) * radius + 3;
    const ch = Math.cos(this.pitch) * radius;
    const target = this.probe ? this.probe.position : this.probePos;
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * ch,
      target.y + cy + this.fx.shake * (Math.random() - 0.5),
      target.z + Math.cos(this.yaw) * ch,
    );
    this.camera.lookAt(target.x, target.y + 2.5, target.z);
  }
}
