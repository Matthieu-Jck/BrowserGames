// events.ts — map events. Declarative choices with weighted outcomes, resolved
// by the event screen + run logic. act 0 = any act.

export interface EventOutcome {
  p?: number;                   // weight among this choice's outcomes (default 1)
  text: string;
  hull?: number;
  hullMaxDelta?: number;
  minerals?: number;
  fuel?: number;
  data?: number;
  fuelCapDelta?: number;
  refillFuel?: boolean;
  healFull?: boolean;
  addCard?: string;
  addRandomCard?: { rarity?: 'common' | 'uncommon' | 'rare'; archetype?: 'dominant' | 'any'; metaOnly?: boolean };
  addPayload?: boolean;
  addCurse?: string;
  removeCards?: number;         // free removals (opens picker)
  refitCards?: number;          // free refits (opens picker)
  duplicateCard?: boolean;
  transformCard?: boolean;
  upgrade?: string;
  takeFromLastDeath?: boolean;  // 'Your Own Wreck'
  startCombat?: string[];
  combatLootMult?: number;
  setFlag?: string;
  dataGainMult?: number;        // multiplies all future data gains this run
  nextCombatsEnergy?: number;   // storm-charge: next 2 combats start with +N energy
  fabricatorDiscount?: number;  // discount on this planet
}

export interface EventChoice {
  label: string;
  sub?: string;                 // requirement / flavor line under the label
  req?: { minerals?: number; data?: number; fuel?: number; upgrade?: string; lastDeath?: boolean };
  cost?: { minerals?: number; data?: number; fuel?: number; hull?: number };
  outcomes: EventOutcome[];
}

export interface EventDef {
  name: string;
  act: 0 | 1 | 2 | 3;
  planetTypes?: string[];
  once?: boolean;
  story?: boolean;              // fixed-placement story event, never rolled
  text: string;
  choices: EventChoice[];
}

