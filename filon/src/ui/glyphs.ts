// glyphs.ts — small inked symbols the panels show instead of words (D53, owner 2026-10-13:
// "rather show than tell"): power served, no power, no wire, an empty slot; and the land's (D60):
// a parcel, its grounds (floor, rock, water, salt flats, a vent, the dune sea; a chasm and a river,
// D94), the buildings on
// it, an owner's flag (the claim's, a neighbouring base's or another claim's), CrierBelt's ringed planet, a lease's
// hourglass; the trade post's gates (D62): its entrance and exit, « in turn », a ribbon linked to
// nothing; a junction's deck coming down onto a ribbon at each end (D158). Inline SVG drawn in
// the palette through CSS classes (styles/hud.css `.glyph`), sized in em so they sit in a line of
// text; a glyph carries its meaning in `title` / `aria-label` for hover and screen readers.

export type GlyphId =
  | 'power' | 'noPower' | 'unwired' | 'empty'
  | 'parcel' | 'floor' | 'rock' | 'water' | 'salt' | 'vent' | 'dunes' | 'chasm' | 'river' | 'ore' | 'building' | 'flag' | 'flagNeighbour' | 'crier' | 'lease'
  | 'gateIn' | 'gateOut' | 'turn' | 'noLink' | 'deckEnds';

const NS = 'http://www.w3.org/2000/svg';

