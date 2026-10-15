// settings.ts (screen) — the player's preferences, a page of the main menu, in three kit sections
// (D89: « Plus clair, plus séparé »):
// · « Affichage » (a screen): the language (switches live), the UI scale (zooms the whole
//   interface), the performance mode (next launch: a small tag says so, the rest in its tooltip);
// · « Son » (a speaker): the three volumes (general, music, effects and ambience: live while the
//   slider moves, stored when it is released, and the effects slider plays a cue at its new level),
//   each with a speaker whose waves follow its level; how the sound works is the header's tooltip;
// · « Sauvegarde » (a crate, M7): the base itself, through the shell — when it was last saved, export
//   to a `.ocelle` file, import one, start over (each asks first, in the shell).
// Preferences, not the colony: they live in the shell's `src/settings.ts` (localStorage), which the
// UI may not import, so the page reads and writes them through its host, and the shell applies each
// change (D27, D30). Where the browser has no Web Audio, the sliders grey out and a note says so.
import { LOCALES, type Locale } from '@/core/kinds';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { duration, pct } from '@/i18n/format';
import { mark, section } from '../inspector/kit';

/** The three volume sliders. */
export type VolumeId = 'master' | 'music' | 'sfx';

/** What the page shows of the stored preferences (the shell's `Settings` satisfies it). */
export interface SettingsValues {
  readonly uiScale: number;
  readonly perf: boolean;
  readonly volMaster: number;
  readonly volMusic: number;
  readonly volSfx: number;
}

export interface SettingsHost {
  values(): SettingsValues;
  /** Switch the language now (and remember it). */
  setLocale(l: Locale): void;
  /** Zoom the interface (1 = as designed) and remember it. */
  setUiScale(scale: number): void;
  /** Lighter rendering (no antialiasing, 1× resolution) from the next launch. */
  setPerf(on: boolean): void;
  /** A volume slider moved (0–1): heard at once; `done` when it is released (remember it). */
  setVolume(which: VolumeId, value: number, done: boolean): void;
  /** Can this browser play sound at all? */
  soundAvailable(): boolean;
  /** Leave the page (back to the menu). */
  close(): void;
  /** The base's saves (M7); absent: the row is not shown. */
  save?: SaveHost;
}

export interface SaveHost {
  /** Does this page keep the base at all (false: ?demo, storage refused)? */
  kept(): boolean;
  /** Wall-clock ms of the last save, or null. */
  lastSaved(): number | null;
  /** Write the export file (a download). */
  exportFile(): void;
  /** An export file was picked: ask, then replace the base. */
  importFile(file: File): void;
  /** Ask, then give the base back and start over. */
  wipe(): void;
}

/** The UI scales offered; 1 is the size the interface is drawn for. */
export const UI_SCALES: readonly number[] = [0.85, 1, 1.15, 1.3];

/** A language's name in itself, so a player who cannot read the current one still finds theirs. */
const ENDONYM: Record<Locale, MsgKey> = { fr: 'settings.lang.fr', en: 'settings.lang.en' };

const VOLUMES: ReadonlyArray<{ id: VolumeId; label: MsgKey; of: (v: SettingsValues) => number }> = [
  { id: 'master', label: 'settings.master', of: (v) => v.volMaster },
  { id: 'music', label: 'settings.music', of: (v) => v.volMusic },
  { id: 'sfx', label: 'settings.sfx', of: (v) => v.volSfx },
];

// ── the page's own inked marks (the kit's palette classes: styles/kit.css) ──

const NS = 'http://www.w3.org/2000/svg';
type Shape = readonly [string, Record<string, string>];

/** A small inked mark on a 16 × 16 board, drawn with the kit's `k-*` classes. */
function ink(id: string, shapes: readonly Shape[]): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  return el('span.kmark', { 'data-mark': id }, [svg]);
}

/** A screen on its stand: the display. */
const screenMark = (): HTMLElement => ink('screen', [
  ['rect', { class: 'k-sheet', x: '1.4', y: '2.2', width: '13.2', height: '9', rx: '1.2' }],
  ['rect', { class: 'k-node', x: '3.2', y: '4', width: '9.6', height: '5.4', rx: '0.6' }],
  ['path', { class: 'k-stroke', d: 'M8 11.2v2.6M5 14h6' }],
]);

