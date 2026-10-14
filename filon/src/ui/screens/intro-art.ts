// intro-art.ts — the intro's illustrations (D31), drawn in code like everything else: inline
// SVG in the game's ink — flat fills from the palette (render/art/tokens.ts, the same values as
// the CSS tokens), a violet-black ink line with round joins, hatching on the shadow sides, no
// gradients. Three panels of the comic strip (Verrière at dusk; the investor at the window of
// a glass tower, a hologram turning savings into a company; Ysmère from orbit with the Crier
// Ring and its exchange, for CrierBelt's answer) and the CrierBelt mark on a canvas (the very
// `crierMark` the trade post and the Heart's dish wear). Text never goes in the drawings: the
// captions and the contract are DOM, so they follow the language.
//
// Ambient motion is CSS (intro.css: twinkles, the Ring's glint, the hologram's flicker) plus a
// few SMIL `animateMotion`s (a shuttle rising to the Ring, coins flying into the company), left
// out when the player asks for reduced motion. SVG ids carry a per-panel prefix: the three
// drawings share the document.
import { C, mix } from '@/render/art/tokens';
import { crierMark } from '@/render/art/shapes';

const INK = C.ink;
const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Something travelling a path for ever (SMIL), or nothing at all with reduced motion. */
const mover = (cls: string, path: string, dur: number, begin: number, body: string, extra = ''): string =>
  reduced() ? '' : `<g class="${cls}"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${path}" ${extra}/>${body}</g>`;

/** Short parallel strokes (shadow-side hatching) along a segment, each `len` long at angle `a`. */
function hatch(x0: number, y0: number, x1: number, y1: number, n: number, len: number, a = 2.2): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}`;
  }
  return `<path class="ia-hatch" d="${d}"/>`;
}

/** Stars: tiny paper dots, a few twinkling. */
function stars(pts: ReadonlyArray<readonly [number, number, number]>): string {
  return pts.map(([x, y, r], i) => `<circle class="${i % 3 === 0 ? 'ia-tw' : ''}" style="--d:${(i * 0.37) % 2.6}s" cx="${x}" cy="${y}" r="${r}" fill="${C.paper}"/>`).join('');
}

/** The ocelle (◉), the Crier's coin: a gold ring around a dot (as coin.ts draws it in the UI). */
const coin = (x: number, y: number, r = 7): string =>
  `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#fff3cf" stroke="#6b3f0b" stroke-width="1.4"/><circle r="${r * 0.78}" fill="none" stroke="#e2a52a" stroke-width="${r * 0.34}"/><circle r="${r * 0.33}" fill="#6b3f0b"/></g>`;

// ── panel 1: Verrière at dusk ────────────────────────────────────────────────