/** The shapes, on a 16 × 16 board: [tag, attributes] per part. */
const SHAPES: Readonly<Record<GlyphId, ReadonlyArray<readonly [string, Record<string, string>]>>> = {
  // A bolt.
  power: [['path', { class: 'g-bolt', d: 'M9.5 1.2L3.2 9.1h4.4l-1.3 5.7 6.6-8.5H8.4z' }]],
  // The bolt, dimmed, struck through.
  noPower: [
    ['path', { class: 'g-bolt g-off', d: 'M9.5 1.2L3.2 9.1h4.4l-1.3 5.7 6.6-8.5H8.4z' }],
    ['path', { class: 'g-slash', d: 'M2.2 2.2l11.6 11.6' }],
  ],
  // A plug whose cord is cut.
  unwired: [
    ['path', { class: 'g-line', d: 'M6 1.8v3M10 1.8v3' }],
    ['rect', { class: 'g-plug', x: '3.8', y: '4.6', width: '8.4', height: '5', rx: '1.4' }],
    ['path', { class: 'g-line', d: 'M8 9.6v1.6' }],
    ['path', { class: 'g-line', d: 'M8 13.4v1.4' }],
    ['path', { class: 'g-slash', d: 'M5.2 13.6l5.6-2.6' }],
  ],
  // An empty slot: a dashed box.
  empty: [['rect', { class: 'g-empty', x: '2.2', y: '2.2', width: '11.6', height: '11.6', rx: '2.6' }]],
  // ── the land (D60) ──
  // A parcel: a square of land cut in four, a boundary stone at its corner.
  parcel: [
    ['rect', { class: 'g-parcel', x: '2', y: '2.6', width: '11.4', height: '11.4', rx: '1' }],
    ['path', { class: 'g-thin', d: 'M7.7 2.6v11.4M2 8.3h11.4' }],
    ['path', { class: 'g-stone', d: 'M11.6 1.2h2.8l.4 3.2h-3.6z' }],
  ],
  // Bare floor: a flat slab with a few grains.
  floor: [
    ['path', { class: 'g-floor', d: 'M1.6 10.2L8 7l6.4 3.2L8 13.4z' }],
    ['path', { class: 'g-grain', d: 'M6 10.1h.1M9.2 9.3h.1M8.4 11.6h.1' }],
  ],
  // Rock: a terraced mesa, two steps.
  rock: [
    ['path', { class: 'g-rock', d: 'M1.4 13.8L3.6 8.6h2.2L7.6 4h4l1.6 4.6 1.4 5.2z' }],
    ['path', { class: 'g-thin', d: 'M3.6 8.6h8.9' }],
  ],
  // Water: two waves.
  water: [['path', { class: 'g-water', d: 'M1.6 6.6c1.6-1.6 3.2 1.6 4.8 0s3.2 1.6 4.8 0 2.4.6 3.2 0M1.6 10.8c1.6-1.6 3.2 1.6 4.8 0s3.2 1.6 4.8 0 2.4.6 3.2 0' }]],
  // Salt flats: a crust cracked in plates.
  salt: [
    ['path', { class: 'g-salt', d: 'M1.6 10.2L8 7l6.4 3.2L8 13.4z' }],
    ['path', { class: 'g-thin', d: 'M5 8.6l1.6 1.8-1.8 1.2M9.6 8.2l-.4 2.2 2.4.6' }],
  ],
  // A vent: a mouth in the ground and its plume.
  vent: [
    ['path', { class: 'g-vent', d: 'M2.6 13.6c1-2.4 3-3 5.4-3s4.4.6 5.4 3z' }],
    ['path', { class: 'g-steam', d: 'M6.6 9.4c-1.4-1.6 1.2-2.6-.2-4.6M9.6 9.4c-1.4-1.6 1.2-2.6-.2-4.6' }],
  ],
  // The dune sea: two crests.
  dunes: [['path', { class: 'g-dunes', d: 'M1 12.6c2.4-4.4 5-4.4 7.2 0zM6.8 12.6c2.6-5.6 5.8-5.6 8.2 0z' }]],
  // A chasm (D94): two lips of ground and the dark between them.
  chasm: [
    ['path', { class: 'g-chasm', d: 'M1.4 6.4L6 5.2 7.2 8.4 5.6 11.8 1.4 12.8zM14.6 5.4L10 4.6 9.2 8 10.8 11.4 14.6 12.2z' }],
    ['path', { class: 'g-gap', d: 'M6.2 5.4l3.6-.6-.6 3.2 1.4 3.4-4.8.4 1.6-3.4z' }],
  ],
  // A river (D94): a winding band of running water.
  river: [['path', { class: 'g-river', d: 'M2 2.4c4.6 1.2 1.2 5 5 6.2s4.4 3.4 7 5' }]],
  // Ore (D94): three nuggets in a heap.
  ore: [
    ['path', { class: 'g-ore', d: 'M2 13.6l1.4-3.4 3-.8 1.8 2.4-.6 2.4zM8.2 13.8l.8-3.6 3.2-1.2 2.4 2.6-.8 2.2zM5 9.2l1-3.8 3.4-1.4 2.2 2.8-1.4 2.8z' }],
    ['path', { class: 'g-thin', d: 'M6.4 6.4l1.4 1M10.6 10.6l1.2.8' }],
  ],
  // Buildings: a small works with a saw-tooth roof.
  building: [['path', { class: 'g-works', d: 'M2 13.8V7.4l3.6 2.2V7.4l3.6 2.2V3.6h3.6v10.2z' }]],
  // An owner's flag: the claim's (turquoise), a neighbouring base's or another claim's (coral, D110).
  flag: [['path', { class: 'g-line', d: 'M4 14.6V1.8' }], ['path', { class: 'g-flag', d: 'M4.4 2.2h8.4l-2 2.6 2 2.6H4.4z' }]],
  flagNeighbour: [['path', { class: 'g-line', d: 'M4 14.6V1.8' }], ['path', { class: 'g-flag g-neighbour', d: 'M4.4 2.2h8.4l-2 2.6 2 2.6H4.4z' }]],
  // CrierBelt: its ringed planet.
  crier: [
    ['circle', { class: 'g-planet', cx: '8', cy: '8', r: '4' }],
    ['ellipse', { class: 'g-ring', cx: '8', cy: '8', rx: '7.2', ry: '2.3', transform: 'rotate(-18 8 8)' }],
  ],
  // A lease: an hourglass.
  lease: [
    ['path', { class: 'g-line', d: 'M4 1.8h8M4 14.2h8' }],
    ['path', { class: 'g-glass', d: 'M5 2c0 3.6 6 3.8 6 6s-6 2.4-6 6h6c0-3.6-6-3.8-6-6s6-2.4 6-6z' }],
  ],
  // ── the trade post's two gates (D62): its pad, a turquoise arrow in, a coral arrow out ──
  gateIn: [
    ['rect', { class: 'g-pad', x: '2.6', y: '1.6', width: '10.8', height: '7.4', rx: '1.4' }],
    ['path', { class: 'g-in', d: 'M8 15V9.4M5.4 11.6L8 9l2.6 2.6' }],
  ],
  gateOut: [
    ['rect', { class: 'g-pad', x: '2.6', y: '7', width: '10.8', height: '7.4', rx: '1.4' }],
    ['path', { class: 'g-out', d: 'M8 7V1.4M5.4 3.6L8 1l2.6 2.6' }],
  ],
  // In turn: a circling arrow.
  turn: [['path', { class: 'g-turn', d: 'M12.9 9.2A5 5 0 1 1 11.4 4.4M11.8 1.4l-.2 3.2-3.2-.3' }]],
  // Linked to nothing: a ribbon's end, cut.
  noLink: [
    ['path', { class: 'g-ribbon', d: 'M5.4 1.6v5.2M10.6 1.6v5.2M5.4 9.4v5M10.6 9.4v5' }],
    ['path', { class: 'g-slash', d: 'M3 10.6l10-3.6' }],
  ],
  // A junction's deck (D158): its hump, coming down at each end onto a ribbon (turquoise).
  deckEnds: [
    ['path', { class: 'g-line', d: 'M3.2 12.4C5.4 12.4 5.7 5.6 8 5.6s2.6 6.8 4.8 6.8' }],
    ['path', { class: 'g-deck-end', d: 'M1 13.8h3.6M11.4 13.8h3.6' }],
  ],
};

/** A glyph, with its meaning on hover. */
export function glyph(id: GlyphId, title?: string): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of SHAPES[id]) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  const span = document.createElement('span');
  span.className = 'glyph';
  span.dataset.glyph = id;
  if (title) { span.title = title; span.setAttribute('aria-label', title); span.setAttribute('role', 'img'); }
  span.append(svg);
  return span;
}
