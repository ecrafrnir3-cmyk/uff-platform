// Canonical UFF character roster (season 1). Source of truth mirrors the Notion
// writers' room. Run: node scripts/seed-characters.mjs  (upserts into uff_characters).
// secret_story is stored but NOT surfaced in the app yet (hidden-dossier is a later feature).
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

export const CHARACTERS = [
  // ── The Vanguard (Heroes / AFC) ──
  { id: 1, faction: "hero", name: "Cassia Dawn", epithet: "The First Light", domain: "Leadership · Rallying",
    starter_story: "When the Dominion first broke the line, it was Cassia who stood in the gap and would not yield — not with strength, but with a refusal to let anyone beside her give up. They say the Vanguard didn't exist until the morning she named it. Where she looks, others find their courage.",
    secret_story: "The light costs her. Every rally she leads burns a year she'll never get back — and she has far fewer left than anyone knows." },
  { id: 2, faction: "hero", name: "Titus Vale", epithet: "The Ironhide Sentinel", domain: "Defense · Protection",
    starter_story: "A lineman who threw himself in front of a game-ending hit and woke with skin like iron. He asks for no glory — he simply stands between the Dominion and everything it wants to take. Where Titus plants his feet, the line holds.",
    secret_story: "The iron is spreading. Every battle hardens him and numbs a little more of what made him human — and he's started to forget his own brother's face." },
  { id: 3, faction: "hero", name: "Juno Reyes", epithet: "The Skybreaker", domain: "Speed · Fearlessness",
    starter_story: "Faster than doubt. Juno runs straight at the thing everyone else flinches from, and she has never once looked back to see if it worked. The Dominion can scheme all it likes — you can't trap what you can't catch.",
    secret_story: "She runs because standing still is when the memories catch her. One of them is a teammate she left behind, and couldn't save." },
  { id: 4, faction: "hero", name: "Marcus Kell", epithet: "The Long Reckoning", domain: "Endurance · Resurgence",
    starter_story: "They wrote Marcus off three times. Three times he came back older, slower, and somehow harder to beat. He is the proof the Dominion fears most: that being knocked down is not the same as being finished.",
    secret_story: "He knows exactly which season will be his last — a Dominion oracle told him — and he has chosen to spend it, not hoard it." },
  { id: 5, faction: "hero", name: "Sana Okoye", epithet: "The Tidewarden", domain: "Composure · Clutch",
    starter_story: "While everyone else drowns in the fourth quarter, Sana breathes. She's the stillness at the center of every comeback, the hand that steadies the huddle when the scoreboard says it's over. The bigger the moment, the calmer she gets.",
    secret_story: "The calm isn't natural — she built it, brick by brick, after a loss that nearly broke her. Some nights the panic she buried claws its way back up." },
  { id: 6, faction: "hero", name: "Eli Thorne", epithet: "The Oathkeeper", domain: "Fairness · Judgment",
    starter_story: "Eli believes the game means nothing if it isn't played true. He remembers every promise made and broken, and he has never once bent a rule to win — which is exactly why the Dominion can't corrupt him and can't stand him.",
    secret_story: "He broke one oath, long ago, and someone died for it. Every rule he keeps now is penance for the one he didn't." },
  { id: 7, faction: "hero", name: "Rook Callahan", epithet: "The Undrafted", domain: "Grit · Proving Grounds",
    starter_story: "Nobody wanted Rook. No pedigree, no highlight reel, no invitation. He built himself out of every \"no\" he ever got, and now the legends who passed him over have to line up across from him. He plays like a man with everything to prove, because he is.",
    secret_story: "The chip on his shoulder is the only thing holding him together — and he's quietly terrified of what he becomes the day he finally has nothing left to prove." },
  { id: 8, faction: "hero", name: "Lyra Vann", epithet: "The Signal", domain: "Intelligence · Foresight",
    starter_story: "Lyra sees the play before it's called. She reads the field like a language only she speaks, turning the Dominion's own patterns into the trap that catches them. Knowledge, in her hands, is a weapon.",
    secret_story: "She once saw a disaster coming and said nothing, because the warning would have cost her everything. It happened anyway. She's been paying for the silence ever since." },
  { id: 9, faction: "hero", name: "Brother Amos", epithet: "The Shepherd", domain: "Guidance · Faith",
    starter_story: "Every hero in the Vanguard was, at some point, a lost kid Amos refused to give up on. He doesn't take the field for glory — he takes it to bring everyone home. The Dominion has never understood why his people fight so hard; it's because he taught them they were worth fighting for.",
    secret_story: "One of the lost kids he saved grew up to join the Dominion — and Amos has never told a soul that he still prays for them by name." },
  { id: 10, faction: "hero", name: "Gideon Frost", epithet: "The Last Stand", domain: "Defiance · Resolve",
    starter_story: "Gideon is at his most dangerous when the scoreboard says he's already lost. He does not know how to break. Down four scores with a minute left is not, to Gideon, a reason to stop — it's the reason he showed up.",
    secret_story: "He chases lost causes because the one time it mattered most, he quit — and a whole team paid for it. Every game since has been an attempt to become the man he wasn't that day." },

  // ── The Dominion (Villains / NFC) ──
  { id: 11, faction: "villain", name: "Roman Slate", epithet: "The Dynasty", domain: "Reign · Establishment",
    starter_story: "Roman has won so many times that winning bores him; what he wants now is for everyone to accept that it could never have gone any other way. He is the establishment made flesh — the throne the whole Vanguard exists to topple. He does not fear rebellion. He collects rebels.",
    secret_story: "The dynasty is hollow — he hasn't truly felt anything in years — and he's begun, in private, to hope someone is finally good enough to take it all from him." },
  { id: 12, faction: "villain", name: "Vesper Kane", epithet: "The Turnover Queen", domain: "Theft · Turnovers",
    starter_story: "She learned young that you don't have to earn a thing you can simply take — a fumble, a pick, a stolen moment of momentum. Charming, patient, merciless. She doesn't beat you; she lets you beat yourself, then collects.",
    secret_story: "She wore Vanguard colors once. One betrayal made her what she is — and she remembers exactly who did it." },
  { id: 13, faction: "villain", name: "Silas Vane", epithet: "The Rust King", domain: "Corrosion · Decay",
    starter_story: "Where his brother Titus turned to iron to protect, Silas let the iron rot — and learned that rust spreads faster than steel ever holds. He doesn't want to beat the Vanguard. He wants to watch it corrode from the inside, one small compromise at a time.",
    secret_story: "He'd trade the whole Dominion for one morning back, before the hit that split him and Titus apart — and he'll never admit it, least of all to himself." },
  { id: 14, faction: "villain", name: "Kord Malphas", epithet: "The Breaker", domain: "Force · Fear",
    starter_story: "Kord doesn't scheme and Kord doesn't gloat. Kord finds the thing you rely on, breaks it, and lets the fear of him do the rest. The Dominion keeps him on a short leash — not to control him, but because they're afraid of him too.",
    secret_story: "He feels every hit he delivers echoed back into himself — a curse he never speaks of. The fear everyone has of him is nothing next to his fear of stopping, because stopping means feeling all of it at once." },
  { id: 15, faction: "villain", name: "Nyx Sable", epithet: "The Whisper", domain: "Deception · Misinformation",
    starter_story: "You never hear Nyx coming; you only notice, later, that everything you believed was something she wanted you to. She turns locker rooms against themselves and calls it art. The Vanguard's greatest strength is trust — which is exactly why she targets it.",
    secret_story: "Every lie she tells is a wall against one true thing she can't face — and Lyra Vann is the only person alive who's glimpsed what's behind it." },
  { id: 16, faction: "villain", name: "Ezra Cain", epithet: "The Fallen Warden", domain: "Betrayal · Ruin",
    starter_story: "Ezra was Vanguard once — one of the very best. Then he decided the war was already lost and chose the winning side while there was still time. He calls it wisdom. Everyone he left behind calls it what it was.",
    secret_story: "He didn't defect out of cowardice — he did it to protect someone the Vanguard was about to sacrifice. He's carried that truth alone, because confessing it wouldn't undo what it cost Vesper Kane." },
  { id: 17, faction: "villain", name: "Countess Mave", epithet: "The Vampire", domain: "Siphon · Parasitism",
    starter_story: "Mave has never had a great season of her own — she doesn't need one. She feeds on everyone else's, skimming a little glory here, a little momentum there, growing strong on borrowed brilliance. By the time you notice what's missing, it's already hers.",
    secret_story: "She's siphoned for so long she no longer remembers what she was ever good at herself — and that emptiness is the one hunger she can never fill." },
  { id: 18, faction: "villain", name: "Saint Vega", epithet: "The Gilded", domain: "Greed · Vanity",
    starter_story: "Everything Vega touches turns to spectacle — and everything the spectacle touches, he keeps. He plays for the highlight, the record, the statue. He genuinely cannot understand why anyone would fight for something as worthless as each other. Glory shared, to Vega, is glory wasted.",
    secret_story: "The roar of the crowd is the only thing that quiets the voice telling him he's nothing — and that voice is getting louder every year." },
  { id: 19, faction: "villain", name: "Dr. Orin Pyre", epithet: "The Negation", domain: "Nullification",
    starter_story: "Pyre doesn't build; he unmakes. Give him your greatest strength and he'll show you how it becomes the reason you lose. He believes every hero is just a flaw that hasn't been found yet — and finding the flaw is the only thing that makes him feel alive.",
    secret_story: "He became the man who erases greatness because he could never create any of his own — and he has never once stopped hating himself for it." },
  { id: 20, faction: "villain", name: "Delphine Roe", epithet: "The Oddsmaker", domain: "Fate · The Deal",
    starter_story: "Delphine doesn't cheat — she simply always knows how it ends, and bets accordingly. She trades in fates: whisper her your ambition and she'll name its price. The Dominion's cruelest trick is that half its members signed her deal willingly.",
    secret_story: "She saw her own ending long ago and it terrified her — so now she spends her days making sure everyone else's arrives first." },
];

const { error } = await admin.from("uff_characters").upsert(CHARACTERS, { onConflict: "id" });
if (error) { console.error("seed failed:", error.message); process.exit(1); }
const { count } = await admin.from("uff_characters").select("*", { count: "exact", head: true });
console.log("seeded uff_characters; total rows:", count);