export function cityArt(): string {
  const sky = [C.lilacD, mix(C.lilacD, C.lilac, 0.55), C.lilac, mix(C.lilac, C.coralL, 0.5), mix(C.coralL, C.peach, 0.55), C.peachL];
  const RING = 'M-80 296 A420 290 0 0 1 680 296';
  const win = (x: number, y: number, tw = false, d = 0): string => `<rect class="${tw ? 'ia-tw' : ''}" style="--d:${d}s" x="${x}" y="${y}" width="4" height="6" rx="1" fill="${C.glowPeach}"/>`;
  const windows = [
    [399, 176], [405, 196], [399, 214], [405, 236], [399, 256], [475, 204], [489, 204], [482, 222], [475, 242], [489, 242], [482, 262],
    [348, 230], [358, 244], [348, 260], [531, 252], [541, 266],
  ].map(([x, y], i) => win(x!, y!, i % 3 === 1, (i * 0.53) % 3)).join('');
  return `<svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><clipPath id="ia-dome"><path d="M384 284 A62 58 0 0 1 508 284 Z"/></clipPath></defs>
  <rect width="600" height="400" fill="#3f3468"/>
  <path d="M0 96 C120 86 220 104 330 92 S520 86 600 98 V400 H0 Z" fill="${sky[0]}"/>
  <path d="M0 152 C140 142 260 162 380 150 S540 146 600 156 V400 H0 Z" fill="${sky[1]}"/>
  <path d="M0 196 C150 188 280 206 420 196 S560 192 600 200 V400 H0 Z" fill="${sky[2]}"/>
  <path d="M0 232 C160 226 300 240 440 230 S570 228 600 234 V400 H0 Z" fill="${sky[3]}"/>
  <path d="M0 258 C170 252 320 264 460 256 S580 256 600 260 V400 H0 Z" fill="${sky[4]}"/>
  <path d="M0 276 C170 272 320 280 460 274 S580 274 600 278 V400 H0 Z" fill="${sky[5]}"/>
  ${stars([[34, 30, 1.4], [92, 58, 1], [150, 22, 1.2], [214, 64, 0.9], [268, 34, 1.3], [352, 18, 1], [418, 52, 1.2], [470, 26, 0.9], [528, 60, 1.3], [572, 30, 1], [120, 92, 0.8], [560, 104, 0.9], [306, 70, 0.8]])}
  <path d="M38 176 C96 168 176 168 238 175 C178 181 98 182 38 176 Z" fill="${C.coralL}" stroke="${INK}" stroke-width="1.6"/>
  <path d="M300 214 C350 208 430 208 486 214 C432 219 352 220 300 214 Z" fill="${mix(C.coralL, C.peachL, 0.4)}" stroke="${INK}" stroke-width="1.4"/>
  <path d="M470 160 C510 155 560 156 600 160 V166 C560 168 512 167 470 160 Z" fill="${C.lilacL}" stroke="${INK}" stroke-width="1.4"/>
  <g class="ia-ring">
    <path d="${RING}" fill="none" stroke="${INK}" stroke-width="12"/>
    <path d="${RING}" fill="none" stroke="${C.paper}" stroke-width="8"/>
    <path d="M-78 301 A420 290 0 0 1 678 301" fill="none" stroke="${C.lilacL}" stroke-width="2.4"/>
    <path class="ia-glint" d="${RING}" pathLength="1000" fill="none" stroke="#ffffff" stroke-width="5"/>
    <g fill="${C.steel}" stroke="${INK}" stroke-width="1.6">
      <rect x="401" y="135" width="16" height="9" rx="2" transform="rotate(10 409 140)"/><rect x="183" y="135" width="16" height="9" rx="2" transform="rotate(-10 191 140)"/><rect x="35" y="187" width="12" height="8" rx="2" transform="rotate(-28 41 191)"/>
    </g>
    <circle cx="409" cy="140" r="2" fill="${C.glowTurq}"/><circle cx="191" cy="140" r="2" fill="${C.glowTurq}"/>
  </g>
  <circle cx="150" cy="292" r="36" fill="${C.coral}" stroke="${INK}" stroke-width="2.4"/>
  <path d="M122 278 A30 30 0 0 1 150 262" fill="none" stroke="${C.coralL}" stroke-width="4" stroke-linecap="round"/>
  <path d="M0 293 L0 275 L36 275 L44 266 L96 266 L108 278 L158 280 L170 270 L214 270 L228 285 L300 287 L318 283 L600 285 V300 H0 Z" fill="${C.rock2}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  ${hatch(206, 272, 222, 284, 5, 6, 2.0)}
  <ellipse cx="446" cy="284" rx="140" ry="17" fill="${C.glowPeach}" opacity=".35"/>
  <path d="M296 300 L316 283 L544 283 L570 300 Z" fill="${C.mesa}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  ${hatch(548, 286, 562, 297, 5, 6, 2.2)}
  <g stroke="${INK}" stroke-width="2.4" stroke-linejoin="round">
    <path d="M392 284 L397 172 L404 140 L411 172 L416 284 Z" fill="${C.turqL}"/>
    <path d="M469 284 L473 198 L485 180 L497 198 L501 284 Z" fill="${mix(C.turqL, C.ice, 0.4)}"/>
    <path d="M340 284 L343 222 L354 212 L365 222 L368 284 Z" fill="${mix(C.ice, C.turqL, 0.5)}"/>
    <path d="M524 284 L526 240 L536 232 L546 240 L548 284 Z" fill="${mix(C.ice, C.lilacL, 0.4)}"/>
  </g>
  <path d="M404 140 V120" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><circle cx="404" cy="117" r="3" fill="${C.ledRed}" stroke="${INK}" stroke-width="1.4"/>
  ${windows}
  <path d="M384 284 A62 58 0 0 1 508 284 Z" fill="${C.ice}"/>
  <g clip-path="url(#ia-dome)">
    <path d="M380 252 C420 262 470 262 512 250 V290 H380 Z" fill="${C.coralL}" opacity=".6"/>
    <path d="M380 270 C420 276 470 276 512 268 V290 H380 Z" fill="${C.coral}" opacity=".45"/>
    <path d="M446 226 C426 242 418 262 416 284 M446 226 C466 242 474 262 476 284 M446 226 V284 M392 262 C420 255 472 255 500 262 M400 244 C424 238 468 238 492 244" fill="none" stroke="${INK}" stroke-width="1.3" opacity=".55"/>
  </g>
  <path d="M384 284 A62 58 0 0 1 508 284" fill="none" stroke="${INK}" stroke-width="3"/>
  <path d="M400 258 C404 244 416 234 430 229" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>
  <path d="M330 284 A30 26 0 0 1 390 284 Z" fill="${mix(C.ice, C.turqL, 0.3)}" stroke="${INK}" stroke-width="2.4"/>
  <path d="M500 284 A28 24 0 0 1 556 284 Z" fill="${mix(C.ice, C.lilacL, 0.35)}" stroke="${INK}" stroke-width="2.4"/>
  <path d="M340 274 C344 266 352 262 360 260 M510 274 C514 267 521 263 528 262" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
  <path d="M368 270 H392 M500 272 H506" stroke="${INK}" stroke-width="2"/>
  ${mover('ia-lift', 'M446 226 C440 196 424 162 409 140', 5.5, 0, `<circle r="6" fill="${C.glowPeach}" opacity=".45"/><circle r="2.6" fill="#fffaf0"/>`, 'keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".5 0 .9 .6"')}
  <path d="M0 302 C80 290 160 292 240 302 S420 294 600 300 V400 H0 Z" fill="${mix(C.dune, C.mesa, 0.35)}" stroke="${INK}" stroke-width="2.4"/>
  <path d="M0 342 C100 318 200 318 292 344 C362 328 470 322 600 346 V400 H0 Z" fill="${C.dune}" stroke="${INK}" stroke-width="2.8"/>
  ${hatch(228, 330, 286, 342, 9, 9, 2.25)}
  ${hatch(520, 330, 590, 344, 9, 9, 2.25)}
  <path d="M0 374 C120 354 240 356 332 380 C420 366 520 362 600 376 V400 H0 Z" fill="${C.sand}" stroke="${INK}" stroke-width="2.8"/>
  ${hatch(268, 366, 326, 378, 8, 8, 2.3)}
  <g fill="${INK}" opacity=".3">${[[60, 388], [150, 382], [200, 392], [380, 392], [450, 386], [540, 392], [110, 360], [420, 350]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3"/>`).join('')}</g>