/** A speaker and three waves; `data-level` (0–3) lights as many waves (styles/menu.css). */
const speakerMark = (): HTMLElement => ink('speaker', [
  ['path', { class: 'k-box', d: 'M1.8 6h2.8L8.2 3v10L4.6 10H1.8z' }],
  ['path', { class: 'k-stroke set-w1', d: 'M10.2 6.3a2.4 2.4 0 0 1 0 3.4' }],
  ['path', { class: 'k-stroke set-w2', d: 'M11.9 4.6a4.8 4.8 0 0 1 0 6.8' }],
  ['path', { class: 'k-stroke set-w3', d: 'M13.6 2.9a7.2 7.2 0 0 1 0 10.2' }],
]);

type Seg<V> = Array<{ value: V; node: HTMLButtonElement }>;
interface Gauge { id: VolumeId; label: MsgKey; of: (v: SettingsValues) => number; row: HTMLElement; input: HTMLInputElement; out: HTMLElement; spk: HTMLElement }

export class SettingsScreen {
  readonly root: HTMLElement;
  /** Labels built once and re-set on refresh, so they follow a language switch. */
  private readonly labels: Array<[HTMLElement, MsgKey]> = [];
  /** Tooltips re-set on refresh. */
  private readonly tips: Array<[HTMLElement, MsgKey]> = [];
  private readonly langs: Seg<Locale>;
  private readonly scales: Seg<number>;
  private readonly perfs: Seg<boolean>;
  private readonly gauges: Gauge[];
  /** The sound section's header: how the sound works, on hover. */
  private readonly soundHead: HTMLElement;
  /** Under the volumes when this browser has no sound (hidden otherwise). */
  private readonly soundNote = el('p.set-note', { 'data-sound-note': '' });
  /** The save section's « dernière sauvegarde » line and its buttons. */
  private readonly saveNote = el('span', { 'data-save-note': '' });
  private readonly saveButtons: HTMLButtonElement[] = [];

  constructor(private readonly host: SettingsHost) {
    const seg = <V>(attr: string, values: readonly V[], pick: (v: V) => void): Seg<V> =>
      values.map((value) => ({
        value,
        node: el<'button'>('button.set-opt', { type: 'button', [attr]: String(value), 'aria-pressed': 'false', onclick: () => { pick(value); this.refresh(); } }),
      }));
    this.langs = seg('data-lang', LOCALES, (l) => host.setLocale(l));
    this.scales = seg('data-scale', UI_SCALES, (s) => host.setUiScale(s));
    this.perfs = seg('data-perf', [false, true], (on) => host.setPerf(on));
    const v = host.values();
    const row = (label: MsgKey, control: HTMLElement, tip?: MsgKey): HTMLElement => {
      const r = el('div.set-row', {}, [this.label(el('span.set-label.lettering'), label), control]);
      if (tip) this.tips.push([r, tip]);
      return r;
    };
    const group = (attrs: Record<string, unknown>, kids: HTMLElement[]): HTMLElement => el('div.set-seg', { role: 'group', ...attrs }, kids);
    this.gauges = VOLUMES.map(({ id, label, of }) => {
      const input = el<'input'>('input.set-range', {
        type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(of(v) * 100)), 'data-vol': id,
        oninput: () => { host.setVolume(id, Number(input.value) / 100, false); this.refresh(); },
        onchange: () => { host.setVolume(id, Number(input.value) / 100, true); this.refresh(); },
      });
      const out = el('span.set-val', { 'data-vol-value': id });
      const spk = speakerMark();
      return { id, label, of, input, out, spk, row: row(label, el('div.set-gauge', {}, [spk, input, out])) };
    });

