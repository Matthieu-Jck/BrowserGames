// artboard.ts — the art review board (dev): every building in each rotation, rock relief by
// hardness, ribbons, item glyphs, status icons and painted terrain samples laid in iso, on
// paper — the page used to sign off the art direction before producing the rest. A face ore's
// vein (D87: quartz in the cliff) has its own two cards, iso and plan, drawn on a little field of
// its own (no vein need exist in the world to review it).
import { BUILDING_IDS, ITEM_IDS, buildingDef, isBeltDef } from '@/content/registry';
import { el } from '@/core/dom';
import { locale } from '@/i18n/i18n';
import { bKey, beltKey, frameCanvas, iKey, iconKey, type Atlas } from '@/render/art/atlas';
import { BELT_TIERS } from '@/render/art/recipes/belts';
import { ICON_IDS } from '@/render/art/recipes/icons';
import { buildWindow, paintChunk } from '@/render/art/terrain';
import { columnShadow, drawColumn, type Proj } from '@/render/art/rock';
import { C } from '@/render/art/tokens';
import { IS, IH, ILH } from '@/render/art/iso-shapes';
import { masksAt, maskAt } from '@/render/relief';
import { ITEMS } from '@/content/items';
import { T } from '@/sim/types';
import type { Grid } from '@/sim/world/grid';
import { CHUNK, CHUNKS } from '@/sim/constants';
import { TW, TH } from '@/render/iso';

/** A painted chunk laid flat in iso (relief included), at `s` canvas px per world px. */
function terrainSample(grid: Grid, cx: number, cy: number, ppt: number, s: number): HTMLCanvasElement {
  const d = buildWindow((x, y) => grid.chunkAt(x, y), cx, cy, CHUNKS * CHUNK);
  const tex = document.createElement('canvas');
  tex.width = tex.height = 32 * ppt;
  paintChunk(tex.getContext('2d')!, d, ppt, (w, h) => new OffscreenCanvas(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(CHUNK * TW * s);
  cv.height = Math.round(CHUNK * TH * s);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform((TW / 2 / ppt) * s, (TH / 2 / ppt) * s, (-TW / 2 / ppt) * s, (TH / 2 / ppt) * s, (CHUNK * TW * s) / 2, 0);
  ctx.drawImage(tex, 0, 0);
  return cv;
}

/** The relief samples' massif (relief levels per tile). */
const MASSIF = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 2, 2, 4, 2, 0, 0],
  [0, 2, 4, 6, 4, 2, 0],
  [0, 4, 6, 8, 6, 4, 0],
  [0, 2, 6, 8, 8, 4, 2],
  [0, 0, 2, 4, 4, 2, 0],
  [0, 0, 0, 2, 2, 0, 0],
];
/** The vein's field (D87): two terraces whose cliff tiles (any with a lower side) hold quartz. */
const VEIN_FIELD = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 4, 4, 4, 2, 0, 0],
  [0, 4, 4, 2, 2, 2, 0],
  [0, 2, 2, 2, 2, 2, 0],
  [0, 2, 2, 2, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
];
/** Does tile (x, y) of a field stand above one of its neighbours (a face)? */
function onFace(G: readonly number[][], x: number, y: number): boolean {
  const l = G[y]?.[x] ?? 0;
  return l > 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (G[y + dy!]?.[x + dx!] ?? 0) < l);
}

/** A little stepped massif of one hardness, inked column by column, far to near; `vein`: its faces hold quartz (D87). */
function reliefSample(cls: number, G: readonly number[][] = MASSIF, vein = false): HTMLCanvasElement {
  const n = G.length, k = 0.5;
  const lv = (x: number, y: number): number => G[y]?.[x] ?? 0;
  const cv = document.createElement('canvas');
  cv.width = Math.round(n * IS * 2 * k + 20);
  cv.height = Math.round(n * IH * 2 * k + 8 * ILH * k + 30);
  const ctx = cv.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ox = cv.width / 2, oy = 8 * ILH * k + 14;
  const at = (x: number, y: number): Proj => (u, v, z) => [ox + (x + u - y - v) * IS * k, oy + (x + u + y + v) * IH * k - z * ILH * k];
  // Ground diamond and shadows.
  ctx.fillStyle = C.sand;
  ctx.beginPath();
  ctx.moveTo(...at(0, 0)(0, 0, 0)); ctx.lineTo(...at(n - 1, 0)(1, 0, 0)); ctx.lineTo(...at(n - 1, n - 1)(1, 1, 0)); ctx.lineTo(...at(0, n - 1)(0, 1, 0));
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = C.inkSoft;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (lv(x, y)) columnShadow(ctx, at(x, y), lv(x, y), maskAt(lv, x, y));
  ctx.restore();
  for (let d = 0; d < 2 * n; d++) {
    for (let y = 0; y < n; y++) {
      const x = d - y;
      if (x < 0 || x >= n || !lv(x, y)) continue;
      drawColumn(ctx, at(x, y), cls, masksAt(lv, x, y), { detail: 2, seed: x * 31 + y * 7 + cls, k: k * 1.4, vein: vein && onFace(G, x, y) });
    }
  }
  return cv;
}

