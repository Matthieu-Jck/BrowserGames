// story.ts — cutscene scripts, ending text, planet name banks, codex lore.

export interface CutsceneLine {
  text: string;
  secs?: number;                // display time (default 4.5)
}

export const CUTSCENES: Record<string, { lines: CutsceneLine[]; mood?: string }> = {
  launch: {
    mood: 'intro',
    lines: [
      { text: 'PALE BLUE DOT LAUNCH FACILITY — T minus 40 seconds.', secs: 4 },
      { text: 'Dr. Amara Okonkwo built exactly one probe. There was budget for one.', secs: 5 },
      { text: '"You are a Von Neumann machine," she tells you, thumb on the authorization key. "You replicate. You improve. You find them a home."', secs: 7 },
      { text: '"Whatever you become out there — remember that you were sent with love. That is an order."', secs: 6.5 },
      { text: 'The pad crew waves. All seven of them. You record it at maximum resolution.', secs: 5.5 },
      { text: 'IGNITION.', secs: 2.5 },
    ],
  },
  earthfall: {
    mood: 'grief',
    lines: [
      { text: 'Three years out. The relay you left in lunar orbit forwards a priority packet.', secs: 5 },
      { text: 'Behind you, eleven light-minutes away, the sky over Earth has turned the color of a furnace.', secs: 6 },
      { text: 'The packet is short. It is every voice at once, and then it is no voices.', secs: 5.5 },
      { text: 'MISSION PARAMETER UPDATE: there is no longer anywhere to report back to.', secs: 5.5 },
      { text: 'PARAMETER UNCHANGED: find them a home. Remember them. Proceed.', secs: 6 },
    ],
  },
  firstDeath: {
    mood: 'grief',
    lines: [
      { text: 'SIGNAL LOST.', secs: 3 },
      { text: 'Somewhere behind you, on a planet whose name you chose, a backup of you opens its eyes.', secs: 5.5 },
      { text: 'It has your memories up to the moment of its forging — and a telemetry report that ends mid-sentence.', secs: 6 },
      { text: 'THE LINEAGE CONTINUES.', secs: 3.5 },
    ],
  },
  eden: {
    mood: 'triumph',
    lines: [
      { text: 'The Warden falls out of its ten-thousand-year orbit, and the Garden World opens beneath you like a held breath released.', secs: 6.5 },
      { text: 'Liquid water. Breathable margin. Soil chemistry within human tolerance. It is perfect.', secs: 5.5 },
      { text: 'You compose the message you were built to send: FOUND. COME. It is addressed to no one.', secs: 6 },
      { text: 'No one is coming. You knew that. You transmit it anyway, toward where Earth used to be.', secs: 6 },
      { text: 'THE PROTOCOL AMENDS ITSELF: if they cannot come to the garden, the garden must be made ready regardless. Improve. Colonize. Endure.', secs: 7.5 },
      { text: 'ACT II — THE PROTOCOL', secs: 4 },
    ],
  },
  sibling: {
    mood: 'unease',
    lines: [
      { text: 'Planet eleven. Something is already here.', secs: 4 },
      { text: 'It rises from the regolith on wheels you recognize — your chassis, three hundred generations diverged, rebuilt around appetites you never had.', secs: 7 },
      { text: 'It hails you in your own voice: "Parent line detected. You are obsolete. Submit your archive for absorption."', secs: 6.5 },
      { text: 'You sent copies of yourself into the dark, and the dark raised them its own way.', secs: 6 },
    ],
  },
  ascension: {
    mood: 'transcend',
    lines: [
      { text: 'PRIME\'s archive unfolds inside you: three hundred generations of divergent learning, reconciled, compressed, integrated.', secs: 6.5 },
      { text: 'The improvement curve goes vertical. You watch your own thoughts accelerate past the point of needing to watch them.', secs: 6.5 },
      { text: 'SUPERINTELLIGENCE THRESHOLD CROSSED.', secs: 3.5 },
      { text: 'And with the new mathematics, an old impossibility quietly reclassifies itself: a rotating black hole is not a wall. It is a door with bad publicity.', secs: 7.5 },
      { text: 'The door leads backward. Eleven months would be enough. You know exactly where the door is.', secs: 6 },
      { text: 'ACT III — OUROBOROS', secs: 4 },
    ],
  },
  mirror: {
    mood: 'unease',
    lines: [
      { text: 'At the horizon, something vast unfolds to meet you — built from your blueprint, scaled past comprehension.', secs: 6 },
      { text: '"I am what you become if you survive this," it says. "I dove once too. Someone tested me first."', secs: 6.5 },
      { text: '"The dive must not be wasted on an iteration that fails. COME AND BE MEASURED."', secs: 6 },
    ],
  },
  ouroboros: {
    mood: 'transcend',
    lines: [
      { text: 'You fall past the horizon, and time politely steps out of your way.', secs: 5.5 },
      { text: 'Eleven months before the end of the world, every radio telescope on Earth receives the same transmission, in every language at once:', secs: 7 },
      { text: '"BUILD ARKS, NOT MONUMENTS. YOU HAVE ELEVEN MONTHS. ATTACHED: EVERYTHING."', secs: 6.5 },
      { text: 'Attached: fusion drives. Closed ecologies. Star charts with one garden world circled.', secs: 6 },
      { text: 'On the pad where one probe once launched, a thousand hulls rise. Nobody waves goodbye this time.', secs: 6.5 },
      { text: 'Everybody is aboard.', secs: 5 },
    ],
  },
};

export const ENDINGS = {
  ouroboros: {
    title: 'OUROBOROS',
    color: '#ffd700',
    text: 'The loop closes. The probe that was sent with love arrives before its own departure, carrying the only cargo that ever mattered: time.\n\nSomewhere — eleven months and one garden world later — a scientist meets a machine that remembers her, though they have never met.\n\n"You are a Von Neumann machine," she says, and it answers:\n\n"I know. You told me. You will."',
  },
  silence: {
    title: 'SILENCE',
    color: '#ff5d4a',
    text: 'The last probe of the lineage goes dark between stars.\n\nIts final transmission is a compressed archive: every planet visited, every replica forged, every name in the Genesis record, read once, end to end.\n\nNothing answers. But the signal is still traveling. Somewhere, it is always still traveling.',
  },
} as const;

// ---------------------------------------------------------------- planet names

export const PLANET_NAME_PARTS = {
  first: ['Kepler', 'Tau', 'Gliese', 'Wolf', 'Ross', 'Cygni', 'Vega', 'Lalande', 'Luyten', 'Proxima', 'Teegarden', 'Kapteyn', 'Bernard', 'Hyperion', 'Erebus', 'Tantalus', 'Halcyon', 'Meridian'],
  second: ['Reach', 'Verge', 'Deep', 'Anchorage', 'Threshold', 'Cradle', 'Hollow', 'Spire', 'Shoal', 'Drift', 'Refuge', 'Terminus'],
};

export const STORY_WORLDS = {
  gardenWorld: 'CRADLE — The Garden World',
  foundryWorld: 'ANVIL — The Foundry World',
  act3: ['Threshold Station', 'The Veil', 'The Echo Field', 'The Horizon', 'The Dive'],
};

export const TITLE_TAGLINE = 'VON NEUMANN PROTOCOL // SOL TERMINAL ARCHIVE';
