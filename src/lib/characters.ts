/**
 * Server-only helpers for casting managers as canon characters (the Hero/Villain
 * lore layer). Each manager is assigned one unique character of their faction
 * when they lock a side. Never throws — casting is non-critical to faction
 * selection, so a failure here must not break joining/faction flows.
 */
import { createAdminClient } from "@/lib/supabase/admin";

/** Supabase types a to-one embed as an array; normalize to the character's faction. */
function embeddedFaction(x: unknown): string | undefined {
  const o = Array.isArray(x) ? x[0] : x;
  return (o as { faction?: string } | null | undefined)?.faction;
}

/**
 * Ensure a member is cast as a character matching their (new) faction.
 * - faction null  -> clears their character
 * - already cast in the right faction -> no-op
 * - otherwise -> assigns a random character of that faction not taken in the league
 */
export async function syncCharacterForFaction(
  leagueId: string,
  memberId: string,
  faction: "hero" | "villain" | null
): Promise<void> {
  try {
    const admin = createAdminClient();

    if (!faction) {
      await admin.from("league_members").update({ character_id: null }).eq("id", memberId);
      return;
    }

    const { data: mem } = await admin
      .from("league_members")
      .select("character_id, uff_characters(faction)")
      .eq("id", memberId)
      .maybeSingle();

    const currentFaction = embeddedFaction(mem?.uff_characters);
    if (mem?.character_id && currentFaction === faction) return; // already correct

    const { data: pool } = await admin
      .from("uff_characters")
      .select("id")
      .eq("faction", faction);
    const poolIds = (pool ?? []).map((c) => c.id as number);

    // Retry loop: a partial UNIQUE index on (league_id, character_id) rejects a
    // concurrent duplicate draw with 23505 — re-read what's taken and pick again,
    // so a losing writer grabs a different character instead of duplicating.
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: takenRows } = await admin
        .from("league_members")
        .select("character_id")
        .eq("league_id", leagueId)
        .not("character_id", "is", null);
      const taken = new Set(
        (takenRows ?? [])
          .map((r) => r.character_id as number)
          .filter((id) => id !== mem?.character_id)
      );
      const available = poolIds.filter((id) => !taken.has(id));
      if (available.length === 0) {
        // No character of this faction remains — clear any stale (wrong-faction)
        // cast rather than leaving character_id pointing at the old faction.
        await admin.from("league_members").update({ character_id: null }).eq("id", memberId);
        return;
      }
      const pick = available[Math.floor(Math.random() * available.length)];
      const { error } = await admin
        .from("league_members")
        .update({ character_id: pick })
        .eq("id", memberId);
      if (!error) return;
      if (error.code !== "23505") {
        console.error("[characters] assign failed:", error.message);
        return;
      }
      // 23505: someone took `pick` between our read and write — loop and re-pick.
    }
    console.error("[characters] assign exhausted retries for member", memberId);
  } catch (err) {
    console.error("[characters] syncCharacterForFaction failed:", err);
  }
}

/**
 * Backfill: cast every member of a league who has a faction but no matching
 * character. Used after commissioner faction randomization.
 */
export async function syncAllCharactersForLeague(leagueId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("league_members")
      .select("id, faction, character_id, uff_characters(faction)")
      .eq("league_id", leagueId);
    for (const m of members ?? []) {
      const faction = m.faction as "hero" | "villain" | null;
      if (!faction) continue;
      const charFaction = embeddedFaction(m.uff_characters);
      if (m.character_id && charFaction === faction) continue;
      await syncCharacterForFaction(leagueId, m.id as string, faction);
    }
  } catch (err) {
    console.error("[characters] syncAllCharactersForLeague failed:", err);
  }
}