</svg>`;
}

// ── panel 2: the investor ────────────────────────────────────────────────────

export function investorArt(): string {
  const W = 'M52 362 V142 C52 72 122 36 222 36 C322 36 392 72 392 142 V362 Z';
  return `<svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <clipPath id="ib-win"><path d="${W}"/></clipPath>
    <pattern id="ib-scan" width="6" height="5" patternUnits="userSpaceOnUse"><path d="M0 0.5 H6" stroke="${C.glowTurq}" stroke-width="1" opacity=".5"/></pattern>
  </defs>
  <rect width="600" height="400" fill="#2a2343"/>
  <path d="M0 0 H600 V40 C470 30 420 30 400 40 L400 362 H0 Z" fill="#30284d"/>
  <g clip-path="url(#ib-win)">
    <rect x="40" y="30" width="370" height="340" fill="#3b3066"/>
    <path d="M40 150 C140 140 240 150 410 138 V370 H40 Z" fill="#45397a"/>
    ${stars([[80, 70, 1.2], [130, 52, 0.9], [190, 84, 1.3], [250, 56, 1], [300, 92, 0.9], [340, 64, 1.3], [370, 110, 1], [100, 120, 0.8], [160, 132, 1], [280, 128, 0.8]])}
    <path d="M30 262 A300 230 0 0 1 430 120" fill="none" stroke="${INK}" stroke-width="9"/>
    <path d="M30 262 A300 230 0 0 1 430 120" fill="none" stroke="${C.lilacL}" stroke-width="5"/>
    <path class="ia-glint" d="M30 262 A300 230 0 0 1 430 120" pathLength="1000" fill="none" stroke="#ffffff" stroke-width="3.5"/>
    <path d="M40 300 C110 282 170 284 240 298 S360 286 410 292 V370 H40 Z" fill="${C.rock4}" stroke="${INK}" stroke-width="2.2"/>
    <path d="M40 330 C120 316 200 318 280 330 S380 322 410 326 V370 H40 Z" fill="${C.lilacD}" stroke="${INK}" stroke-width="2.2"/>
    <g stroke="${INK}" stroke-width="2" fill="${mix(C.ice, C.lilac, 0.55)}">
      <path d="M96 362 A40 32 0 0 1 176 362 Z"/><path d="M186 362 A26 20 0 0 1 238 362 Z"/><path d="M300 362 A34 26 0 0 1 368 362 Z"/>
      <path d="M246 362 L249 316 L256 306 L263 316 L266 362 Z"/>
    </g>
    <g fill="${C.glowPeach}">${[[124, 350], [142, 344], [160, 352], [204, 352], [218, 356], [254, 330], [258, 346], [320, 352], [336, 346], [350, 354]].map(([x, y], i) => `<rect class="${i % 2 ? 'ia-tw' : ''}" style="--d:${i * 0.41}s" x="${x}" y="${y}" width="3.4" height="4.6" rx="1"/>`).join('')}</g>
    <path d="M90 300 L170 60 M120 340 L210 90 M300 330 L376 120" stroke="#ffffff" stroke-width="5" opacity=".07" stroke-linecap="round"/>
  </g>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${W}" stroke="${INK}" stroke-width="11"/>
    <path d="${W}" stroke="${C.steelD}" stroke-width="6"/>
    <path d="M165 40 V362 M279 40 V362 M52 206 H392" stroke="${INK}" stroke-width="7"/>
    <path d="M165 40 V362 M279 40 V362 M52 206 H392" stroke="${C.steelD}" stroke-width="3.5"/>
  </g>
  <path d="M0 362 H600 V400 H0 Z" fill="#1f1933" stroke="${INK}" stroke-width="2.4"/>
  <path d="M30 372 H380 M60 384 H340" stroke="${C.lilacD}" stroke-width="1.6" opacity=".5"/>
  <path class="ib-cone" d="M470 316 L414 266 L572 266 L500 316 Z" fill="${C.glowTurq}" opacity=".12"/>
  <g class="ib-holo" transform="translate(4 56)">
    <rect x="396" y="62" width="186" height="148" rx="10" fill="${C.glowTurq}" opacity=".13"/>
    <rect x="396" y="62" width="186" height="148" rx="10" fill="url(#ib-scan)" opacity=".5"/>
    <rect x="396" y="62" width="186" height="148" rx="10" fill="none" stroke="${C.glowTurq}" stroke-width="2.2"/>
    <g transform="translate(436 150)">${coin(0, 14, 9)}${coin(0, 4, 9)}${coin(0, -6, 9)}${coin(0, -16, 9)}</g>
    <path d="M458 132 C486 104 516 104 532 126" fill="none" stroke="${C.glowTurq}" stroke-width="2" stroke-dasharray="5 6"/>
    <path d="M527 117 L533 127 L522 129" fill="none" stroke="${C.glowTurq}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(540 152)" stroke="${C.glowTurq}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
      <path d="M-22 14 C-22 -8 22 -8 22 14 Z" fill="${C.coral}" fill-opacity=".55"/>
      <path d="M0 -4 V-18" fill="none"/><circle cx="0" cy="-21" r="3.5" fill="${C.glowTurq}"/>
      <path d="M-30 14 H30" fill="none"/>
    </g>
    <rect x="414" y="186" width="150" height="8" rx="4" fill="none" stroke="${C.glowTurq}" stroke-width="1.6"/>
    <rect class="ib-bar" x="416" y="188" width="146" height="4" rx="2" fill="${C.glowTurq}"/>
    <path d="M414 76 H500 M414 86 H470" stroke="${C.glowTurq}" stroke-width="3" stroke-linecap="round" opacity=".6"/>
    ${[0, 0.8, 1.6].map((b) => mover('ib-coin', 'M436 134 C470 92 512 92 540 140', 2.4, b, coin(0, 0, 6))).join('')}
  </g>
  <path d="M380 318 H596 L588 334 H388 Z" fill="${C.steelD}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M396 334 V362 M580 334 V362" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="485" cy="317" rx="18" ry="5" fill="${C.glowTurq}" stroke="${INK}" stroke-width="2"/>
  <path d="M392 324 H470" stroke="${C.steelL}" stroke-width="1.6" opacity=".6"/>
  <g stroke="${INK}" stroke-width="2.6" stroke-linejoin="round">
    <path d="M226 204 C212 210 206 226 204 246 L190 396 L332 396 L318 246 C316 226 308 210 294 204 C282 198 238 198 226 204 Z" fill="#17131f"/>
    <path d="M244 184 C244 196 248 204 260 206 C272 204 276 196 276 184 Z" fill="#17131f"/>
    <ellipse cx="260" cy="166" rx="21" ry="25" fill="#17131f"/>
  </g>
  <path d="M294 204 C308 210 316 226 318 246 L332 396 M276 160 C282 168 282 178 278 188" fill="none" stroke="${C.glowTurq}" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
  <path d="M232 240 C236 270 238 320 236 390" fill="none" stroke="#2c2640" stroke-width="2"/>
