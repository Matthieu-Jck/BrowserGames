// land-tool.ts — the land mode (D60, docs/land.md: « Terrain », I or the HUD's button): look at
// the claim's land cut in parcels and pick one to buy or lease. Like the Link tool it is not a
// `Tools` state — nothing is placed, a left drag still pans, and it works in both views (the
// shell turns it to the plan view, where parcels are squares). The shell resolves the parcel
// under the cursor each frame (`hover`) and hands a click's parcel to `click`; the land panel
// (ui/land-panel.ts) shows the selected one and does the buying through the Sim's commands.
// Esc or a right click unwinds: the selected parcel first, then the mode.

export class LandTool {
  /** The mode is on. */
  active = false;
  /** The parcel under the cursor (−1: none, or the pointer is over the UI). */
  hover = -1;
  /** The parcel picked by a click: the land panel shows it (−1: none). */
  selected = -1;

  /** Turn the mode on, optionally on a parcel. */
  start(p = -1): void {
    this.active = true;
    this.selected = p;
  }

  /** Turn the mode off. */
  stop(): void {
    this.active = false;
    this.hover = -1;
    this.selected = -1;
  }

  /** Esc / right click: let the selected parcel go first, then the mode. True if something went. */
  cancel(): boolean {
    if (!this.active) return false;
    if (this.selected >= 0) { this.selected = -1; return true; }
    this.stop();
    return true;
  }

  /** A left click on a parcel (−1: off the world): it becomes the selected one. Returns whether the selection changed. */
  click(p: number): boolean {
    if (!this.active || p < 0 || p === this.selected) return false;
    this.selected = p;
    return true;
  }
}
