// main.js — boot, render loop, post-processing, HUD, game states.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Entity } from './entity.js';
import { GameAudio } from './audio.js';
import { Director } from './director.js';

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.044);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 120);

const world = new World(scene);
const player = new Player(camera, world, scene);
const entity = new Entity(scene, world);
const audio = new GameAudio();

player.onFootstep = (run) => audio.footstep(run);
player.onToggleFlash = () => audio.pickup();

// ---------------------------------------------------------------- post fx
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    fear: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float fear;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // chromatic aberration grows with fear
      float ab = (0.0015 + fear * 0.004) * length(c);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab * 2.0).b;
      // film grain
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(time) * 7.0);
      col += (g - 0.5) * (0.06 + fear * 0.05);
      // scanlines, faint
      col *= 1.0 - 0.04 * sin(uv.y * 900.0);
      // vignette tightens with fear
      float v = smoothstep(0.95 - fear * 0.25, 0.25, length(c));
      col *= mix(0.35, 1.0, v);
      // fear pulse
      col *= 1.0 - fear * 0.12 * (0.5 + 0.5 * sin(time * 9.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const filmPass = new ShaderPass(FilmShader);
composer.addPass(filmPass);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- HUD / ui
const $ = (id) => document.getElementById(id);
const ui = {
  subtitleTimer: null,
  subtitle(text, dur = 4.5) {
    const el = $('subtitle');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.subtitleTimer);
    this.subtitleTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
  },
  objective(text) {
    $('objective').textContent = text;
  },
  fuses(n) {
    [...$('fuses').children].forEach((pip, i) => pip.classList.toggle('lit', i < n));
  },
};

let state = 'title'; // title | playing | paused | dead | won
let startTime = 0;

const director = new Director({
  world, player, entity, audio, ui,
  onDeath: () => {
    state = 'dead';
    player.enabled = false;
    $('jumpscare').classList.add('show');
    setTimeout(() => {
      $('jumpscare').classList.remove('show');
      $('overlay-dead').classList.add('show');
      document.exitPointerLock();
    }, 900);
  },
  onWin: () => {
    state = 'won';
    player.enabled = false;
    $('fade').classList.add('show');
    setTimeout(() => {
      const t = Math.floor((performance.now() - startTime) / 1000);
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(t % 60).padStart(2, '0');
      $('win-time').textContent = `${mm}:${ss}`;
      $('overlay-win').classList.add('show');
      document.exitPointerLock();
    }, 2200);
  },
});

// ---------------------------------------------------------------- states
function beginGame() {
  $('overlay-title').classList.remove('show');
  $('overlay-pause').classList.remove('show');
  $('hud').classList.add('show');
  try { audio.init(); audio.resume(); } catch (e) { console.warn('audio unavailable', e); }
  if (state === 'title') {
    director.start();
    startTime = performance.now();
  }
  state = 'playing';
  player.enabled = true;
  // pointer lock last — it can fail (rapid Esc-resume, iframes) without killing the game
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => ui.subtitle('click again to capture the mouse.'));
  } catch {
    ui.subtitle('click again to capture the mouse.');
  }
}

$('overlay-title').addEventListener('click', beginGame);
$('overlay-pause').addEventListener('click', () => {
  if (state === 'paused') beginGame();
});
$('btn-retry').addEventListener('click', () => location.reload());
$('btn-again').addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === null && state === 'playing') {
    state = 'paused';
    player.enabled = false;
    $('overlay-pause').classList.add('show');
  } else if (document.pointerLockElement && state === 'paused') {
    $('overlay-pause').classList.remove('show');
  }
});
document.addEventListener('pointerlockerror', () => {
  ui.subtitle('pointer lock failed — click again.');
});

// ---------------------------------------------------------------- interaction
let currentInteract = null;
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && state === 'playing' && currentInteract) {
    const it = currentInteract;
    if (it.usable && !it.usable()) { audio.buzz(0.5); return; }
    it.use();
  }
});

function updateInteract() {
  currentInteract = null;
  let best = Infinity;
  for (const it of world.interactables) {
    if (!it.visible()) continue;
    const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
    if (d < it.r && d < best) { best = d; currentInteract = it; }
  }
  const el = $('prompt');
  if (currentInteract) {
    const label = typeof currentInteract.label === 'function' ? currentInteract.label() : currentInteract.label;
    el.textContent = label;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// ---------------------------------------------------------------- loop
// console access for debugging / smoke tests
window.OT = { world, player, entity, director, audio, camera };

const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  if (state === 'playing' || state === 'dead' || state === 'won') {
    if (state === 'playing') {
      player.update(dt);
      director.update(dt);
      updateInteract();
    }
    entity.update(dt, player);
    world.update(dt, player.pos);

    const threat = entity.threat(player.pos);
    audio.update(dt, threat);
    filmPass.uniforms.fear.value +=
      ((threat * 0.8 + (world.blackoutMode ? 0.18 : 0)) - filmPass.uniforms.fear.value) * Math.min(1, dt * 3);

    // fog closes in during the blackout
    const targetFog = world.blackoutMode ? 0.07 : 0.044;
    scene.fog.density += (targetFog - scene.fog.density) * Math.min(1, dt * 0.7);

    // HUD
    $('battery-fill').style.width = player.battery + '%';
    $('battery-fill').classList.toggle('low', player.battery < 25);
    $('stamina-fill').style.width = player.stamina + '%';
  }

  filmPass.uniforms.time.value = t;
  composer.render();
}
tick();