    const display = this.sec('display', screenMark(), 'settings.display', [
      row('settings.language', group({}, this.langs.map((o) => o.node))),
      row('settings.scale', group({}, this.scales.map((o) => o.node))),
      row('settings.perf', el('div.set-ctl', {}, [
        group({}, this.perfs.map((o) => o.node)),
        el('span.set-tag', {}, [mark('order'), this.label(el('span'), 'settings.perf.next')]),
      ]), 'settings.perf.note'),
    ]);
    const sound = this.sec('sound', speakerMark(), 'settings.sound', [...this.gauges.map((g) => g.row), this.soundNote]);
    this.soundHead = sound.querySelector<HTMLElement>('.ksec-head')!;
    this.root = el('section.settings', { 'data-screen': 'settings' }, [
      this.label(el('h2.lettering'), 'screen.settings'),
      display,
      sound,
      host.save ? this.saveSection(host.save) : null,
      el('div.set-foot', {}, [
        this.label(el('p.set-note'), 'settings.stored'),
        this.label(el<'button'>('button.btn.set-back', { type: 'button', onclick: () => host.close() }), 'menu.back'),
      ]),
    ]);
    this.refresh();
  }

  /** A kit section of the page; its title follows the language. */
  private sec(id: string, icon: HTMLElement, title: MsgKey, body: HTMLElement[]): HTMLElement {
    const s = section({ sec: `set-${id}`, title: t(title), icon }, body);
    this.label(s.querySelector<HTMLElement>('.ksec-title')!, title);
    return s;
  }

  private saveSection(save: SaveHost): HTMLElement {
    const pick = el<'input'>('input', {
      type: 'file', accept: '.ocelle,application/json,text/plain', hidden: '', 'data-save-file': '',
      onchange: () => { const f = pick.files?.[0]; pick.value = ''; if (f) save.importFile(f); },
    });
    const button = (key: MsgKey, act: string, run: () => void, danger = false): HTMLButtonElement => {
      const b = this.label(el<'button'>(`button.set-opt${danger ? '.set-danger' : ''}`, { type: 'button', 'data-save-act': act, onclick: run }), key);
      this.saveButtons.push(b);
      return b;
    };
    const s = this.sec('save', mark('store'), 'settings.save', [
      el('p.set-when', {}, [mark('order'), this.saveNote]),
      el('div.set-seg.set-save', { role: 'group' }, [
        button('settings.save.export', 'export', () => save.exportFile()),
        button('settings.save.import', 'import', () => pick.click()),
        button('settings.save.wipe', 'wipe', () => save.wipe(), true),
        pick,
      ]),
    ]);
    this.tips.push([s.querySelector<HTMLElement>('.ksec-head')!, 'settings.save.note']);
    return s;
  }

  private label<E extends HTMLElement>(node: E, key: MsgKey): E {
    this.labels.push([node, key]);
    return node;
  }

  /** Change-only writes: labels (language), the chosen option of each row, the volumes. */
  refresh(): void {
    const v = this.host.values();
    for (const [node, key] of this.labels) setText(node, t(key));
    for (const [node, key] of this.tips) setAttr(node, 'title', t(key));
    const markSeg = <V>(opts: Seg<V>, on: (x: V) => boolean, text: (x: V) => string): void => {
      for (const o of opts) {
        setText(o.node, text(o.value));
        setAttr(o.node, 'data-on', on(o.value) ? '' : null);
        setAttr(o.node, 'aria-pressed', on(o.value) ? 'true' : 'false');
      }
    };
    markSeg(this.langs, (l) => l === locale(), (l) => t(ENDONYM[l]));
    markSeg(this.scales, (s) => Math.abs(s - v.uiScale) < 0.001, (s) => pct(s));
    markSeg(this.perfs, (on) => on === v.perf, (on) => t(on ? 'settings.on' : 'settings.off'));
    const sound = this.host.soundAvailable();
    for (const g of this.gauges) {
      const val = g.of(v);
      // Never fight the hand: a slider being dragged (focused) keeps its own position.
      if (document.activeElement !== g.input && Math.abs(Number(g.input.value) - val * 100) >= 0.5) g.input.value = String(Math.round(val * 100));
      setText(g.out, pct(val));
      setAttr(g.spk, 'data-level', String(val <= 0.001 ? 0 : val < 0.34 ? 1 : val < 0.67 ? 2 : 3));
      setAttr(g.input, 'aria-label', t(g.label));
      setAttr(g.input, 'aria-valuetext', pct(val));
      setAttr(g.input, 'disabled', sound ? null : '');
      setAttr(g.row, 'data-off', sound ? null : '');
    }
    setAttr(this.soundHead, 'title', t('settings.sound.note'));
    setText(this.soundNote, sound ? '' : t('settings.sound.off'));
    setAttr(this.soundNote, 'hidden', sound ? '' : null);
    const save = this.host.save;
    if (save) {
      const kept = save.kept(), at = save.lastSaved();
      const when = at === null ? t('settings.save.never') : t('settings.save.last', { d: duration(Math.max(0, Date.now() - at) / 1000) });
      setText(this.saveNote, kept ? when : t('settings.save.off'));
      for (const b of this.saveButtons) setAttr(b, 'disabled', kept ? null : '');
    }
  }
}
