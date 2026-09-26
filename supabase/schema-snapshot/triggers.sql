-- UFF trigger snapshot: user-defined triggers in the live DB (project synfuvgdamhjboobjmls).
-- Started 2026-09-26 with the first one (#77 / A1-02); NOT a migration — disaster-recovery
-- source of truth alongside functions.sql and policies.sql.

CREATE TRIGGER player_draft_powers_guard_manager_updates
  BEFORE UPDATE ON public.player_draft_powers
  FOR EACH ROW EXECUTE FUNCTION public.player_draft_powers_guard_manager_updates();