</svg>`;
}

// ── panel 3: CrierBelt's answer, from orbit ──────────────────────────────────

export function crierArt(): string {
  const RING_BACK = 'M-120 268 A720 78 0 0 1 1320 268';
  const RING_FRONT = 'M-120 268 A720 78 0 0 0 1320 268';
  // The exchange on the far arc: a hub, arms, docking modules, lights.
  const station = `<g transform="translate(300 197)" stroke="${INK}" stroke-linejoin="round">
    <path d="M-70 4 H70" stroke-width="7"/><path d="M-70 4 H70" stroke="${C.steelL}" stroke-width="3"/>
    <rect x="-86" y="-8" width="24" height="22" rx="4" fill="${C.teal}" stroke-width="2.2"/>
    <rect x="62" y="-8" width="24" height="22" rx="4" fill="${C.teal}" stroke-width="2.2"/>
    <rect x="-30" y="-24" width="60" height="50" rx="8" fill="${C.steel}" stroke-width="2.6"/>
    <rect x="-22" y="-16" width="44" height="10" rx="3" fill="${C.brass}" stroke-width="1.6"/>
    <circle cx="0" cy="10" r="11" fill="${C.brass}" stroke-width="2"/><circle cx="0" cy="10" r="5" fill="${C.teal}" stroke-width="1.6"/>
    <path d="M0 -24 V-44" stroke-width="2.4"/><circle cx="0" cy="-47" r="3.5" fill="${C.ledRed}" stroke-width="1.4"/>
    <circle cx="-74" cy="2" r="2.5" fill="${C.glowTurq}" stroke="none"/><circle cx="74" cy="2" r="2.5" fill="${C.glowTurq}" stroke="none"/>
  </g>`;
  return `<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><clipPath id="ic-planet"><circle cx="600" cy="1660" r="1400"/></clipPath></defs>
  <rect width="1200" height="400" fill="#2a2349"/>
  ${stars([[40, 40, 1.3], [120, 90, 1], [210, 30, 1.2], [260, 120, 0.8], [420, 50, 1.3], [480, 140, 0.9], [560, 24, 1.1], [640, 96, 0.9], [720, 40, 1.3], [800, 118, 0.8], [880, 30, 1.2], [960, 84, 1], [1040, 26, 1.3], [1120, 70, 1], [1180, 140, 0.9], [90, 170, 0.9], [700, 170, 0.8], [1000, 180, 1]])}
  <path d="${RING_BACK}" fill="none" stroke="${INK}" stroke-width="16"/>
  <path d="${RING_BACK}" fill="none" stroke="${mix(C.paper, C.lilacL, 0.35)}" stroke-width="11"/>
  <path class="ia-glint" d="${RING_BACK}" pathLength="1000" fill="none" stroke="#ffffff" stroke-width="5"/>
  ${station}
  <circle cx="600" cy="1660" r="1412" fill="${C.glowPeach}" opacity=".25"/>
  <circle cx="600" cy="1660" r="1400" fill="${C.rock1}" stroke="${INK}" stroke-width="3"/>
  <g clip-path="url(#ic-planet)">
    <path d="M0 300 C200 284 420 276 600 274 S1000 282 1200 300" fill="none" stroke="${C.mesa}" stroke-width="10" opacity=".7"/>
    <path d="M60 330 C260 312 480 306 640 306 S1000 312 1160 330" fill="none" stroke="${mix(C.sand, C.peachL, 0.5)}" stroke-width="8" opacity=".75"/>
    <path d="M140 372 C330 352 520 348 680 350 S980 358 1120 376" fill="none" stroke="${C.mesa}" stroke-width="12" opacity=".55"/>
    <path d="M420 292 C460 288 520 286 560 288 M700 296 C760 292 820 294 860 298" fill="none" stroke="${C.dune}" stroke-width="5" opacity=".9"/>
    <path d="M820 240 C960 250 1100 280 1240 330 V420 H760 C800 360 830 300 820 240 Z" fill="${C.lilacD}" opacity=".55"/>
    <path d="M940 250 C1060 262 1160 290 1240 320 V420 H900 C930 360 950 300 940 250 Z" fill="#2a2349" opacity=".45"/>
    ${hatch(860, 270, 1000, 330, 12, 14, 2.4)}
    <g fill="${C.glowPeach}"><circle class="ia-tw" style="--d:.4s" cx="1010" cy="318" r="2.4"/><circle cx="1032" cy="324" r="1.6"/><circle class="ia-tw" style="--d:1.3s" cx="1050" cy="316" r="1.8"/></g>
  </g>
  <circle cx="600" cy="1660" r="1400" fill="none" stroke="${C.peachL}" stroke-width="4" opacity=".8" clip-path="url(#ic-planet)"/>
  <path d="${RING_FRONT}" fill="none" stroke="${INK}" stroke-width="18"/>
  <path d="${RING_FRONT}" fill="none" stroke="${C.paper}" stroke-width="12"/>
  <path d="M-120 273 A720 78 0 0 0 1320 273" fill="none" stroke="${C.lilacL}" stroke-width="3"/>
  <path class="ia-glint ia-glint2" d="${RING_FRONT}" pathLength="1000" fill="none" stroke="#ffffff" stroke-width="6"/>
  <g class="ic-beam" fill="none" stroke="${C.glowTurq}" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round">
    <path d="M388 186 C470 146 530 124 610 112"/><path d="M388 198 C470 188 540 184 610 190"/><path d="M388 210 C470 232 540 256 610 276"/>
  </g>
  ${mover('ic-shuttle', 'M70 384 C140 320 214 250 286 210', 5, 0, `<circle r="5" fill="${C.glowPeach}" opacity=".5"/><circle r="2.2" fill="#fffaf0"/>`)}
  ${mover('ic-shuttle', 'M520 230 C600 260 700 300 760 380', 7, 2, `<circle r="5" fill="${C.glowPeach}" opacity=".5"/><circle r="2.2" fill="#fffaf0"/>`)}
</svg>`;
}

/** The CrierBelt mark on a canvas, `css` px across, backed at the screen's density. */
export function markCanvas(css: number): HTMLCanvasElement {
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(css * dpr);
  c.style.width = c.style.height = `${css}px`;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.scale(dpr, dpr);
    // The band overruns the ring by ~1.5 radii on the left and ~1.5 on the right: keep it inside.
    crierMark(ctx, css / 2, css / 2, css * 0.3, 5);
  }
  return c;
}
