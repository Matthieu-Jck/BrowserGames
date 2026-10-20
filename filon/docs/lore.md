# Lore

Who the player is, where the base stands and why there is nobody in it. This page is the source for every text that tells the story: the main menu's « À propos », the tutorial (CrierBelt's voice), building descriptions, the Gazette. Decided with the owner on 2026-10-11 (D29). French names first, as the player reads them.

## The setting

- **Ysmère** (Ysmere): a pale-ochre desert planet under a constant wind, **le Souffle** (the Sough). Slow lilac days, cold nights. Its floor is sand: a base scoops it anywhere (the sand collector), while ores lie in deposits.
- **Verrière**: the planet's only human city, a glass city far from the cirque. All the humans of Ysmère live there. The player lives there too. We never see it in the game; it is the voice at the other end of the uplink.
- **CrierBelt**: the company that runs **la Criée** (the Crier Ring), the orbital exchange, and its cargo lifts. It partners with investors to open remote extraction claims. In exchange it takes a cut on every trade (the trade post's fee) and runs the market news, **la Gazette de la Criée**. It also holds the land round the claims, and sells or leases it to the claimholders by the **parcelle** (parcel), at a price that follows what the parcel holds (D60, [land.md](land.md)). To a new claim it offers one **contrat de démarrage** (starter contract): copper ore at a fixed price, off the market, for its first wire (D101). Once a claim stands on its own (past the tutorial), it places **commandes** (orders) with it for the claim's own goods — so many, within so long, paid above the market and without its cut, sometimes with a bonus, a building kit or a research on top (D153) — and its Gazette prints the **classement des concessions** (the claims' standings): every partner's claim ranked by its value at the Crier, the player's among them. CrierBelt speaks of its orders in its formal voice (« CrierBelt vous passe commande… »). The name is a brand and stays « CrierBelt » in both languages.
- **The ocelle (◉)**: the Crier's currency. The UI draws it as the ocelle sign, a gold ring around a dot with a currency sign's two strokes ([coin.ts](../src/ui/coin.ts)).

## The title

The game is called **Ocelle** (owner, 2026-10-13, [D46](decisions.md)), after the Crier's currency: the player is an investor, and every ribbon and machine of the claim ends up as ocelles at the Crier. The menu draws its first O as the ocelle sign. The currency keeps its name (« 100 ◉ », « des ocelles »), and the ordinary word *filon* stays in the world (« Le filon fatigué », the copper vein). No company may register as « Ocelle ».

## The player

An investor from Verrière. They put a large sum into a partnership with CrierBelt and got a **concession** (a claim): a square of land round the Bonne-Veine cirque, its Crown included (the starting square), and a starter kit. The kit is the base's core, construction drones and a first stock of materials. The player pilots the base **from afar**. They do what that investor would do: decide what to extract, how to lay out and grow the base, what to research, and what to sell or buy at the Crier. They are a **concessionnaire** (claimholder), never a colonist.

## The intro

What a new player sees after the main menu's « Jouer » ([D31](decisions.md); code: [ui/screens/intro.ts](../src/ui/screens/intro.ts), [app/intro.ts](../src/app/intro.ts)). A short comic strip, inked like the rest, then the game picks up where it ends. The narration speaks to the player (« tu »); CrierBelt writes formally (« vous »).

1. **Verrière at dusk** — the glass city on its mesa, the only one on Ysmère, the Crier Ring arching over the desert, a shuttle climbing to it. « Ysmère. Un désert d'ocre sous le Souffle, et une seule ville : Verrière, la ville de verre. »
2. **The investor** — a silhouette at the window of a glass tower, a hologram turning a stack of ocelles into a company: the player's savings, staked on their own mining company, which they will run from there, from afar.
3. **CrierBelt's answer** — Ysmère seen from orbit, the Ring and its exchange beaming a holographic contract: the partnership is accepted; freight on its shuttles, the Crier and its Gazette are open to the player. Stamped « Accordé ».
4. **The register** — CrierBelt asks the company's name. The claim (the base) takes the same name, so the company and the concession are one. The name must be free: no other claim's, nothing of CrierBelt's or the world's own (CrierBelt, la Criée, l'Anneau, Verrière, Ysmère, le Cœur…).
5. **The landing** — back in the world, framed as the strip's last panel: the empty cirque, then the Heart coming down from the Ring under a CrierBelt sky-crane (four retro engines, cables, the CrierBelt mark on its hub), dust thrown up, touchdown, the crane climbing back to the Ring. CrierBelt: « Le Cœur est posé. Bienvenue au registre, {nom}. » Then the tutorial's first objective.

Nothing in it shows people at the base: the only human is the investor, in Verrière. The Heart is a CrierBelt delivery, set down by machines.

## The base

- **No humans at the base.** It is fully automated, built and run by drones, and keeps working when the player is away (the offline catch-up, D2). Nothing at the base shows people: no windows lit from inside, doors, walkways, gardens, houses or crews. Machines show machine things: LEDs, beacons, floodlights, uplink dishes, drone pads. This replaces D21's "glass and signs of life where people live": glass and domes belong to Verrière, which we never draw.
- **Le Cœur** (the Core in English since D68, the Heart before; code id `hearth`): the base's core. It is a depot that pays for construction, a drone bay, the uplink to Verrière and CrierBelt, and a small built-in solar array. It takes and never gives (D34): what enters it pays for construction or is sold through a trade post set against it; machines are fed by production lines, never by the Heart. It is the base's centrepiece and grows to level 5: it lands bare, nothing on its four corners, and each level mounts one more piece on a corner and dresses it up (D86) — level 2 its **compute bay** (D122: a server cabinet where the data outlet stood), level 3 the **Archive des expertises** (the record of what the base has learnt to do well: its expertises, D93), level 4 the grid station and level 5 an uplink mast (placeholders for now). Code and docs keep the id and the name "Hearth" (older docs say "the Heart"); only the displayed name changed. From level 2 its compute bay gives research a steady flow of AI tokens, « le calcul du Cœur » / the Core's compute (D122), more at each level and with Analytics' Overclocking and Data Mining. It gives no item at all: its data outlet went with the data.
- **Drones** build remotely ("kites" in older texts and code comments: `remoteBuildDelay`, the construction delay off the claim's land). They lay ribbons, poles and pylons across land the claim does not hold — a neighbouring base's only with Neighbour Treaties, between its buildings ([D110](decisions.md)) —; machines and stores stand on the claim's own parcels.
- **Research** (D68–D70): a **research lab** (« laboratoire de recherche ») is an automated station. It takes nothing by ribbon, only power (D122; owner, 2026-10-17: « Le laboratoire n'a plus besoin d'entrée, et on n'a plus besoin de générer de la data »). A research costs two things: a few **resources** that make sense for what it unlocks (gears, copper, circuits, lenses…), paid from the Core when it is launched; and **AI tokens**, compute it needs in a set number, at every tier. No research has a minimum time: it ends when its tokens are in. Tokens are not owned: they come as a flow, a minute at a time, to a lab that has power — the Core's compute and the claim's own servers', or a flow bought from CrierBelt's servers when the research is launched (later a market with the other claims that run servers). There is no research data any more: the data collectors, the test bench, Survey Data, Mechanics Data, Atlas and Codex are gone (an older base's data was turned into tokens). Research tiers open with the Core's levels (Tier 2 at 3, Tier 3 at 4, Tier 4 at 5). Say « token » in French too, never « jeton ». Research comes in **tiers** (T1–T4) and **families** whose names grow with the tier (Commerce: Échange, Finance, Économie de marché); a family splits into specialities from T3 (Machines: Électronique or Mécanique). A research node unlocks a machine or a feature, never a bare +15 %.
- **The land**: the claim's own parcels are the starting square, the parcels it bought for good and those it leases by the hour (« bail », « loyer »). A rent the purse cannot pay ends the lease (« Bail perdu »): the parcel goes back to its owner and what stands on it stops, nothing lost, until the claim holds it again.
- **Other buildings**: the trade post is CrierBelt's cargo lift pad (marked with the CrierBelt logo).
- **No airships of its own** ([D108](decisions.md)): what goes far goes by ribbon, and CrierBelt's lifts carry what is traded. The world still has its airships: the Drifter Guild (« Guilde des dirigeables »), a far sister claim, flies its own and weaves resin canvas.

## The Gleaners

**Les Glaneurs** (the Gleaners; D103): a small people of Ysmère's open desert. Small and hunched, legless, they live in the sand itself: a ragged cloak, a lumpy sack on the back, a deep hood bent low with a long tip blown back by the Sough, two lantern eyes in its shadow, a thin arm that reaches far. They travel under the open floor past the Crown — a bulge running along, a furrow closing behind it, now and then two eyes breaking the surface — and come in small bands to a ribbon they can reach, rise out of the sand beside it to the shoulders, wait half-buried, and each takes the first shiny, made thing that rides past, then sinks back with it — wire, glass, plates, quartz, the parts —, and leave what the desert already has (ore, stone, sand, coal, water). Curious and harmless, more gleaners than thieves (the word is Millet's: they take what is left along the way): no fighting, no damage, a few items a night. They never come into the cirque, never climb the mountains, never cross water or a chasm; a fence (« grille ») stops them, and they take nothing from under glass (« ruban vitré »). The base sees them only by night and counts what they took; at dawn it tells the investor (« Cette nuit, les Glaneurs ont pris… »). Nobody at the base meets them: there is nobody at the base.

## The market's actors

The forty simulated market actors (`colonies` in code: `src/content/colonies.ts`, `src/market`) are other CrierBelt partners' claims, companies like the player's: in the UI simply **concessions** / "claims" (« les autres concessions », « une autre concession porte ce nom »), never « colonies », and never « concessions sœurs » / "sister claims" since [D110](decisions.md) (owner, 2026-10-17: « Pourquoi "sister claim" ? Enlève ça »). Their names (Port-Écume, Sept-Cornes…) are the names of those claims, and each flies an emblem of its own.

Some of them hold land beside the player's, a few, out on the horizon (none within three rings of the starting square): a **base voisine** / "neighbouring base" (D110). Where another claim holds land, a base of its stands there and works, run by its own drones like the player's (no humans there either): its trade's chain — what it extracts, the machines the goods go through, its store and CrierBelt's lift pad, where its goods leave for the Crier on CrierBelt's drones —, its own power and wires running from its own Core — a smaller one than the player's, of other stuff altogether: a stone plinth, a plank drum under a striped canvas cone, crowned by its trade's mast, chimney, lantern or dish —, its lamps lit at night, smoke from its furnaces. It looks like no base of the player's: everything of it weathered in its colony's colours, each building on a patched canvas tarp, covered depots under canvas domes (its drones' stores), tall poles with long banners, cairns along its edge, its name on a cloth band over it. Its drones watch over its land: the Gleaners keep off it. Its land is not for sale; with Neighbour Treaties (« Traités de voisinage ») the player's ribbons and poles may cross it between its buildings.

## Words to use

| Say (FR · EN) | Not | Where |
|---|---|---|
| ta base · your base | ta colonie · your colony | Any text about the player's installation |
| concession · claim | — | The land grant, the player's name for it (`Sim.colonyName`) |
| le Cœur · the Core | le Foyer · the Hearth, the Heart | Displayed name of `hearth` |
| concessions, les autres concessions · claims, the other claims | concessions sœurs · sister claims; colonies | The market's other actors |
| base voisine · neighbouring base | concession sœur · sister claim; colonie | Another claim's base on the land beside the player's (D110) |
| calcul du Cœur · the Core's compute | données, data (retired, D122) | The AI tokens a minute the Core gives research from its level 2; research takes no data any more |
| ressources · resources | — | What a research costs from the Core at launch, beside its tokens (D122) |
| laboratoire de recherche · research lab | observatoire · observatory | `observatory` (its id kept) |
| token · token | jeton | AI compute paid by the minute |
| drones | cerfs-volants · kites | Remote construction |
| vos terres · your land; parcelle · parcel | la zone (d'influence) · the zone | Where the claim may build: its parcels |
| bail, loyer, louer · lease, rent, lease (verb) | — | A parcel rented by the hour |
| expertise (« Expertise », the window, in both languages) · expertise | spécialité, talent, compétence | What the base has learnt to do well (D93): a skill of the claim's machines, never of people |
| réorientation · reorientation | respec | Changing an expertise in place: paid, 24 h without |
| les Glaneurs · the Gleaners | voleurs, pillards, créatures · thieves, raiders, monsters | The desert people that takes from the ribbons at night (D103); « prendre » (take), never « voler » (steal) |
| grille · fence; ruban vitré · glazed ribbon | mur, barrière · wall | What keeps the Gleaners out, and off (D103) |

## Tone

Quiet and wide: lonely machines working a pastel desert under the wind, inked like a Moebius album. The human world reaches the base only as messages: CrierBelt's onboarding and objectives (the tutorial), the Gazette, the prices. Short texts, no melodrama.
