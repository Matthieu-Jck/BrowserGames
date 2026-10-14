// scene-manager.ts — one renderer, one composer (bloom + telemetry shader),
// scene/camera swapping, worldToScreen for damage numbers.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const TelemetryShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, flash: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float flash;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float ab = 0.0016 * length(c);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab * 2.0).b;
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(time) * 7.0);
      col += (g - 0.5) * 0.016;
      float v = smoothstep(1.05, 0.3, length(c));
      col *= mix(0.84, 1.0, v);
      col += flash * vec3(1.0, 0.97, 0.9);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class SceneManager {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  private renderPass: RenderPass;
  private telemetry: ShaderPass;
  private clock = new THREE.Clock();
  camera: THREE.PerspectiveCamera | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;

    this.composer = new EffectComposer(this.renderer);
    const empty = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
    this.renderPass = new RenderPass(empty, cam);
    this.composer.addPass(this.renderPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.4, 0.85);
    this.composer.addPass(bloom);
    this.telemetry = new ShaderPass(TelemetryShader);
    this.composer.addPass(this.telemetry);

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
      if (this.camera) {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
      }
    });
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.camera = camera;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  flash(v: number): void {
    const u = this.telemetry.uniforms as { flash: { value: number } };
    u.flash.value = Math.min(1.6, Math.max(u.flash.value, v));
  }

  /** Project a world position to CSS pixels (for damage numbers). */
  worldToScreen(pos: THREE.Vector3): { x: number; y: number } {
    if (!this.camera) return { x: innerWidth / 2, y: innerHeight / 2 };
    const v = pos.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  render(): number {
    const dt = Math.min(0.05, this.clock.getDelta());
    const u = this.telemetry.uniforms as { time: { value: number }; flash: { value: number } };
    u.time.value = this.clock.elapsedTime;
    u.flash.value = Math.max(0, u.flash.value - dt * 2.2);
    if (!document.hidden) this.composer.render();
    return dt;
  }

  get elapsed(): number { return this.clock.elapsedTime; }
}
