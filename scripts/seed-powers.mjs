// Seeds each legend's Signature Power + Ultimate onto uff_characters.
// Source of truth: lore/powers.md. Run: node scripts/seed-powers.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .replace(/^﻿/, "").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const POWERS = [
  { name: "Cassia Dawn", sig: "Dawnline",
    sigEff: "Every Vanguard ally in her sightline fights with first-light clarity — steadier nerves, unbroken formation, cleaner reads — and the effect deepens each turn she keeps her feet on the field. It is presence, not force: she does not hit harder, she makes everyone around her miss less.",
    ult: "Breaking Dawn",
    ultEff: "Once a season she calls the sunrise; the further the Vanguard is trailing, the more blinding the light, wiping the enemy's built momentum and re-setting the field to even in proportion to the deficit. Barely a flicker when her side leads, a total tempo reversal when they are near collapse — then she is spent and the field is ordinary again." },
  { name: "Titus Vale", sig: "Ironset",
    sigEff: "He sets himself as a living wall and absorbs the damage aimed at anyone behind him, the plating thickening the longer he refuses to give ground. Hold the line long enough and almost nothing gets through him — but the instant he moves, the hardness resets to nothing.",
    ult: "The Last Rampart",
    ultEff: "When the Vanguard is being overrun he raises a rampart whose height is measured by the deficit — the worse the rout, the taller the wall — stopping exactly one enemy wave cold. Trivial as a lead-holder, a battle-saving bulwark when they are drowning; it crumbles the moment it has served, once per season." },
  { name: "Juno Reyes", sig: "Skybreak",
    sigEff: "She acts a full beat before anyone can answer — her strikes and breaks land first, and each clean tempo she wins sharpens her edge a fraction further, down to a hard floor she cannot pass. Pure initiative: she is not stronger, she is simply already there. But the instant an opponent steals a tempo back from her, the sharpening resets to nothing and she must build it again from the start.",
    ult: "Terminal Velocity",
    ultEff: "Once a season she collapses the distance between where the Vanguard is and where they need to be, the acceleration scaling to how far behind they are — a shrug of extra pace with a lead, a field-length blur that erases the gap when buried. One devastating burst, then her legs are gone for the season." },
  { name: "Marcus Kell", sig: "The Long Reckoning",
    sigEff: "He soaks punishment without breaking and grows steadier the longer a battle drags — every blow he endures leaves him harder to move, never weaker, so force spends itself against him while time stays on his side. This is the pure counter to Kord Malphas — Kord's power is one enormous hit, and Marcus is built to still be standing after it.",
    ult: "Attrition's End",
    ultEff: "When Marcus is nearly finished he calls in the toll he has absorbed and returns it as a single reckoning. The deficit is the gate that decides whether it fires at all: while the Vanguard is comfortable it throttles toward nothing no matter how much he has soaked. On the ropes it releases as an avalanche scaled to the beating he took — though never beyond the ceiling one man's banked punishment can hold — then the ledger is empty for the season." },
  { name: "Sana Okoye", sig: "Tidewarden",
    sigEff: "The tide turns for her exactly when it matters — routine moments run flat and ordinary, but as the finish closes in she rises with it, hands steady while the water is at everyone else's throat. The same rising tide that drowns other players is the water she was built to stand in. She is the standing answer to Delphine Roe, the one player rigged odds cannot fully account for.",
    ult: "The Turning Tide",
    ultEff: "Once a season, in a closing moment with the Vanguard behind, she guarantees a single decisive play — one hinge the battle can turn on, not the battle itself — and the longer the odds stacked against it, the larger the swing it delivers. A footnote if her side already leads, a stolen chance at victory when they are losing; called once, then never again that season." },
  { name: "Eli Thorne", sig: "Oathkeeper",
    sigEff: "Every vow he speaks aloud becomes binding — a promise to hold a line, to reach a mark, to strike a foe hardens into real force that will not let him fall short of his word. Honor as a load-bearing structure; he cannot be knocked off an oath he has sworn.",
    ult: "The Kept Oath",
    ultEff: "Once a season, with the Vanguard losing, he calls due every oath still owed to him across the field — not as raw force but as position: the sworn are pulled back to their marks and locked into the roles they promised, the reach of it scaling to how far his side has fallen. Slight when they are ahead and few debts stand, a whole line re-set to its word when they are buried — collected once, then the slate is clear for the season." },
  { name: "Rook Callahan", sig: "The Undrafted",
    sigEff: "He carries no gift but refusal — intimidation, fear, and reputation slide off him, and he climbs back up from hits that would put others down for good. Grit as its own power: he cannot be made to believe he is beaten.",
    ult: "Nothing To Lose",
    ultEff: "Once a season, for one decisive stretch, Rook simply cannot be put down — no hit removes him, no deficit makes him fold — and the more thoroughly the Vanguard has been written off, the longer that refusal holds and the further it spreads to the men beside him, allies who should have fallen staying on their feet through the closing sequence. Called once, then the well of it is dry for the season." },
  { name: "Lyra Vann", sig: "The Signal",
    sigEff: "She reads intent a beat before it moves — the opponent's true next action surfaces to her just early enough to answer it. Foresight as clean reception; she plays against what is coming, not what has happened. She is the direct counter to Nyx Sable, whose feints are the static her signal is built to cut through.",
    ult: "Clear Signal",
    ultEff: "Once a season, with the Vanguard behind, she burns off every layer of deception and noise on the field and shows her whole side the truth of it — the scale of the revelation growing with how badly they've been misled and how far they trail. Minor when they lead, a complete lifting of the fog when they're lost in it; used once, then the static returns for the season." },
  { name: "Brother Amos", sig: "The Shepherd",
    sigEff: "He guides allies clear of danger — repositioning the exposed, steadying the faltering, so no Vanguard soul strays alone into a trap while he watches the field. Guidance as literal shelter; his people do not get picked off. He stands against Saint Vega, the false shepherd whose gilded promises lure the same flock away.",
    ult: "The Gathering",
    ultEff: "Once a season, with the Vanguard scattered and losing, he calls the strayed and the fallen back into formation, the number he can gather scaling to how broken the line has become. Almost nothing when the ranks are whole, a full reforming of a shattered side when they are routed — called once, then he cannot gather them again that season." },
  { name: "Gideon Frost", sig: "The Last Stand",
    sigEff: "Alone among the twenty, his comeback is his everyday power: his strength scales inversely to his side's standing in every single battle, so the closer the Vanguard is to defeat, the more devastating he becomes — a quiet role player with a lead, a monster on the brink. He is the nightmare of Countess Mave, who feeds on others' weakness only to find his own weakness feeds him instead.",
    ult: "Zero Hour",
    ultEff: "Once a season, at the very edge of total annihilation, his signature reaches its absolute expression — near-certain defeat converts into one overwhelming stand whose force is the mirror of how completely his side was about to lose. Unusable with any cushion at all; only a hair from the end does it detonate, and only once." },
  { name: "Roman Slate", sig: "The Dynasty",
    sigEff: "Every advantage he takes compounds into the next — leads snowball and order entrenches — but the climb flattens as it rises, each new gain smaller than the last against a ceiling he cannot pass, and the moment the Dominion falls behind the whole edifice begins to crumble, the accrued snowball bleeding away until he claws the lead back. Dominance that feeds on itself, yet far easier to beat early than late. His whole architecture is the antithesis of Cassia Dawn's fresh start — established order against first light.",
    ult: "Reckoning Of Kings",
    ultEff: "Once a season, when the Dominion is unexpectedly losing, he reasserts the old order and reclaims ground in proportion to how far the upstarts have pushed him back. Toothless when he already rules, a crushing restoration when his dynasty is genuinely threatened — invoked once, then the crown cannot call it again that season." },
  { name: "Vesper Kane", sig: "The Reaching Hand",
    sigEff: "She strips power straight out of an opponent's hands mid-motion and wears it as her own for a breath before it fades. Theft as tempo — every possession is a loan she can call in. Her one bad matchup is Ezra Cain, the warden she turned — the one man who can seal a possession un-stealable and shut the very hands she works.",
    ult: "The Great Theft",
    ultEff: "Once a season, with the Dominion behind, she steals the opposing side's accumulated momentum wholesale, the haul scaling to how large a lead they had built against her. A pickpocket's trifle when she's ahead, a total heist of a winning team's advantage when she's losing — pulled once, then she cannot lift it again that season." },
  { name: "Silas Vane", sig: "The Rust King",
    sigEff: "Everything he touches corrodes — enemy armor, defenses, and structure degrade a little more with every exchange, weakening the longer he is near it. Decay as slow certainty; what he cannot break he simply ruins. He is the brother-poison to Titus Vale: iron is exactly what rust was made to eat.",
    ult: "Total Corrosion",
    ultEff: "Once a season, with the Dominion losing, he accelerates the rot across the whole field at once, stripping enemy defenses in proportion to how far behind he trails. A faint tarnish when he leads, a battlefield of collapsing armor when he's being beaten — released once, then the rust runs no faster that season." },
  { name: "Kord Malphas", sig: "The Breaker",
    sigEff: "Raw, unsubtle force — he drives straight through defenses that were built to hold, and each barrier he shatters lends weight to the next push. Nothing about him is finesse; he is the wall's answer. He crashes forever against Marcus Kell, the one man built to still be standing after the biggest hit lands.",
    ult: "Breaking Point",
    ultEff: "Once a season, with the Dominion behind, he winds up one blow that doesn't batter but annihilates — it takes the enemy's single strongest defensive structure off the field entirely for the battle, and the deeper the deficit the larger the bulwark it can break. A shoved-aside barricade when he's ahead, the collapse of their whole anchor when he's buried; thrown once, then he has nothing left of it that season." },
  { name: "Nyx Sable", sig: "The Whisper",
    sigEff: "She sows false signals — feints, misdirection, planted reads — so opponents commit to the wrong answer and never see the real one until too late. Deception as a fog she controls. She is Lyra Vann's opposite number: her whole craft is generating the noise Lyra's signal is built to pierce.",
    ult: "The Long Con",
    ultEff: "Once a season, with the Dominion losing, she reveals the entire battle to have been a setup and springs it, the reversal scaling to how confidently the enemy had committed to their lead. A cheap trick when she's ahead, a total inversion of a winning position when she's behind — sprung once, then the con is burned for the season." },
  { name: "Ezra Cain", sig: "The Fallen Warden",
    sigEff: "He seals a possession shut so it cannot be stripped — the ball, the position, the advantage held under a warden's grip that theft simply slides off of. He spent years guarding the Vanguard's vault and never forgot how to make a thing unstealable; now he turns that discipline against every hand reaching in. He is Vesper Kane's direct counter: her whole craft is the turnover, and his is the possession that refuses to turn over.",
    ult: "The Knife's Turn",
    ultEff: "Once a season, with the Dominion losing, he engineers a betrayal that turns an enemy asset to his side for the rest of the battle — never a moment longer, the loyalty snapping back the instant the fighting ends — its value scaling to how commanding the lead he's clawing at. A minor defection when he's ahead, the theft of a keystone when he's losing — turned once, then no one else will follow him across that season." },
  { name: "Countess Mave", sig: "The Long Thirst",
    sigEff: "She drains strength directly from opponents, growing stronger exactly as they weaken, so a long engagement bleeds them into her. Siphon as slow inevitability — she does not overpower, she outlasts by taking. Her one bad matchup is Gideon Frost, whose strength rises the more she drains him.",
    ult: "Last Drop",
    ultEff: "Once a season, with the Dominion behind, she drains the single strongest enemy on the field, the amount taken scaling to how far she trails. A sip when she leads, a near-total exsanguination of their best when she's losing — drawn once, then she cannot feed like that again for the season." },
  { name: "Saint Vega", sig: "The Gilded",
    sigEff: "He hoards — accumulating resource and advantage, and dangling gilded promises that tempt wavering allies to defect toward him. Greed as gravity; everything of value drifts to his pile. He is the counterfeit of Brother Amos, a false shepherd whose flock is bought, not guided.",
    ult: "Reckoning Of Gold",
    ultEff: "Once a season, with the Dominion losing, he cashes out to buy the battle back — the payout set first and foremost by how far behind his side has fallen, the hoard he sits on only sweetening it within a fixed ceiling and never enough on its own to matter while he's comfortable. A trinket's worth when he's ahead however deep his coffers, a fortune spent against a lost battle when he's behind — spent once, then the coffers are empty for the season." },
  { name: "Dr. Orin Pyre", sig: "The Ashing",
    sigEff: "A slow pyre burns around him — powers brought near it gutter and misfire, dragged down a steady degree while they sit in the heat; and once per battle he can snuff a single ability outright, smothering it for a few beats before it catches again. Suppression as hard counter — he does not delete your strength, he starves it of air — and he cannot smother the same power twice in a row. He is the answer key to every gift on the board, though every gift comes back.",
    ult: "Ashfall",
    ultEff: "Once a season, with the Dominion losing, he lets the pyre swell and takes the enemy's strongest active power to ash for the rest of the battle, the reach of it scaling to how far behind he trails. A faint smother when he's ahead, the total burning-out of the opposition's best weapon when he's losing — invoked once, then the field cools to normal for the season." },
  { name: "Delphine Roe", sig: "The Oddsmaker",
    sigEff: "She sets the odds and bends them her way — near-misses become makes for the Dominion, coin-flips land on her call, the improbable quietly favors her side. Fate as a tilted table. Her constant frustration is Sana Okoye, the one clutch player who keeps hitting the shot the odds forbid.",
    ult: "House Always Wins",
    ultEff: "Once a season, with the Dominion behind, she calls in the long-shot and forces it to land, the size of the payout scaling to how steep the deficit she's betting against. A rounding error when she leads, a miraculous against-the-odds swing when she's losing — called once, then the house closes its book for the season." },
];

let ok = 0, miss = 0;
for (const p of POWERS) {
  const { data, error } = await admin
    .from("uff_characters")
    .update({ signature_name: p.sig, signature_effect: p.sigEff, ultimate_name: p.ult, ultimate_effect: p.ultEff })
    .eq("name", p.name)
    .select("id, name");
  if (error) { console.error("ERR", p.name, error.message); miss++; }
  else if (!data || data.length === 0) { console.error("NO MATCH for", p.name); miss++; }
  else { ok++; }
}
console.log(`Powers seeded: ${ok} ok, ${miss} missed (of ${POWERS.length}).`);
if (miss > 0) process.exit(1);
