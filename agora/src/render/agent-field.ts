// agent-field.ts — the generative backbone. Hundreds of buyer/seller motes drift on a
// noise flow-field; calm and alive behind the reading panels. A `pulse` lets a harsh
// verdict ripple through the whole crowd so the consequence is *felt*, not just read.
import { makeNoise2, makeRng } from '@/core/rng';
import { glowDot } from './draw';
import { palette } from './palette';
import { clamp } from '@/core/math';

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: 0 | 1; // 0 buyer, 1 seller
  size: number;
  phase: number;
}

export class AgentField {
  private motes: Mote[] = [];
  private noise = makeNoise2('agora-field');
  private w = 0;
  private h = 0;
  private agitation = 0; // 0 calm … 1 shocked
  private agitationHue = palette.accent;

  constructor(count = 240, seed: string | number = 'field') {
    const rng = makeRng(seed);
    for (let i = 0; i < count; i++) {
      this.motes.push({
        x: rng.next(),
        y: rng.next(),
        vx: 0,
        vy: 0,
        role: rng.chance(0.5) ? 0 : 1,
        size: rng.range(1.4, 3.6),
        phase: rng.range(0, Math.PI * 2),
      });
    }
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  /** Send a shock through the field — buyers/sellers scatter, tinted by the verdict. */
  pulse(intensity: number, hue: string): void {
    this.agitation = clamp(this.agitation + intensity, 0, 1);
    this.agitationHue = hue;
  }

  update(dt: number, t: number): void {
    this.agitation = Math.max(0, this.agitation - dt * 0.5);
    const drift = 0.018 + this.agitation * 0.06;
    for (const m of this.motes) {
      // Flow-field angle from fbm noise at the mote's position.
      const a = this.noise.fbm(m.x * 2.2 + t * 0.02, m.y * 2.2, 3) * Math.PI * 4;
      m.vx += Math.cos(a) * drift * dt;
      m.vy += Math.sin(a) * drift * dt;
      // Agitation adds outward jitter.
      if (this.agitation > 0.01) {
        m.vx += (m.x - 0.5) * this.agitation * 0.4 * dt;
        m.vy += (m.y - 0.5) * this.agitation * 0.4 * dt;
      }
      m.vx *= 0.94;
      m.vy *= 0.94;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // Wrap in normalised space.
      if (m.x < -0.05) m.x += 1.1; else if (m.x > 1.05) m.x -= 1.1;
      if (m.y < -0.05) m.y += 1.1; else if (m.y > 1.05) m.y -= 1.1;
    }
  }

  render(ctx: CanvasRenderingContext2D, t: number, scroll: number): void {
    const par = (scroll * 0.05) % (this.h + 80);
    const baseBuyer = this.agitation > 0.2 ? this.agitationHue : palette.buyer;
    const baseSeller = this.agitation > 0.2 ? this.agitationHue : palette.seller;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const px = m.x * this.w;
      let py = m.y * this.h - par * 0.5;
      if (py < -20) py += this.h + 40;
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.5 + m.phase));
      const alpha = (0.06 + this.agitation * 0.12) * twinkle;
      glowDot(ctx, px, py, m.size * (3 + this.agitation * 2), m.role === 0 ? baseBuyer : baseSeller, alpha);
    }
    ctx.restore();
  }
}
