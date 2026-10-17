// production-panel.ts — the Production view's side panel (D88): the production buildings' states
// as one bar (at work turquoise, waiting amber, stopped coral) with their counts, then the stopped
// ones and the waiting ones by reason (a weak grid among the waits, D91) — the reason's mark and words, how many, and each building's
// icon a click away (it is selected and the camera goes to it). Read from `Readouts.production`
// (sim/readouts/production.ts: `workOf` with the renderer's grace, and why); refreshed at 4 Hz, the
// lists rebuilt when who stops, and why, changes.
import { BUILDING_IDS, buildingDef } from '@/content/registry';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { viewIconCanvas, type ViewIcon } from '@/render/art/view-icons';
import { STOP_ORDER, type ProdMark, type StopWhy } from '@/sim/readouts/production';
import type { Sim } from '@/sim/state';
import { buildingIcon } from '../build-bar';

/** The mark of a reason (the world's badge). */
const WHY_ICON: Record<StopWhy, ViewIcon> = { power: 'dark', unwired: 'unwired', inputs: 'inputs', output: 'output', recipe: 'recipe', asleep: 'asleep', site: 'site', idle: 'idle', weak: 'low' };
/** Buildings shown per reason before « +n ». */
const PER_REASON = 8;

export interface ProductionPanelHost {
  focus(id: number): void;
}

export class ProductionPanel {
  readonly root: HTMLElement;
  private readonly segs: Record<'on' | 'pause' | 'off', HTMLElement>;
  private readonly counts: Record<'on' | 'pause' | 'off', { node: HTMLElement; n: HTMLElement }>;
  private readonly list = el('div.vp-why-list');
  private readonly all = el('p.insp-note.vp-none');
  private sig = '';

  constructor(private readonly atlas: Atlas, private readonly host: ProductionPanelHost) {
    const seg = (k: string): HTMLElement => el('span.vp-seg', { 'data-work': k });
    this.segs = { on: seg('on'), pause: seg('pause'), off: seg('off') };
    const count = (k: string): { node: HTMLElement; n: HTMLElement } => {
      const n = el('b');
      return { node: el('span.vp-flag', { 'data-work': k }, [el('i.vp-swatch', { 'data-work': k }), n]), n };
    };
    this.counts = { on: count('on'), pause: count('pause'), off: count('off') };
    this.root = el('div.vp-production', {}, [
      el('div.vp-supply', {}, [el('div.vp-segs', {}, [this.segs.on, this.segs.pause, this.segs.off])]),
      el('div.vp-flags', {}, [this.counts.on.node, this.counts.pause.node, this.counts.off.node]),
      this.list,
      this.all,
    ]);
  }

  refresh(sim: Sim, marks: readonly ProdMark[]): void {
    const n = { on: 0, pause: 0, off: 0 };
    for (const m of marks) n[m.work]++;
    const total = Math.max(1, marks.length);
    for (const k of ['on', 'pause', 'off'] as const) {
      setStyle(this.segs[k], 'width', `${((n[k] * 100) / total).toFixed(1)}%`);
      setText(this.counts[k].n, String(n[k]));
      setAttr(this.counts[k].node, 'title', t(`mapview.work.${k}` as MsgKey));
      setAttr(this.segs[k], 'title', `${t(`mapview.work.${k}` as MsgKey)} · ${n[k]}`);
    }
    setText(this.all, t('mapview.allWork'));
    setAttr(this.all, 'hidden', n.off + n.pause ? '' : null);
    // Who does not work, by reason: the stops first (the reasons' order), then the waits.
    const groups = new Map<string, number[]>();
    for (const m of marks) {
      if (m.work === 'on' || !m.why) continue;
      const k = `${m.work}:${m.why}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(m.ent);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      const [wa, ra] = a.split(':') as [string, StopWhy], [wb, rb] = b.split(':') as [string, StopWhy];
      return (wa === 'off' ? 0 : 1) - (wb === 'off' ? 0 : 1) || STOP_ORDER.indexOf(ra) - STOP_ORDER.indexOf(rb);
    });
    const sig = `${keys.map((k) => `${k}=${groups.get(k)!.join('.')}`).join('|')}:${locale()}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const L = locale();
    this.list.replaceChildren(...keys.map((k) => {
      const [work, why] = k.split(':') as ['pause' | 'off', StopWhy];
      const ids = groups.get(k)!;
      const shown = ids.slice(0, PER_REASON);
      return el('section.vp-why', { 'data-work': work, 'data-why': why }, [
        el('header.vp-why-head', {}, [viewIconCanvas(WHY_ICON[why], 22), el('span', {}, t(`mapview.why.${why}` as MsgKey)), el('b', {}, String(ids.length))]),
        el('div.vp-why-ents', {}, [
          ...shown.map((id) => {
            const e = sim.ents.get(id);
            const def = e ? BUILDING_IDS[e.def]! : '';
            return el('button.vp-ent', { type: 'button', 'data-ent': String(id), title: e ? buildingDef(e.def).name[L] : '', onclick: () => this.host.focus(id) }, [e ? buildingIcon(this.atlas, def, 26) : null]);
          }),
          ids.length > shown.length ? el('small.vp-ent-more', {}, tr('hud.more', { n: ids.length - shown.length })) : null,
        ]),
      ]);
    }));
  }
}
