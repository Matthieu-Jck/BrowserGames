// stress.ts — the M0 perf spike kept as a tool (FL.stress): n particles orbiting a point
// through a ParticleContainer, to measure how many sprites a machine can push.
import { Particle, ParticleContainer, Rectangle, Texture, type Container } from 'pixi.js';

export class StressSpike {
  private pc: ParticleContainer | null = null;
  private data = new Float32Array(0);

  constructor(private readonly layer: Container) {}

  get count(): number { return this.pc ? this.pc.particleChildren.length : 0; }

  /** Replace the swarm with n particles (0 removes it). */
  set(n: number): void {
    if (this.pc) { this.pc.destroy(); this.pc = null; }
    if (n <= 0) return;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 24;
    const cx = cv.getContext('2d')!;
    cx.fillStyle = '#3fb8af'; cx.strokeStyle = '#1e1b2e'; cx.lineWidth = 2.5;
    cx.beginPath(); cx.arc(12, 12, 9, 0, Math.PI * 2); cx.fill(); cx.stroke();
    const tex = Texture.from(cv);
    const pc = new ParticleContainer({
      dynamicProperties: { position: true, rotation: false, vertex: false, uvs: false, color: false },
      boundsArea: new Rectangle(-1e6, -1e6, 2e6, 2e6),
    });
    this.data = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.data[i * 3] = 60 + (i % 997) * 1.3;
      this.data[i * 3 + 1] = (i * 2.399963) % (Math.PI * 2);
      this.data[i * 3 + 2] = 0.2 + (i % 13) * 0.03;
      pc.addParticle(new Particle({ texture: tex, x: 0, y: 0, anchorX: 0.5, anchorY: 0.5, scaleX: 0.5, scaleY: 0.5 }));
    }
    this.layer.addChild(pc);
    this.pc = pc;
  }

  /** Orbit the particles around (ox, oy) world px at `time` seconds. */
  update(time: number, ox: number, oy: number): void {
    if (!this.pc) return;
    const ps = this.pc.particleChildren, d = this.data;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      const r = d[i * 3]!, a = d[i * 3 + 1]! + time * d[i * 3 + 2]!;
      p.x = ox + Math.cos(a) * r; p.y = oy + Math.sin(a) * r;
    }
  }
}
