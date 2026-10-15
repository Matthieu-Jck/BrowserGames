# Lore

Who the player is, where the base stands and why there is nobody in it. This page is the source for every text that tells the story: the main menu's « À propos », the tutorial (CrierBelt's voice), building descriptions, the Gazette. Decided with the owner on 2026-10-11 (D29). French names first, as the player reads them.

## The setting

- **Ysmère** (Ysmere): a pale-ochre desert planet under a constant wind, **le Souffle** (the Sough). Slow lilac days, cold nights. Its floor is sand: a base scoops it anywhere (the sand collector), while ores lie in deposits.
- **Verrière**: the planet's only human city, a glass city far from the cirque. All the humans of Ysmère live there. The player lives there too. We never see it in the game; it is the voice at the other end of the uplink.
- **CrierBelt**: the company that runs **la Criée** (the Crier Ring), the orbital exchange, and its cargo lifts. It partners with investors to open remote extraction claims. In exchange it takes a cut on every trade (the trade post's fee) and runs the market news, **la Gazette de la Criée**. It also holds the land round the claims, and sells or leases it to the claimholders by the **parcelle** (parcel), at a price that follows what the parcel holds (D60, [land.md](land.md)). The name is a brand and stays « CrierBelt » in both languages.
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
4. **The register** — CrierBelt asks the company's name. The claim (the base) takes the same name, so the company and the concession are one. The name must be free: no sister claim's, nothing of CrierBelt's or the world's own (CrierBelt, la Criée, l'Anneau, Verrière, Ysmère, le Cœur…).
5. **The landing** — back in the world, framed as the strip's last panel: the empty cirque, then the Heart coming down from the Ring under a CrierBelt sky-crane (four retro engines, cables, the CrierBelt mark on its hub), dust thrown up, touchdown, the crane climbing back to the Ring. CrierBelt: « Le Cœur est posé. Bienvenue au registre, {nom}. » Then the tutorial's first objective.

Nothing in it shows people at the base: the only human is the investor, in Verrière. The Heart is a CrierBelt delivery, set down by machines.

## The base

- **No humans at the base.** It is fully automated, built and run by drones, and keeps working when the player is away (the offline catch-up, D2). Nothing at the base shows people: no windows lit from inside, doors, walkways, gardens, houses or crews. Machines show machine things: LEDs, beacons, floodlights, uplink dishes, drone pads. This replaces D21's "glass and signs of life where people live": glass and domes belong to Verrière, which we never draw.
- **Le Cœur** (the Core in English since D68, the Heart before; code id `hearth`): the base's core. It is a depot that pays for construction, a drone bay, the uplink to Verrière and CrierBelt, and a small built-in solar array. It takes and never gives (D34): what enters it pays for construction or is sold through a trade post set against it; machines are fed by production lines, never by the Heart. It is the base's centrepiece and grows to level 4: it lands bare, nothing on its four corners, and each level mounts one more piece on a corner and dresses it up (D86) — level 2 its data outlet, then (placeholders for now) the expertise archive and the grid station. Code and docs keep the id and the name "Hearth" (older docs say "the Heart"); only the displayed name changed. From level 2, once Analytics' « Traitement des données » is researched, it also makes data files out of what goes on at the base, and hands them out of its one outlet: the only thing it ever gives.
- **Drones** build remotely ("kites" in older texts and code comments: `remoteBuildDelay`, the construction delay off the claim's land). They lay ribbons, poles and beacons across land the claim does not hold, never across a sister claim's; machines and stores stand on the claim's own parcels.
- **Research** (D68–D70): a **research lab** (« laboratoire de recherche ») is an automated station. It runs on two things: **data**, real items carried on ribbons, one more kind each tier (D71): « Données d'arpentage » (Survey Data, made by powered data collectors and, with analysis, by the Core), « Données mécaniques » (Mechanics Data, from the test bench, where the base load-tests its own parts), then Atlas and Codex; and **AI tokens**, compute the research uses as it runs. Tokens are not owned: they are paid by the minute when used, to CrierBelt's servers for now (later a market with the other claims that run servers), or made by the claim's own servers. Say « token » in French too, never « jeton ». Research comes in **tiers** (T1–T4) and **families** whose names grow with the tier (Commerce: Échange, Finance, Économie de marché); a family splits into specialities from T3 (Machines: Électronique or Mécanique). A research node unlocks a machine or a feature, never a bare +15 %.
- **The land**: the claim's own parcels are the starting square, the parcels it bought for good and those it leases by the hour (« bail », « loyer »). A rent the purse cannot pay ends the lease (« Bail perdu »): the parcel goes back to its owner and what stands on it stops, nothing lost, until the claim holds it again.
- **Other buildings**: the trade post is CrierBelt's cargo lift pad (marked with the CrierBelt logo); the skydock is a mooring mast for uncrewed drifters.

## The market's actors

The forty simulated market actors (`colonies` in code: `src/content/colonies.ts`, `src/market`) are other CrierBelt partners' claims: **concessions sœurs** (sister claims). Their names (Port-Écume, Sept-Cornes…) are the names of those claims. Some of them own parcels near the player's claim (about one in eight past the ring round the starting square): they sell or lease them dearer than CrierBelt, and nothing of the player's may cross them until bought. In the UI, say « concessions sœurs » / "sister claims", never « colonies ».

## Words to use

| Say (FR · EN) | Not | Where |
|---|---|---|
| ta base · your base | ta colonie · your colony | Any text about the player's installation |
| concession · claim | — | The land grant, the player's name for it (`Sim.colonyName`) |
| le Cœur · the Core | le Foyer · the Hearth, the Heart | Displayed name of `hearth` |
| concessions sœurs · sister claims | colonies sœurs · sister colonies | The market's other actors |
| données d'arpentage, données mécaniques · Survey Data, Mechanics Data | carnets · journals | The science items (`journal_1`, `journal_2`; then `atlas`, `codex`) |
| laboratoire de recherche · research lab | observatoire · observatory | `observatory` (its id kept) |
| token · token | jeton | AI compute paid by the minute |
| drones | cerfs-volants · kites | Remote construction |
| vos terres · your land; parcelle · parcel | la zone (d'influence) · the zone | Where the claim may build: its parcels |
| bail, loyer, louer · lease, rent, lease (verb) | — | A parcel rented by the hour |

## Tone

Quiet and wide: lonely machines working a pastel desert under the wind, inked like a Moebius album. The human world reaches the base only as messages: CrierBelt's onboarding and objectives (the tutorial), the Gazette, the prices. Short texts, no melodrama.
