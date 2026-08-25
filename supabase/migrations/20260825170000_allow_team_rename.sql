-- APPLIED LIVE 2026-08-25 via Supabase MCP. Self-serve team rename.
--
-- The RLS hardening (20260825150000) revoked table UPDATE on league_members and
-- granted only (faction), which left no way for a manager to change their team
-- name (there was never a rename feature). Grant the team_name column too — a
-- harmless cosmetic self-edit on the user's own row (the "users can update their
-- own membership" policy scopes it). faab_balance / waiver_priority /
-- character_id / is_commissioner remain non-user-writable.
-- Paired with the renameTeam server action + RenameTeam UI on the league hub.
-- Verified: a regular member can update team_name; faab_balance still denied.

GRANT UPDATE (team_name) ON public.league_members TO authenticated;
