// scanner.ts — info as a stat. Every destination has FIVE intel slots; each
// scanner level unlocks one more (locked slots read "???"). Higher scanner
// levels also reveal additional destination candidates entirely.
import type { PlanetSpec } from './planet-gen';
import { PLANET_TYPES } from './planet-gen';
import type { NodeKind } from './surface-gen';

export interface IntelRow {
  label: string;
  value: string | null;         // null = locked, render as ???
  needsLevel: number;
  accent?: 'good' | 'warn' | 'bad';
}

export interface DestinationIntel {
  name: string;
  fuelCost: number;
  rows: IntelRow[];             // always 5 — locked rows have value null
}

export function destinationIntel(spec: PlanetSpec, scanner: number, inhabitants: string[]): DestinationIntel {
  const def = PLANET_TYPES[spec.type];
  const r = spec.richness;
  const richness = r.minerals >= r.fuel && r.minerals >= r.data ? 'MINERAL-RICH'
    : r.fuel >= r.data ? 'VOLATILE-RICH' : 'DATA-RICH';
  const sizeLabel = spec.size === 'rich' ? 'EXTENSIVE' : spec.size === 'moon' ? 'MINOR BODY' : 'STANDARD';

  const rows: IntelRow[] = [
    { label: 'CLASS', needsLevel: 0, value: scanner >= 0 ? def.label : null },
    { label: 'SURVEY', needsLevel: 1, value: scanner >= 1 ? `${richness} · ${sizeLabel}` : null, accent: 'good' },
    { label: 'THREAT', needsLevel: 2, value: scanner >= 2 ? '☠'.repeat(spec.threat) + '·'.repeat(5 - spec.threat) : null, accent: 'bad' },
    { label: 'CONTACTS', needsLevel: 3, value: scanner >= 3 ? (inhabitants.length ? inhabitants.join(', ') : 'no signatures') : null, accent: 'warn' },
    { label: 'FORECAST', needsLevel: 4, value: scanner >= 4 ? lootHint(spec) : null, accent: 'good' },
  ];
  return { name: spec.name, fuelCost: spec.fuelCost, rows };
}

function lootHint(spec: PlanetSpec): string {
  const def = PLANET_TYPES[spec.type];
  const hints: string[] = [];
  if (def.richness.minerals > 1.2) hints.push('heavy ore');
  if (def.richness.fuel > 1.2) hints.push('volatiles');
  if (def.richness.data > 1.2) hints.push('anomalous signals');
  if (spec.size === 'rich') hints.push('elite presence, premium salvage');
  if (def.hazardHull) hints.push(`landing hazard −${def.hazardHull} hull`);
  return hints.join(' · ') || 'standard yields';
}

/** Candidate destinations visible at a scanner level: 2 base, +1 at Lv2, +1 at Lv4. */
export function candidateCount(scanner: number): number {
  return 2 + (scanner >= 2 ? 1 : 0) + (scanner >= 4 ? 1 : 0);
}

/** How a surface point of interest reads before being visited. */
export function nodeIntel(kind: NodeKind, scanner: number, onCurrentPlanet: boolean): { glyph: string; label: string | null; color: string } {
  const known = scanner >= 2 || (scanner >= 1 && onCurrentPlanet);
  if (!known && kind !== 'landing' && kind !== 'departure' && kind !== 'boss') {
    return { glyph: '?', label: 'Unknown signature', color: '#8a98ab' };
  }
  const map: Record<NodeKind, { glyph: string; label: string; color: string }> = {
    landing: { glyph: '▼', label: 'Landing site', color: '#9fb3c8' },
    combat: { glyph: '◆', label: 'Hostile contact', color: '#ff7a64' },
    elite: { glyph: '◆', label: 'APEX HOSTILE', color: '#ffae42' },
    event: { glyph: '?', label: 'Anomaly', color: '#c08aff' },
    extraction: { glyph: '⛏', label: 'Extraction site', color: '#ffce7a' },
    fabricator: { glyph: '⚙', label: 'Fabricator bay', color: '#5fd4f5' },
    forge: { glyph: '⊕', label: 'Replication forge', color: '#5fe39a' },
    boss: { glyph: '☠', label: 'GUARDIAN', color: '#ff5d4a' },
    departure: { glyph: '▲', label: 'Departure', color: '#ffd76a' },
  };
  return map[kind];
}
