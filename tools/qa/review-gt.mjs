// The ground-truth block the grader was shown for a case (kept here so review tools do not import
// eval.mjs, which runs a command on import).
export function groundTruthText(c) {
  if (!c.byeWeek) return null;
  const lines = [`- NFL teams on bye in week ${c.byeWeek}: ${c.byeTeams?.length ? c.byeTeams.join(', ') : 'none (or the week is not loaded)'}`];
  if (c.rosterZero) lines.push(`- This manager's active players who score 0 in week ${c.byeWeek} (team on bye, or no NFL team): ${c.rosterZero.length ? c.rosterZero.join('; ') : 'none'}`);
  if (c.site === 'waiver-intel') lines.push(`- The free agent being considered: ${c.targetZero ? `scores 0 in week ${c.byeWeek} (${c.targetZero})` : `plays in week ${c.byeWeek}`}`);
  return lines.join('\n');
}
