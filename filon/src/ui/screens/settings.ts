// settings.ts (screen) — the player's preferences, a page of the main menu: the language (switches
// live), the UI scale (zooms the whole interface), the performance mode (next launch) and the
// three volumes (general, music, effects and ambience: live while the slider moves, stored when it
// is released, and the effects slider plays a cue at its new level). Preferences, not the colony:
// they live in the shell's `src/settings.ts` (localStorage), which the UI may not import, so the
// page reads and writes them through its host, and the shell applies each change (D27, D30).
// Where the browser has no Web Audio, the sliders grey out and a note says so. The « Sauvegarde »
// row (M7) is the base itself, through the shell: when it was last saved, export to a `.ocelle`
// file, import one, start over (each asks first, in the shell).
import { LOCALES, type Locale } from '@/core/kinds';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { duration, pct } from '@/i18n/format';

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

type Seg<V> = Array<{ value: V; node: HTMLButtonElement }>;
interface Gauge { id: VolumeId; label: MsgKey; of: (v: SettingsValues) => number; row: HTMLElement; input: HTMLInputElement; out: HTMLElement }

export class SettingsScreen {
  readonly root: HTMLElement;
  /** Labels built once and re-set on refresh, so they follow a language switch. */
  private readonly labels: Array<[HTMLElement, MsgKey]> = [];
  private readonly langs: Seg<Locale>;
  private readonly scales: Seg<number>;
  private readonly perfs: Seg<boolean>;
  private readonly gauges: Gauge[];
  /** Under the volumes: how the sound works, or that there is none in this browser. */
  private readonly soundNote = el('p.set-note', { 'data-sound-note': '' });
  /** The save row's « dernière sauvegarde » line and its buttons. */
  private readonly saveNote = el('p.set-note', { 'data-save-note': '' });
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
    const row = (label: MsgKey, control: HTMLElement, note?: HTMLElement | MsgKey): HTMLElement =>
      el('div.set-row', {}, [
        this.label(el('span.set-label.lettering'), label),
        control,
        typeof note === 'string' ? this.label(el('p.set-note'), note) : note ?? null,
      ]);
    this.gauges = VOLUMES.map(({ id, label, of }) => {
      const input = el<'input'>('input.set-range', {
        type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(of(v) * 100)), 'data-vol': id,
        oninput: () => { host.setVolume(id, Number(input.value) / 100, false); this.refresh(); },
        onchange: () => { host.setVolume(id, Number(input.value) / 100, true); this.refresh(); },
      });
      const out = el('span.set-note', { 'data-vol-value': id });
      return { id, label, of, input, out, row: row(label, el('div.set-gauge', {}, [input, out]), id === 'sfx' ? this.soundNote : undefined) };
    });
    this.root = el('section.settings', { 'data-screen': 'settings' }, [
      this.label(el('h2.lettering'), 'screen.settings'),
      row('settings.language', el('div.set-seg', { role: 'group' }, this.langs.map((o) => o.node))),
      row('settings.scale', el('div.set-seg', { role: 'group' }, this.scales.map((o) => o.node))),
      row('settings.perf', el('div.set-seg', { role: 'group' }, this.perfs.map((o) => o.node)), 'settings.perf.note'),
      ...this.gauges.map((g) => g.row),
      host.save ? this.saveRow(host.save, row) : null,
      el('div.set-foot', {}, [
        this.label(el('p.set-note'), 'settings.stored'),
        this.label(el<'button'>('button.btn.set-back', { type: 'button', onclick: () => host.close() }), 'menu.back'),
      ]),
    ]);
    this.refresh();
  }

  private saveRow(save: SaveHost, row: (label: MsgKey, control: HTMLElement, note?: HTMLElement | MsgKey) => HTMLElement): HTMLElement {
    const pick = el<'input'>('input', {
      type: 'file', accept: '.ocelle,application/json,text/plain', hidden: '', 'data-save-file': '',
      onchange: () => { const f = pick.files?.[0]; pick.value = ''; if (f) save.importFile(f); },
    });
    const button = (key: MsgKey, act: string, run: () => void, danger = false): HTMLButtonElement => {
      const b = this.label(el<'button'>(`button.set-opt${danger ? '.set-danger' : ''}`, { type: 'button', 'data-save-act': act, onclick: run }), key);
      this.saveButtons.push(b);
      return b;
    };
    const controls = el('div.set-seg.set-save', { role: 'group' }, [
      button('settings.save.export', 'export', () => save.exportFile()),
      button('settings.save.import', 'import', () => pick.click()),
      button('settings.save.wipe', 'wipe', () => save.wipe(), true),
      pick,
    ]);
    return row('settings.save', controls, this.saveNote);
  }

  private label<E extends HTMLElement>(node: E, key: MsgKey): E {
    this.labels.push([node, key]);
    return node;
  }

  /** Change-only writes: labels (language), the chosen option of each row, the volumes. */
  refresh(): void {
    const v = this.host.values();
    for (const [node, key] of this.labels) setText(node, t(key));
    const mark = <V>(opts: Seg<V>, on: (x: V) => boolean, text: (x: V) => string): void => {
      for (const o of opts) {
        setText(o.node, text(o.value));
        setAttr(o.node, 'data-on', on(o.value) ? '' : null);
        setAttr(o.node, 'aria-pressed', on(o.value) ? 'true' : 'false');
      }
    };
    mark(this.langs, (l) => l === locale(), (l) => t(ENDONYM[l]));
    mark(this.scales, (s) => Math.abs(s - v.uiScale) < 0.001, (s) => pct(s));
    mark(this.perfs, (on) => on === v.perf, (on) => t(on ? 'settings.on' : 'settings.off'));
    const sound = this.host.soundAvailable();
    for (const g of this.gauges) {
      const val = g.of(v);
      // Never fight the hand: a slider being dragged (focused) keeps its own position.
      if (document.activeElement !== g.input && Math.abs(Number(g.input.value) - val * 100) >= 0.5) g.input.value = String(Math.round(val * 100));
      setText(g.out, pct(val));
      setAttr(g.input, 'aria-label', t(g.label));
      setAttr(g.input, 'aria-valuetext', pct(val));
      setAttr(g.input, 'disabled', sound ? null : '');
      setAttr(g.row, 'data-off', sound ? null : '');
    }
    setText(this.soundNote, t(sound ? 'settings.sound.note' : 'settings.sound.off'));
    const save = this.host.save;
    if (save) {
      const kept = save.kept(), at = save.lastSaved();
      const when = at === null ? t('settings.save.never') : t('settings.save.last', { d: duration(Math.max(0, Date.now() - at) / 1000) });
      setText(this.saveNote, kept ? `${when} · ${t('settings.save.note')}` : t('settings.save.off'));
      for (const b of this.saveButtons) setAttr(b, 'disabled', kept ? null : '');
    }
  }
}
