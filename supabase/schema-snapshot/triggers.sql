-- UFF trigger snapshot: generated 2026-09-26 by scripts/snapshot-schema.mjs from the live DB
-- (project synfuvgdamhjboobjmls). NOT a migration — disaster-recovery source of truth. Regenerate after
-- every migration; never hand-edit.

CREATE TRIGGER enforce_faction_balance BEFORE INSERT OR UPDATE OF faction ON public.league_members FOR EACH ROW EXECUTE FUNCTION check_faction_balance();

CREATE TRIGGER league_members_lock_faction_after_draft BEFORE UPDATE OF faction ON public.league_members FOR EACH ROW EXECUTE FUNCTION league_members_lock_faction_after_draft();

CREATE TRIGGER player_draft_powers_guard_manager_updates BEFORE UPDATE ON public.player_draft_powers FOR EACH ROW EXECUTE FUNCTION player_draft_powers_guard_manager_updates();

CREATE TRIGGER trg_clear_lineup_on_roster_exit AFTER UPDATE ON public.uff_roster_players FOR EACH ROW EXECUTE FUNCTION clear_lineup_on_roster_exit();