/** The vein's field as the plan paints it (D87): a painted chunk of its own, the field at its corner, cropped and shown flat. */
function veinPlanSample(ppt: number): HTMLCanvasElement {
  const G = VEIN_FIELD, quartz = ITEM_IDS.indexOf('quartz' as (typeof ITEM_IDS)[number]);
  const N = CHUNK * CHUNK, o0 = 12;
  const chunk = { terrain: new Uint8Array(N).fill(T.Sand), ore: new Uint8Array(N), rich: new Uint16Array(N), height: new Uint8Array(N), biome: new Uint8Array(N), level: new Uint8Array(N) };
  const none = { ...chunk, terrain: new Uint8Array(N).fill(T.Sand) };
  for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y]!.length; x++) {
    const l = G[y]![x]!, k = (y + o0) * CHUNK + x + o0;
    if (!l) continue;
    chunk.terrain[k] = T.Rock2;
    chunk.level[k] = l / 2;
    if (quartz >= 0 && onFace(G, x, y)) { chunk.ore[k] = quartz + 1; chunk.rich[k] = 400; }
  }
  const d = buildWindow((cx, cy) => (cx === 0 && cy === 0 ? chunk : none), 0, 0, CHUNKS * CHUNK);
  const tex = document.createElement('canvas');
  tex.width = tex.height = 32 * ppt;
  paintChunk(tex.getContext('2d')!, d, ppt, (w, h) => new OffscreenCanvas(w, h));
  const span = 9, cv = document.createElement('canvas');
  cv.width = cv.height = span * 28;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tex, (o0 - 1) * ppt, (o0 - 1) * ppt, span * ppt, span * ppt, 0, 0, cv.width, cv.height);
  return cv;
}

export function buildArtboard(atlas: Atlas, grid: Grid, close: () => void): HTMLElement {
  const L = locale();
  const fr = L === 'fr';
  const card = (label: string, canvas: HTMLCanvasElement | null, sub = ''): HTMLElement =>
    el('figure.art-card', {}, [canvas ?? el('div', {}, '—'), el('figcaption', {}, [label, sub ? el('small', {}, sub) : null])]);

  const buildings = BUILDING_IDS.filter((id) => !isBeltDef(id)).map((id) => {
    const b = buildingDef(BUILDING_IDS.indexOf(id));
    const main = frameCanvas(atlas, bKey(id, 0), 0.6);
    // Its other rotations, small; for the Heart, its looks at levels 2–4 instead (D86).
    const rots = [1, 2, 3].map((r) => frameCanvas(atlas, bKey(id, r as 0 | 1 | 2 | 3), 0.24))
      .concat([2, 3, 4].map((lv) => frameCanvas(atlas, bKey(id, 0, lv), 0.24)))
      .filter((c): c is HTMLCanvasElement => !!c);
    const fig = card(b.name[L], main, `${b.w}×${b.h}`);
    if (rots.length) fig.append(el('div.art-rots', {}, rots));
    return fig;
  });
  const rockNames = fr ? ['Grès tendre (H1)', 'Basalte (H2)', 'Obsidienne lilas (H3)', 'Cœur-de-roche (H4)'] : ['Soft sandstone (H1)', 'Basalt (H2)', 'Lilac obsidian (H3)', 'Heartrock (H4)'];
  const relief = rockNames.map((n, i) => card(n, reliefSample(i)));
  relief.push(card(fr ? 'Veine de quartz (iso)' : 'Quartz vein (iso)', reliefSample(1, VEIN_FIELD, true)), card(fr ? 'Veine de quartz (plan)' : 'Quartz vein (plan)', veinPlanSample(64)));
  const belts = Object.keys(BELT_TIERS).flatMap((t) => [card(`${t}`, frameCanvas(atlas, beltKey(t, false), 1)), card(`${t} ↱`, frameCanvas(atlas, beltKey(t, true), 1))]);
  const items = ITEM_IDS.map((id) => card((ITEMS as Record<string, { name: { fr: string; en: string } }>)[id]!.name[L], frameCanvas(atlas, iKey(id), 2)));
  const icons = ICON_IDS.map((id) => card(id, frameCanvas(atlas, iconKey(id), 1.5)));
  // Terrain: the cirque centre, the Crown, a pass and the near belt.
  const samples: Array<[string, number, number]> = [['Cirque', 15, 15], ['Couronne', 14, 15], ['Couronne (est)', 17, 16], ['Proche couronne', 12, 12], ['Lointains', 6, 20]];
  const terrains = samples.map(([n, cx, cy]) => card(n, terrainSample(grid, cx, cy, 32, 0.25)));

  const root = el('section.artboard', { 'data-screen': 'artboard', 'data-open': '' }, [
    el('header.art-head', {}, [
      el('h1.lettering', {}, fr ? 'OCELLE — planche d’art' : 'OCELLE — art board'),
      el('button.btn', { onclick: close }, '✕'),
    ]),
    el('h2.lettering', {}, fr ? 'Bâtiments' : 'Buildings'), el('div.art-grid', {}, buildings),
    el('h2.lettering', {}, fr ? 'Relief' : 'Relief'), el('div.art-grid', {}, relief),
    el('h2.lettering', {}, 'Terrain'), el('div.art-grid.terrain', {}, terrains),
    el('h2.lettering', {}, fr ? 'Rubans' : 'Ribbons'), el('div.art-grid', {}, belts),
    el('h2.lettering', {}, fr ? 'Objets' : 'Items'), el('div.art-grid.small', {}, items),
    el('h2.lettering', {}, fr ? 'Statuts' : 'Status'), el('div.art-grid.small', {}, icons),
  ]);
  return root;
}