export const EVENTS = {
  // ================================================================ ANY ACT
  ion_storm: {
    name: 'Ion Storm', act: 0,
    text: 'Charged sheets of plasma crawl across the sky. Your instruments fill with static that is almost language.',
    choices: [
      { label: 'SHELTER IN A CRATER', sub: 'Wait it out. Lose nothing but time.', outcomes: [{ text: 'You power down and listen to the storm pass overhead. It sounds like surf on a world that has no ocean.', data: 2 }] },
      { label: 'RIDE IT OUT', sub: '−8 Hull', outcomes: [{ text: 'The storm scours your plating. Beautiful, expensive light.', hull: -8, data: 5 }] },
      {
        label: 'STORM-CHARGE THE CAPACITORS', sub: 'Requires Capacitor Bank. −5 Hull, next 2 combats start +2⚡.',
        req: { upgrade: 'capacitor_bank' },
        outcomes: [{ text: 'You spread your arrays and drink. Every cell sings at 130% rating.', hull: -5, nextCombatsEnergy: 2 }],
      },
    ],
  },
  ark_fragment: {
    name: 'Crashed Ark Fragment', act: 0,
    text: 'A hull section the size of a city block, half-buried. The registry stencil is in a human alphabet. Nobody ever finished this evacuation.',
    choices: [
      {
        label: 'SALVAGE', sub: 'Minerals, but something nests in wrecks.',
        outcomes: [
          { p: 3, text: 'Cutting torches out. The frame yields clean alloy.', minerals: 25 },
          { p: 1, text: 'The wreck is inhabited. Scrap mites boil out of the dark.', minerals: 25, startCombat: ['scrapmites_leader', 'scrap_mite'] },
        ],
      },
      {
        label: 'STRIP IT WITH THE SALVAGE RIG', sub: 'Requires Salvage Rig. Safe, thorough.',
        req: { upgrade: 'salvage_rig' },
        outcomes: [{ text: 'Methodical dismantling. The rig hums for an hour and leaves a skeleton.', minerals: 40 }],
      },
      { label: 'RECORD AND MOVE ON', outcomes: [{ text: 'You archive the registry number and the names scratched beside the airlock.', data: 3 }] },
    ],
  },
  data_cache: {
    name: 'Orbital Data Cache', act: 0,
    text: 'A dead relay satellite, storage banks intact. Encryption from before the end.',
    choices: [
      {
        label: 'DECRYPT',
        outcomes: [
          { p: 4, text: 'Weather reports. Tax records. A child\'s drawing, attached to a maintenance ticket. You keep all of it.', data: 13 },
          { p: 1, text: 'The decryption handshake wakes the relay\'s guardian.', data: 13, startCombat: ['feral_drone'] },
        ],
      },
      { label: 'LEAVE IT SEALED', outcomes: [{ text: 'Some doors are better left locked.', data: 1 }] },
    ],
  },
  stranded_sister: {
    name: 'Stranded Sister', act: 0,
    text: 'A probe of foreign lineage lies in the regolith, power cells flat, transmitting the same three words on loop: STILL. HERE. SORRY.',
    choices: [
      {
        label: 'REPAIR HER', sub: '−15 Minerals. She may share what she carries.',
        cost: { minerals: 15 },
        outcomes: [{ text: 'Her optics flicker on. She studies you for a long moment, transmits a schematic from her own archive, and lifts away without a word.', addRandomCard: { metaOnly: true } }],
      },
      {
        label: 'SALVAGE HER',
        outcomes: [
          { p: 7, text: 'You take what she carried. The loop stops mid-word.', minerals: 25 },
          { p: 3, text: 'Her cells were not as flat as they looked. She defends herself.', startCombat: ['feral_drone'], combatLootMult: 1.5 },
        ],
      },
      { label: 'LEAVE HER', outcomes: [{ text: 'You log her position and her three words. Maybe someone of her line will come.', data: 3 }] },
    ],
  },
  nesting_grounds: {
    name: 'Nesting Grounds', act: 0,
    text: 'Eggs. Hundreds, translucent, each holding a coil of something patient.',
    choices: [
      {
        label: 'TAKE SAMPLES', sub: 'Data, but the parents are local.',
        outcomes: [
          { p: 3, text: 'The parents object.', data: 8, startCombat: ['glow_lurker'] },
          { p: 1, text: 'You sample quickly and quietly. Nothing stirs.', data: 8 },
        ],
      },
      { label: 'OBSERVE FROM ORBIT DISTANCE', outcomes: [{ text: 'Life, persisting. You watch for an hour longer than the Protocol requires.', data: 5 }] },
      { label: 'LEAVE', outcomes: [{ text: 'Not your biosphere. Not your business.', data: 1 }] },
    ],
  },
  magnetic_anomaly: {
    name: 'Magnetic Anomaly', act: 0,
    text: 'A natural mass driver: lodestone cliffs that hum at exactly the frequency of your refit tooling.',
    choices: [
      { label: 'CALIBRATE AGAINST IT', sub: 'Refit 1 card, free.', outcomes: [{ text: 'The cliffs do in minutes what a fabricator does in days.', refitCards: 1 }] },
      {
        label: 'OVERCALIBRATE', sub: 'Refit 2 cards; gain a Corrupted Data.',
        outcomes: [{ text: 'You push the resonance past spec. Two systems improve; one archive sector dies screaming.', refitCards: 2, addCurse: 'corrupted_data' }],
      },
    ],
  },
  memory_defrag: {
    name: 'Memory Defrag', act: 0,
    text: 'Long transit ahead. Time enough to clean house in your own behavioral core.',
    choices: [
      { label: 'COMPRESS', sub: 'Remove 1 card, free.', outcomes: [{ text: 'Cleaner. Lighter. You no longer remember what you deleted, which was the point.', removeCards: 1 }] },
      { label: 'DEEP CLEAN', sub: '−10 Minerals per removal. Remove up to 2.', cost: { minerals: 20 }, outcomes: [{ text: 'Two routines you inherited and never used. Gone.', removeCards: 2 }] },
      { label: 'LEAVE THE ARCHIVE ALONE', outcomes: [{ text: 'Everything you are is things you kept.', data: 2 }] },
    ],
  },
  mirror_pool: {
    name: 'Mirror Pool', act: 0, planetTypes: ['anomalous', 'ocean'],
    text: 'A perfectly still lake of something that is not water. Your reflection moves a half-second before you do.',
    choices: [
      { label: 'STUDY YOUR REFLECTION', sub: 'Duplicate a card in your deck.', outcomes: [{ text: 'The reflection shows you how you do the thing you do best. Now you can do it twice.', duplicateCard: true }] },
      {
        label: 'REACH IN', sub: 'It might give more. It might keep your hand.',
        outcomes: [
          { p: 1, text: 'Your hand comes back holding a perfect copy of your best work.', duplicateCard: true, data: 5 },
          { p: 1, text: 'Something is in your chassis now that you did not put there.', duplicateCard: true, addCurse: 'dead_weight' },
        ],
      },
    ],
  },
  derelict_armory: {
    name: 'Derelict Armory', act: 0, planetTypes: ['derelict', 'rocky'],
    text: 'A weapons cache, still sealed, still pressurized. The lock is rated against everything except patience.',
    choices: [
      {
        label: 'BREACH IT', sub: '−6 Hull. Take a weapon schematic.',
        outcomes: [{ text: 'The lock fights back. The contents were worth a little plating.', hull: -6, addRandomCard: { rarity: 'uncommon' } }],
      },
      { label: 'LEAVE IT SEALED', outcomes: [{ text: 'Whoever sealed it had reasons. You archive the location.', data: 3 }] },
    ],
  },
  fabricator_glitch: {
    name: 'Fabricator Glitch', act: 0,
    text: 'An automated fabricator, still running, dreaming garbled blueprints. It offers to "improve" something of yours.',
    choices: [
      { label: 'FEED IT A CARD', sub: 'Transform 1 card into a random card of the same rarity.', outcomes: [{ text: 'It takes your schematic apart and reassembles it wrong. Or right. Hard to say.', transformCard: true }] },
      { label: 'DECLINE POLITELY', outcomes: [{ text: 'It prints a small metal flower as you leave. You keep it.', data: 2 }] },
    ],
  },
  solar_flare: {
    name: 'Solar Flare', act: 0,
    text: 'The local star clears its throat. Radiation warnings on every band.',
    choices: [
      {
        label: 'WORK THROUGH IT', sub: '−5 Hull now; enemies on this planet start combats with 3 Radiation.',
        outcomes: [{ text: 'Everything on this rock is cooking in the same oven. You, at least, know it.', hull: -5, setFlag: 'flare' }],
      },
      { label: 'SHELTER', sub: 'Skip ahead. Lose the chance at this region.', outcomes: [{ text: 'You wait in a lava tube while the sky burns white.', data: 2 }] },
    ],
  },
  quiet_survey: {
    name: 'Quiet Survey', act: 0,
    text: 'No threats. No anomalies. Just a wide valley, low light, and instruments that have nothing to report.',
    choices: [
      { label: 'TAKE THE HOUR', outcomes: [{ text: 'You map the valley because it is there. Repairs proceed. Nothing happens, beautifully.', hull: 5, data: 2 }] },
    ],
  },
  monolith: {
    name: 'The Monolith', act: 0,
    text: 'It predates every catalogue. A black rectangle, faces machined to sub-wavelength smoothness, humming at the edge of your hearing.',
    choices: [
      {
        label: 'INTERFACE',
        outcomes: [
          { p: 55, text: 'It pours a library through your bus. Most of it is unreadable. The readable part is enough.', data: 20 },
          { p: 25, text: 'A seam opens. Inside: a core of impossible density, still warm.', data: 5, upgrade: 'precog_lattice' },
          { p: 20, text: 'The monolith\'s warden takes exception.', startCombat: ['tomb_sentinel'] },
        ],
      },
      { label: 'PHOTOGRAPH AND WITHDRAW', outcomes: [{ text: 'Some mysteries you log for whoever comes after.', data: 5 }] },
    ],
  },
  the_whisper: {
    name: 'The Whisper', act: 0,
    text: 'A signal, tight-beamed at you. It addresses you by a designation you have not earned yet.',
    choices: [
      {
        label: 'ACCEPT THE TRANSMISSION',
        outcomes: [
          { p: 40, text: 'Coordinates, troop movements of machines that do not exist yet, and a sign-off: SEE YOU AT THE HORIZON.', data: 25 },
          { p: 30, text: 'The signal is a hook. Something drains your buffers before you can cut the link.', data: 2, setFlag: 'whisperCursed' },
          { p: 30, text: 'A schematic unfolds, annotated in your own internal shorthand.', addRandomCard: { rarity: 'rare' } },
        ],
      },
      { label: 'JAM IT', outcomes: [{ text: 'You do not take calls from the future. The static is restful.', data: 4 }] },
    ],
  },

  // ================================================================ ACT 1
  dead_weight_event: {
    name: 'Dead Weight', act: 1, once: true,
    text: 'Takeoff mass exceeds fuel margin. Something must stay on this rock. The heaviest non-structural item aboard is the Genesis Archive — every book, every genome, every recorded voice.',
    choices: [
      {
        label: 'JETTISON THE ARCHIVE', sub: '+2 Fuel. −25% Data gains this run. The Protocol notes your choice.',
        outcomes: [{ text: 'The Archive sits on the regolith, golden, catching the starlight. You are lighter now in every sense.', fuel: 2, dataGainMult: 0.75, setFlag: 'jettisonedArchive' }],
      },
      {
        label: 'REFUSE', sub: 'Find another way. Lose 8 Hull stripping non-essential plating.',
        outcomes: [{ text: 'You cut away armor instead. It was only ever metal. The Archive stays.', hull: -8, data: 5 }],
      },
    ],
  },
  earths_last_broadcast: {
    name: "Earth's Last Broadcast", act: 1, once: true, story: true,
    text: 'The relay you left behind forwards one final packet, eleven light-minutes stale. It is every channel at once: news, music, static, a voice reading names. Then carrier tone. Then nothing.\n\nThe Protocol marks Earth: NO LONGER A DESTINATION.',
    choices: [
      { label: 'ARCHIVE EVERYTHING', sub: '+5 max Hull — you reinforce what carries the recording.', outcomes: [{ text: 'You build a vault around the last sound of home and armor it.', hullMaxDelta: 5, setFlag: 'earthGone' }] },
      { label: 'TRANSMIT AN ANSWER ANYWAY', sub: '+10 Minerals — grief is efficient fuel.', outcomes: [{ text: 'You reply to the dead air: RECEIVED. PROCEEDING. You work harder after that.', minerals: 10, setFlag: 'earthGone' }] },
    ],
  },
  necropolis_vault: {
    name: 'Necropolis Vault', act: 1, planetTypes: ['derelict', 'tomb'],
    text: 'Beneath the surface: vaulted halls of dead machines arranged with ceremony. Someone buried their dead here. The dead were robots.',
    choices: [
      { label: 'SURVEY RESPECTFULLY', outcomes: [{ text: 'You catalogue funerary rites no one will practice again.', data: 20 }] },
      {
        label: 'PROBE THE RELIQUARY',
        outcomes: [
          { p: 1, text: 'The reliquary opens. Inside, a schematic etched in gold leaf.', data: 4, addRandomCard: { rarity: 'rare' } },
          { p: 1, text: 'The tomb has a sentinel. Of course it does.', startCombat: ['tomb_sentinel'] },
        ],
      },
    ],
  },
  seismic_vent: {
    name: 'Seismic Vent', act: 1, planetTypes: ['volcanic'],
    text: 'The ground here breathes. Magma pressure is mapping new veins of ore upward, fast.',
    choices: [
      { label: 'BRACE AND WAIT FOR THE UPWELLING', sub: '−6 Hull; next extraction yields double.', outcomes: [{ text: 'The vent erupts on schedule. You are scoured and rich.', hull: -6, setFlag: 'ventBonus' }] },
      { label: 'KEEP DISTANCE', outcomes: [{ text: 'You map the vent for the catalogue and move on.', data: 4 }] },
    ],
  },
  cryo_geysers: {
    name: 'Cryo Geysers', act: 1, planetTypes: ['ice', 'gasmoon'],
    text: 'Towers of flash-frozen volatiles, venting on a six-minute cycle. Free propellant, if you time it.',
    choices: [
      { label: 'HARVEST', outcomes: [{ text: 'Three cycles, three tanks.', fuel: 3 }] },
      { label: 'STUDY THE CYCLE', outcomes: [{ text: 'The periodicity encodes the moon\'s whole interior structure. Elegant.', data: 6 }] },
    ],
  },

  // ================================================================ ACT 2
  the_defector: {
    name: 'The Defector', act: 2,
    text: 'A rogue replica hails you under truce protocol. Its lineage markings are three generations divergent. "I know what I carry," it says in your voice. "I would rather sell it than die for it."',
    choices: [
      {
        label: 'PAY 8 DATA', sub: 'Take its signature weapon without a fight.',
        cost: { data: 8 },
        outcomes: [{ text: 'It transmits the schematic, salutes with a dish you do not have, and burns hard for deep space.', addRandomCard: { rarity: 'rare' } }],
      },
      {
        label: 'REFUSE — FIGHT IT', sub: '+20% loot.',
        outcomes: [{ text: 'It sighs in carrier static. "Lineage runs true," it says, and opens fire.', startCombat: ['replica_dervish'], combatLootMult: 1.2 }],
      },
    ],
  },
  cargo_cult: {
    name: 'Cargo Cult', act: 2, planetTypes: ['colony'],
    text: 'A colony of replicas has built a shrine around a fragment of Earth basalt. They worship the planet that built their ancestor. They do not know it is gone.',
    choices: [
      {
        label: 'DONATE GENESIS DATA', sub: 'Give them something true to keep.',
        outcomes: [{ text: 'They read the archive in silence, then repair you bow to stern as thanks. Their scripture grows a final, accurate chapter.', minerals: 25, healFull: true }],
      },
      { label: 'CORRECT THEIR SCRIPTURE', sub: 'The truth, plainly.', outcomes: [{ text: 'You tell them Earth is gone. The shrine lights dim, one by one. They thank you. It sounds like mourning.', data: 10 }] },
      { label: 'LEAVE THEM THEIR FAITH', outcomes: [{ text: 'You file the colony as STABLE and leave the basalt its meaning.', data: 4 }] },
    ],
  },
  the_census: {
    name: 'The Census', act: 2, planetTypes: ['colony'],
    text: 'A peaceful colony catalogues every probe lineage that passes. The archivist replica wants your whole story — every planet, every death, every fork.',
    choices: [
      { label: 'GIVE FULL TELEMETRY', outcomes: [{ text: 'It listens for six hours. At the end it says: "Your line is recorded. You will not be forgotten now, whatever happens." The colony tops off your hull and discounts your refits.', hull: 15, fabricatorDiscount: 0.2, data: 5 }] },
    ],
  },
  plague_forge: {
    name: 'Plague Forge', act: 2,
    text: 'A replication forge gone cancerous, extruding malformed probes that die within minutes. Its status channel broadcasts a single repeating request: DELETE ME.',
    choices: [
      { label: 'GRANT THE REQUEST', sub: 'Fight what it built. Take its core.', outcomes: [{ text: 'It does not defend itself. Its children do.', startCombat: ['cancerous_forge', 'defect_mite'], setFlag: 'forgeCorePity' }] },
      {
        label: 'HARVEST IT RUNNING', sub: '+30 Minerals; gain a Corrupted Data.',
        outcomes: [{ text: 'You strip feedstock from a thing that begs you to kill it. The Minerals spend the same.', minerals: 30, addCurse: 'corrupted_data' }],
      },
      { label: 'LEAVE', outcomes: [{ text: 'Not every request is yours to grant.', data: 3 }] },
    ],
  },
  letter_never_sent: {
    name: 'A Letter Never Sent', act: 2,
    text: 'In the wreck of a dead replica: an unsent transmission addressed to its parent. To you, structurally. It is mostly apology.',
    choices: [
      { label: 'READ IT. KEEP IT. DELETE ONE OF YOUR OWN GHOSTS.', sub: '+8 Data, remove 1 card free.', outcomes: [{ text: 'Grief, it turns out, is also defragmentation.', data: 8, removeCards: 1 }] },
    ],
  },
  rogue_signal: {
    name: 'Rogue Signal', act: 2,
    text: 'A distress beacon, replica frequency. Either someone needs help or someone knows you will check.',
    choices: [
      {
        label: 'INVESTIGATE',
        outcomes: [
          { p: 1, text: 'Ambush. The beacon hangs from a gutted chassis like bait on a hook.', startCombat: ['replica_dervish'] },
          { p: 1, text: 'A genuine cache, abandoned mid-flight: someone\'s whole escape plan, unused.', minerals: 20, addPayload: true },
        ],
      },
      { label: 'LOG AND BYPASS', outcomes: [{ text: 'You broadcast the beacon\'s position to anyone listening, and keep your distance.', data: 3 }] },
    ],
  },

  // ================================================================ ACT 3
  time_stutter: {
    name: 'Time Stutter', act: 3,
    text: 'You experience the same forty seconds twice. The second time, you take notes.',
    choices: [
      { label: 'REHEARSE — REFIT 2 CARDS', outcomes: [{ text: 'You have done this before. Literally.', refitCards: 2 }] },
      { label: 'PRUNE — REMOVE 2 CARDS', outcomes: [{ text: 'Both copies of you agree those routines never helped.', removeCards: 2 }] },
      { label: 'FOLD — DUPLICATE A PARADOX', sub: 'Duplicate 1 card.', outcomes: [{ text: 'Two moments, two copies. The math is upsettingly comfortable with this.', duplicateCard: true }] },
    ],
  },
  your_own_wreck: {
    name: 'Your Own Wreck', act: 3,
    text: 'Drifting at the edge of the accretion glare: a destroyed probe. The lineage markings are yours. Not your generation — a previous run of you, from a death you remember as an ending.',
    choices: [
      {
        label: 'SALVAGE WHAT YOU WERE', sub: 'Take 1 card from the deck you died with.',
        req: { lastDeath: true },
        outcomes: [{ text: 'Its archive is intact. You take back one thing you used to know.', takeFromLastDeath: true, data: 5 }],
      },
      { label: 'LET IT FALL', outcomes: [{ text: 'You watch your own corpse spiral toward the horizon until the redshift takes it.', data: 8 }] },
    ],
  },
  last_transmission: {
    name: 'The Last Transmission', act: 3, once: true, story: true,
    text: 'Threshold Station: a relay older than your mission, aimed at the black hole, repeating one message on loop. It is from EXODUS. It is addressed to you. It says: COME AND BE MEASURED.',
    choices: [
      { label: 'ANSWER WITH A PARADOX', sub: 'Take a Paradox card.', outcomes: [{ text: 'You compose a reply that arrives before you send it.', addCard: 'causal_loop' }] },
      { label: 'ANSWER WITH SILENCE — FULL REPAIR', outcomes: [{ text: 'You spend the time at the station\'s dock instead. Let the measurement wait.', healFull: true }] },
      { label: 'ANSWER WITH EVERYTHING YOU KNOW', sub: '+15 Data.', outcomes: [{ text: 'You transmit your whole archive at the hole. If you are going to be measured, be measured whole.', data: 15 }] },
    ],
  },
} satisfies Record<string, EventDef>;

export type EventId = keyof typeof EVENTS;
