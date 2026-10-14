// world.js — builds the floor: geometry, canvas textures, props, fixtures,
// the dynamic light pool, interactables and the elevator.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, W, H, parseMap, regionAt, makeSolidTest, makeLosTest, makePathfinder } from './map.js';

// deterministic rng so the office is always the same office
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    const { grid, markers } = parseMap();
    this.grid = grid;
    this.markers = markers;
    this.isSolid = makeSolidTest(grid);
    this.los = makeLosTest(grid);
    this.findPath = makePathfinder(grid);
    this.rng = makeRng(33133);

    this.colliders = [];      // static prop AABBs {x0,x1,z0,z1}
    this.interactables = [];  // {x,z,r,label,visible:()=>bool,use:()=>void}
    this.fixtures = [];
    this.regionOn = { server: true, cubicles: true, break: true, storage: true, lobby: true, corridor: true };
    this.blackoutMode = false;
    this.globalUnease = 0;    // extra flicker as the night degrades
    this.time = 0;

    this._makeMaterials();
    this._buildShell();
    this._buildFixtures();
    this._buildProps();
    this._buildElevator();
    this._buildLightPool();
  }

  // ---------------------------------------------------------------- textures
  _makeMaterials() {
    const carpetTex = makeTex(128, (g, s) => {
      g.fillStyle = '#33403e'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? 'rgba(20,28,27,0.5)' : 'rgba(78,94,90,0.35)';
        g.fillRect(Math.random() * s, Math.random() * s, 1.6, 1.6);
      }
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1.5;
      g.strokeRect(0.75, 0.75, s - 1.5, s - 1.5); // carpet tile seam
    });

    const concreteTex = makeTex(128, (g, s) => {
      g.fillStyle = '#56544f'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = `rgba(${30 + Math.random() * 40},${30 + Math.random() * 40},${28 + Math.random() * 36},0.25)`;
        g.fillRect(Math.random() * s, Math.random() * s, 2.5, 2.5);
      }
      for (let i = 0; i < 6; i++) { // stains
        const x = Math.random() * s, y = Math.random() * s, r = 8 + Math.random() * 22;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(25,24,20,0.35)'); grd.addColorStop(1, 'rgba(25,24,20,0)');
        g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });

    const wallTex = makeTex(128, (g, s) => {
      g.fillStyle = '#b3aa95'; g.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 2) { // vertical streaks
        g.fillStyle = `rgba(60,55,42,${0.04 + Math.random() * 0.07})`;
        g.fillRect(x, 0, 2, s);
      }
      const grd = g.createLinearGradient(0, s * 0.55, 0, s); // grime toward floor
      grd.addColorStop(0, 'rgba(40,36,26,0)'); grd.addColorStop(1, 'rgba(40,36,26,0.45)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
      g.fillStyle = '#27241d'; g.fillRect(0, s - 9, s, 9); // baseboard
    });

    const ceilTex = makeTex(128, (g, s) => {
      g.fillStyle = '#c9c4b8'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = 'rgba(120,115,100,0.18)';
        g.fillRect(Math.random() * s, Math.random() * s, 1.6, 1.6);
      }
      g.strokeStyle = 'rgba(60,55,45,0.55)'; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s);
      g.stroke();
      g.strokeRect(1, 1, s - 2, s - 2);
      const x = Math.random() * s, y = Math.random() * s; // one water stain per tile-cluster
      const grd = g.createRadialGradient(x, y, 2, x, y, 26);
      grd.addColorStop(0, 'rgba(110,92,52,0.30)'); grd.addColorStop(1, 'rgba(110,92,52,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });

    this.mats = {
      wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }),
      carpet: new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1.0 }),
      concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92 }),
      ceil: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95 }),
      desk: new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.8 }),
      partition: new THREE.MeshStandardMaterial({ color: 0x65706c, roughness: 1.0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x565a5e, roughness: 0.55, metalness: 0.35 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 }),
      paper: new THREE.MeshStandardMaterial({ color: 0xcfc9b8, roughness: 1.0 }),
      plant: new THREE.MeshStandardMaterial({ color: 0x1d3322, roughness: 1.0 }),
    };
  }

  // -------------------------------------------------------------- shell
  _buildShell() {
    const floorByMat = { carpet: [], concrete: [] };
    const ceils = [];
    const walls = [];

    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        if (!this.grid[cy][cx]) {
          const region = regionAt(cx, cy);
          const f = new THREE.PlaneGeometry(CELL, CELL);
          f.rotateX(-Math.PI / 2); f.translate(x, 0, z);
          floorByMat[(region === 'storage' || region === 'server') ? 'concrete' : 'carpet'].push(f);
          const c = new THREE.PlaneGeometry(CELL, CELL);
          c.rotateX(Math.PI / 2); c.translate(x, WALL_H, z);
          ceils.push(c);
        } else {
          // only wall cells that border an open cell need geometry
          let open = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if (cy + dy >= 0 && cy + dy < H && cx + dx >= 0 && cx + dx < W && !this.grid[cy + dy][cx + dx]) open = true;
          if (open) {
            const b = new THREE.BoxGeometry(CELL, WALL_H, CELL);
            b.translate(x, WALL_H / 2, z);
            walls.push(b);
          }
        }
      }
    }

    const add = (geos, mat, cast, recv) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = cast; m.receiveShadow = recv;
      this.scene.add(m);
    };
    add(floorByMat.carpet, this.mats.carpet, false, true);
    add(floorByMat.concrete, this.mats.concrete, false, true);
    add(ceils, this.mats.ceil, false, true);
    add(walls, this.mats.wall, true, true);
  }

  // -------------------------------------------------------------- fixtures
  _buildFixtures() {
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        if (this.grid[cy][cx]) continue;
        const region = regionAt(cx, cy);
        const want = region === 'corridor'
          ? (cx % 2 === 0 && cy % 2 === 0)
          : (cx % 3 === 1 && cy % 3 === 1);
        if (!want) continue;
        this.fixtures.push({
          cx, cy, region,
          x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL,
          on: true, broken: this.rng() < 0.06,
          flicker: this.rng() < 0.18 ? 0.3 + this.rng() * 0.5 : 0,
          phase: this.rng() * 100,
          bright: 1,
        });
      }
    }
    const geo = new THREE.BoxGeometry(1.5, 0.07, 0.6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.fixMesh = new THREE.InstancedMesh(geo, mat, this.fixtures.length);
    const m4 = new THREE.Matrix4();
    this.fixtures.forEach((f, i) => {
      m4.makeTranslation(f.x, WALL_H - 0.04, f.z);
      this.fixMesh.setMatrixAt(i, m4);
      this.fixMesh.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    this.scene.add(this.fixMesh);
  }

  _buildLightPool() {
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xd2ecd8, 0, 18, 1.6);
      this.scene.add(l);
      this.pool.push(l);
    }
    this.ambient = new THREE.AmbientLight(0x4d5a54, 3.2);
    this.hemi = new THREE.HemisphereLight(0x44504a, 0x1c1812, 1.4);
    this.scene.add(this.ambient, this.hemi);
  }

  fixturesIn(region) { return this.fixtures.filter(f => f.region === region); }

  // -------------------------------------------------------------- props
  _addCollider(x, z, w, d) {
    this.colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  }

  addInteract(it) { this.interactables.push(it); return it; }

  _buildProps() {
    const buckets = new Map(); // material -> geometries
    const put = (geo, matName, x, y, z, ry = 0) => {
      if (ry) geo.rotateY(ry);
      geo.translate(x, y, z);
      if (!buckets.has(matName)) buckets.set(matName, []);
      buckets.get(matName).push(geo);
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const rng = this.rng;
    const wp = (cx, cy) => ({ x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL });

    // ---- cubicle farm: clusters of partitions + desks, casting long shadows
    for (const [bx, by] of [[4, 11], [9, 11], [13, 11], [4, 15], [9, 15], [13, 15], [4, 19], [9, 19], [13, 19]]) {
      const { x, z } = wp(bx, by);
      const ry = 0; // identical clusters, row after row — that's the point
      put(box(3.4, 1.5, 0.08), 'partition', x, 0.75, z - 1.2, ry);
      put(box(0.08, 1.5, 2.4), 'partition', x - 1.7, 0.75, z, ry);
      put(box(2.6, 0.07, 1.0), 'desk', x, 0.74, z - 0.65, ry);
      put(box(0.07, 0.74, 0.9), 'desk', x - 1.2, 0.37, z - 0.65, ry);
      put(box(0.07, 0.74, 0.9), 'desk', x + 1.2, 0.37, z - 0.65, ry);
      if (rng() < 0.8) { // monitor, dead screen
        put(box(0.55, 0.38, 0.05), 'plastic', x + (rng() - 0.5), 1.05, z - 0.8, ry);
        put(box(0.1, 0.22, 0.1), 'plastic', x, 0.85, z - 0.8, ry);
      }
      if (rng() < 0.7) put(box(0.5, 0.5, 0.5), 'dark', x + 0.6, 0.25, z + 0.7, rng() * 6); // chair seat
      this._addCollider(x, z - 0.9, 3.4, 1.4);
    }

    // ---- server room: two rack rows — the best shadow casters in the game
    for (const row of [3, 5]) {
      for (let cx = 15; cx <= 26; cx += 2) {
        const { x, z } = wp(cx, row);
        put(box(1.4, 2.3, 0.95), 'metal', x, 1.15, z);
        this._addCollider(x, z, 1.5, 1.05);
      }
    }
    // blinking rack LEDs
    const ledCount = 90;
    this.leds = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      ledCount
    );
    this.ledData = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < ledCount; i++) {
      const row = rng() < 0.5 ? 3 : 5;
      const cx = 15 + Math.floor(rng() * 6) * 2;
      const { x, z } = wp(cx, row);
      const zz = z + (row === 3 ? 0.49 : -0.49);
      m4.makeRotationY(row === 3 ? 0 : Math.PI);
      m4.setPosition(x + (rng() - 0.5) * 1.1, 0.4 + rng() * 1.7, zz);
      this.leds.setMatrixAt(i, m4);
      this.ledData.push({ phase: rng() * 10, speed: 0.5 + rng() * 4, red: false });
    }
    this.scene.add(this.leds);

    // ---- storage: shelf racks in rows
    for (const row of [19, 21, 23]) {
      for (let cx = 26; cx <= 36; cx += 3) {
        const { x, z } = wp(cx, row);
        put(box(3.0, 0.06, 0.9), 'metal', x, 0.5, z);
        put(box(3.0, 0.06, 0.9), 'metal', x, 1.3, z);
        put(box(3.0, 0.06, 0.9), 'metal', x, 2.1, z);
        for (const sx of [-1.45, 1.45]) {
          put(box(0.07, 2.2, 0.9), 'metal', x + sx, 1.1, z);
        }
        for (let b = 0; b < 4; b++) { // cardboard boxes
          if (rng() < 0.7) put(
            box(0.5 + rng() * 0.3, 0.4 + rng() * 0.25, 0.5),
            'desk', x - 1.1 + b * 0.75, [0.75, 1.55][Math.floor(rng() * 2)], z, (rng() - 0.5) * 0.4
          );
        }
        this._addCollider(x, z, 3.1, 1.0);
      }
    }

    // ---- break room
    {
      const { x, z } = wp(30, 12);
      put(box(2.2, 0.07, 1.2), 'desk', x, 0.78, z);
      put(box(0.12, 0.78, 0.12), 'metal', x, 0.39, z);
      this._addCollider(x, z, 2.2, 1.2);
      for (const [dx, dz] of [[-1.4, 0], [1.4, 0], [0, -1.1], [0, 1.1]])
        put(box(0.45, 0.5, 0.45), 'plastic', x + dx, 0.25, z + dz, rng() * 6);
      // counter along north wall
      put(box(7, 0.9, 1.0), 'desk', wp(33, 9).x, 0.45, 9 * CELL + 0.6);
      this._addCollider(wp(33, 9).x, 9 * CELL + 0.6, 7, 1.0);
      put(box(0.55, 0.35, 0.45), 'plastic', wp(31, 9).x, 1.1, 9 * CELL + 0.6); // microwave
      // vending machine — its glow flickers
      const vm = wp(37, 14);
      put(box(1.2, 2.0, 0.9), 'plastic', vm.x, 1.0, vm.z);
      this._addCollider(vm.x, vm.z, 1.3, 1.0);
      this.vendGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.4),
        new THREE.MeshBasicMaterial({ color: 0x6a86b8 })
      );
      this.vendGlow.position.set(vm.x - 0.61, 1.1, vm.z);
      this.vendGlow.rotation.y = -Math.PI / 2;
      this.scene.add(this.vendGlow);
    }

    // ---- lobby: reception desk, couch, plants, the clock stuck at 3:33
    {
      const { x, z } = wp(17, 28);
      put(box(3.2, 1.05, 1.0), 'desk', x, 0.52, z);
      this._addCollider(x, z, 3.2, 1.0);
      const couch = wp(25, 31);
      put(box(2.4, 0.45, 1.0), 'partition', couch.x, 0.22, couch.z);
      put(box(2.4, 0.6, 0.25), 'partition', couch.x, 0.7, couch.z + 0.4);
      this._addCollider(couch.x, couch.z, 2.4, 1.1);
      for (const [px, py] of [[14, 27], [27, 27]]) {
        const p = wp(px, py);
        put(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 8), 'plastic', p.x, 0.25, p.z);
        put(new THREE.ConeGeometry(0.55, 1.3, 7), 'plant', p.x, 1.1, p.z);
        this._addCollider(p.x, p.z, 0.7, 0.7);
      }
      this._buildClock(wp(21, 26).x, 26 * CELL + 0.06);
    }

    // ---- scattered papers everywhere
    for (let i = 0; i < 60; i++) {
      const cx = Math.floor(rng() * W), cy = Math.floor(rng() * H);
      if (this.isSolid(cx, cy)) continue;
      const { x, z } = wp(cx, cy);
      const g = new THREE.PlaneGeometry(0.3, 0.4);
      g.rotateX(-Math.PI / 2);
      put(g, 'paper', x + (rng() - 0.5) * 2.5, 0.012 + rng() * 0.004, z + (rng() - 0.5) * 2.5, rng() * 6);
    }

    // merge buckets into one mesh per material
    for (const [matName, geos] of buckets) {
      const m = new THREE.Mesh(mergeGeometries(geos, false), this.mats[matName]);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }

    this._buildPhone();
    this._buildPickups();
    this._buildWriting();
  }

  _buildClock(x, z) {
    const tex = makeTex(128, (g, s) => {
      g.fillStyle = '#ddd6c4'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 3, 0, 7); g.fill();
      g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = '#333'; g.lineWidth = 3;
      // 3:33
      g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + 30, s / 2 + 6); g.stroke(); // hour ~3
      g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + 22, s / 2 + 32); g.stroke(); // minute ~33
    });
    const clock = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, transparent: true })
    );
    clock.position.set(x, 2.1, z);
    this.scene.add(clock);
  }

  _buildPhone() {
    const p = this.markers.phone;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), this.mats.plastic);
    const handset = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.08), this.mats.plastic);
    handset.position.set(0, 0.09, -0.06);
    body.castShadow = handset.castShadow = true;
    grp.add(body, handset);
    grp.position.set(p.x + 0.8, 0.78, p.z - 0.6);
    this.scene.add(grp);
    this.phoneMesh = grp;
    this.phoneRinging = false;
  }

  _buildPickups() {
    this.pickups = [];
    const glowMat = (color) => new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: color, emissiveIntensity: 1.4, roughness: 0.5,
    });
    this.markers.fuses.forEach((f, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.12), glowMat(0xcc7722));
      m.position.set(f.x, 1.0, f.z);
      m.castShadow = true;
      this.scene.add(m);
      this.pickups.push({ mesh: m, kind: 'fuse', idx: i, taken: false, baseY: 1.0, phase: i * 2 });
    });
    this.markers.batteries.forEach((b, i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), glowMat(0x88bb44));
      m.position.set(b.x, 0.85, b.z);
      m.castShadow = true;
      this.scene.add(m);
      this.pickups.push({ mesh: m, kind: 'battery', idx: i, taken: false, baseY: 0.85, phase: i * 1.3 });
    });
  }

  _buildWriting() {
    // revealed by the flashlight during the blackout — lobby north wall
    const tex = makeTex(512, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.fillStyle = '#7a1212';
      g.font = 'bold 72px Georgia';
      g.textAlign = 'center';
      g.save(); g.translate(s / 2, s / 2 - 40); g.rotate(-0.03);
      g.fillText('YOU NEVER', 0, 0); g.restore();
      g.save(); g.translate(s / 2, s / 2 + 60); g.rotate(0.02);
      g.fillText('CLOCKED OUT', 0, 0); g.restore();
      for (let i = 0; i < 40; i++) { // drips
        const x = s * 0.15 + Math.random() * s * 0.7, y = s / 2 + Math.random() * 60;
        g.fillRect(x, y, 3, 20 + Math.random() * 80);
      }
    });
    this.writing = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({
        map: tex, transparent: true, roughness: 1,
        emissive: 0x550808, emissiveMap: tex, emissiveIntensity: 0.0,
      })
    );
    this.writing.position.set(58, 1.9, 26 * CELL + 0.07); // lobby north wall, west of corridor mouth
    this.writing.visible = false;
    this.scene.add(this.writing);
  }

  // -------------------------------------------------------------- elevator
  _buildElevator() {
    const cx = 84;                 // center of the alcove (cells 20–21)
    const zDoor = 33 * CELL;       // lobby/alcove boundary
    const g = new THREE.Group();

    // narrow the 8u-wide alcove down to a 2.4u cab with filler walls
    const filler = new THREE.Mesh(new THREE.BoxGeometry(2.8, WALL_H, 0.4), this.mats.wall);
    for (const sx of [-2.7, 2.7]) {
      const f = filler.clone();
      f.position.set(cx + sx, WALL_H / 2, zDoor + 0.2);
      f.castShadow = f.receiveShadow = true;
      g.add(f);
      this.colliders.push({ x0: cx + sx - 1.4, x1: cx + sx + 1.4, z0: zDoor, z1: zDoor + 0.4 });
    }
    for (const sx of [-1.35, 1.35]) { // cab side walls
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.25, WALL_H, 4.5), this.mats.metal);
      sw.position.set(cx + sx, WALL_H / 2, zDoor + 2.4);
      sw.castShadow = sw.receiveShadow = true;
      g.add(sw);
      this.colliders.push({ x0: cx + sx - 0.15, x1: cx + sx + 0.15, z0: zDoor, z1: zDoor + 4.6 });
    }
    // frame above doors
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.3), this.mats.metal);
    lintel.position.set(cx, WALL_H - 0.45, zDoor + 0.15);
    g.add(lintel);

    // the doors themselves
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.35, 0.12), this.mats.metal);
    this.doorR = this.doorL.clone();
    this.doorL.position.set(cx - 0.575, 1.175, zDoor + 0.18);
    this.doorR.position.set(cx + 0.575, 1.175, zDoor + 0.18);
    this.doorL.castShadow = this.doorR.castShadow = true;
    g.add(this.doorL, this.doorR);
    this.doorOpenT = 0;       // 0 closed → 1 open
    this.doorTarget = 0;
    this.elevatorCx = cx;
    this.elevatorZ = zDoor;

    // floor display above the doors
    this.dispCanvas = document.createElement('canvas');
    this.dispCanvas.width = 96; this.dispCanvas.height = 64;
    this.dispTex = new THREE.CanvasTexture(this.dispCanvas);
    this.dispTex.colorSpace = THREE.SRGBColorSpace;
    this.display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.4),
      new THREE.MeshBasicMaterial({ map: this.dispTex })
    );
    this.display.position.set(cx, WALL_H - 0.5, zDoor - 0.01);
    this.display.rotation.y = Math.PI;
    g.add(this.display);
    this.setDisplay('—');

    // cab ceiling light — comes alive when the elevator arrives
    this.cabPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    this.cabPanel.rotation.x = Math.PI / 2;
    this.cabPanel.position.set(cx, WALL_H - 0.06, zDoor + 2.0);
    g.add(this.cabPanel);
    this.cabLight = new THREE.PointLight(0xffe9c4, 0, 20, 1.5);
    this.cabLight.position.set(cx, WALL_H - 0.5, zDoor + 1.8);
    g.add(this.cabLight);

    // breaker panel on the lobby wall beside the elevator
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.12), this.mats.metal);
    panel.position.set(cx - 5.5, 1.5, zDoor - 0.06);
    panel.castShadow = true;
    g.add(panel);
    this.panelPos = { x: cx - 5.5, z: zDoor - 0.3 };

    this.scene.add(g);
  }

  setDisplay(text, color = '#a33') {
    const g = this.dispCanvas.getContext('2d');
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = color;
    g.font = 'bold 44px monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 48, 34);
    this.dispTex.needsUpdate = true;
  }

  elevatorArrive() {
    this.doorTarget = 1;
    this.cabLight.intensity = 80;
    this.cabPanel.material.color.setRGB(1.3, 1.15, 0.9);
  }

  doorBlocked() { return this.doorOpenT < 0.7; }

  inElevator(x, z) {
    return this.doorOpenT > 0.7 && Math.abs(x - this.elevatorCx) < 1.1 && z > this.elevatorZ + 0.6;
  }

  // -------------------------------------------------------------- runtime
  _fixtureBrightness(f, t) {
    if (this.blackoutMode || f.broken || !f.on || !this.regionOn[f.region]) return 0;
    let b = 1;
    const fl = Math.min(1, f.flicker + this.globalUnease);
    if (fl > 0) {
      const n = Math.sin(t * 23 + f.phase) * Math.sin(t * 7.3 + f.phase * 2.1);
      if (n > 1 - fl) b = 0.12;
    }
    return b * (0.94 + 0.06 * Math.sin(t * 41 + f.phase)); // mains shimmer
  }

  update(dt, playerPos) {
    const t = this.time += dt;
    const col = new THREE.Color();

    // fixture brightness + instanced emissive colors
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      f.bright = this._fixtureBrightness(f, t);
      const b = f.bright;
      col.setRGB(1.0 * b + 0.02, 1.12 * b + 0.022, 1.0 * b + 0.02);
      this.fixMesh.setColorAt(i, col);
    }
    this.fixMesh.instanceColor.needsUpdate = true;

    // light pool: real lights follow the nearest lit fixtures
    const lit = this.fixtures
      .filter(f => f.bright > 0.02)
      .map(f => ({ f, d2: (f.x - playerPos.x) ** 2 + (f.z - playerPos.z) ** 2 }))
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, this.pool.length);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      if (i < lit.length) {
        const { f } = lit[i];
        l.position.set(f.x, WALL_H - 0.45, f.z);
        l.intensity = 55 * f.bright;
      } else {
        l.intensity = 0;
      }
    }

    // server LEDs
    if (this.leds) {
      for (let i = 0; i < this.ledData.length; i++) {
        const d = this.ledData[i];
        const on = Math.sin(t * d.speed + d.phase) > -0.2;
        col.setRGB(d.red ? (on ? 2 : 0.1) : (on ? 0.1 : 0.02), d.red ? 0.02 : (on ? 1.6 : 0.05), 0.04);
        this.leds.setColorAt(i, col);
      }
      this.leds.instanceColor.needsUpdate = true;
    }

    // vending machine glow flicker
    if (this.vendGlow) {
      const on = !this.blackoutMode && this.regionOn.break;
      const fl = Math.sin(t * 31) * Math.sin(t * 8.7) > 0.85 ? 0.2 : 1;
      this.vendGlow.material.color.setRGB(0.30 * fl * on, 0.40 * fl * on, 0.58 * fl * on);
    }

    // pickups bob
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.position.y = p.baseY + Math.sin(t * 2 + p.phase) * 0.05;
      p.mesh.rotation.y = t * 0.8 + p.phase;
    }

    // phone vibrates while ringing
    if (this.phoneRinging) {
      this.phoneMesh.children[1].position.y = 0.09 + (Math.sin(t * 80) > 0 ? 0.008 : 0);
    }

    // elevator doors
    this.doorOpenT += (this.doorTarget - this.doorOpenT) * Math.min(1, dt * 1.6);
    this.doorL.position.x = this.elevatorCx - 0.575 - this.doorOpenT * 1.05;
    this.doorR.position.x = this.elevatorCx + 0.575 + this.doorOpenT * 1.05;
  }

  setLedRed() { this.ledData.forEach(d => { d.red = true; d.speed *= 0.3; }); }

  blackout() {
    this.blackoutMode = true;
    this.ambient.intensity = 0.35;
    this.hemi.intensity = 0.15;
    this.writing.visible = true;
    this.writing.material.emissiveIntensity = 0.12;
  }
}
