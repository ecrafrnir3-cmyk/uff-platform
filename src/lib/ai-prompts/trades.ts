// Prompts, requests and reply reading for the three trade call sites, moved verbatim out of their
// files on 2026-11-10 so the model evaluation in tools/qa builds exactly what each one sends:
//   /api/trade-eval (Trade Evaluator), /api/trade-veto-analysis (commissioner Veto Analyzer), and the
//   Oracle analysis in proposeTrade (dashboard/league/[id]/trade-actions.ts) that goes into the email.
// The callers gather the rows and call these; tools/qa/check-parity.mjs proves they agree byte for
// byte. Pure: no database, no network, no clock.
import { getRecord, type CompletedMatchupRow } from "@/lib/get-record";

type PlayerInfo = { full_name: string; position: string | null; team: string | null };

// ── /api/trade-eval ───────────────────────────────────────────────────────────

export interface TradeEvalInputs {
  me: { id: string; team_name: string; faction: string | null };
  partner: { id: string; team_name: string; faction: string | null };
  playerRows: ({ id: string } & PlayerInfo)[] | null;
  allMatchups: CompletedMatchupRow[] | null;
  proposerPlayerIds: string[];
  receiverPlayerIds: string[];
}

export function buildTradeEvalPrompt({ me, partner, playerRows, allMatchups, proposerPlayerIds, receiverPlayerIds }: TradeEvalInputs): string {
    const playerMap: Record<string, { full_name: string; position: string | null; team: string | null }> = {};
    for (const p of (playerRows ?? [])) playerMap[p.id] = p;

    const rows = allMatchups ?? [];
    const myRecord = getRecord(me.id, rows);
    const partnerRecord = getRecord(partner.id, rows);

    const formatPlayers = (ids: string[]) =>
      ids.map((id) => {
        const p = playerMap[id];
        return p ? `${p.full_name} (${p.position ?? "?"}, ${p.team ?? "FA"})` : id;
      }).join(", ");

    const mySide = formatPlayers(proposerPlayerIds);
    const theirSide = formatPlayers(receiverPlayerIds);

    const prompt = `You are the Oracle of Ultimate Fantasy Football — a precise trade analyst who cuts through spin and tells it straight.

Trade details:
- ${me.team_name} [${me.faction ?? "?"}] (${myRecord.wins}W-${myRecord.losses}L) SENDS: ${mySide}
- ${partner.team_name} [${partner.faction ?? "?"}] (${partnerRecord.wins}W-${partnerRecord.losses}L) SENDS BACK: ${theirSide}

Evaluate this trade in 3-4 sentences. State who benefits more and why — consider position scarcity, roster construction, playoff implications given each team's record, and overall value balance. End your response with a single verdict line formatted exactly as one of: VERDICT: FAIR | VERDICT: SLIGHT EDGE TO [team name] | VERDICT: AVOID — [team being fleeced] is getting robbed`;

    return prompt;
}

export function tradeEvalRequest(prompt: string) {
  return {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readTradeEvalReply(resData: any): string {
  return resData.content?.[0]?.text ?? "";
}

// ── /api/trade-veto-analysis ──────────────────────────────────────────────────

export interface TradeVetoInputs {
  trade: { proposer_id: string; receiver_id: string; proposer_player_ids: string[]; receiver_player_ids: string[] };
  playerRows: ({ id: string } & PlayerInfo)[] | null;
  proposerMember: { team_name: string; faction: string | null } | null;
  receiverMember: { team_name: string; faction: string | null } | null;
  allMatchups: CompletedMatchupRow[] | null;
}

export function buildTradeVetoPrompt({ trade, playerRows, proposerMember, receiverMember, allMatchups }: TradeVetoInputs): string {
    const playerMap: Record<string, { full_name: string; position: string | null; team: string | null }> = {};
    for (const p of playerRows ?? []) playerMap[p.id] = p;

    const rows = allMatchups ?? [];
    const proposerRecord = getRecord(trade.proposer_id, rows);
    const receiverRecord = getRecord(trade.receiver_id, rows);

    const formatPlayers = (ids: string[]) =>
      ids.map(id => {
        const p = playerMap[id];
        return p ? `${p.full_name} (${p.position ?? "?"}, ${p.team ?? "FA"})` : id;
      }).join(", ");

    const proposerTeam = proposerMember?.team_name ?? "Team A";
    const receiverTeam = receiverMember?.team_name ?? "Team B";

    const prompt = `You are advising a fantasy football commissioner on whether to APPROVE or VETO this trade. Be direct and fair.

${proposerTeam} [${proposerMember?.faction ?? "?"}] (${proposerRecord.wins}W-${proposerRecord.losses}L) SENDS: ${formatPlayers(trade.proposer_player_ids)}
${receiverTeam} [${receiverMember?.faction ?? "?"}] (${receiverRecord.wins}W-${receiverRecord.losses}L) SENDS BACK: ${formatPlayers(trade.receiver_player_ids)}

Evaluate in 2-3 sentences: Is this trade reasonably fair, or does one team clearly get fleeced? Consider position value, player quality, record context, and competitive balance. Then give your verdict on its own line:

VERDICT: APPROVE — [one-sentence reason]
or
VERDICT: VETO — [one-sentence reason]`;

    return prompt;
}

export function tradeVetoRequest(prompt: string) {
  return {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readTradeVetoReply(resData: any): string {
  return resData.content?.[0]?.text ?? "";
}

// Extract verdict
export function tradeVetoVerdict(analysis: string): "APPROVE" | "VETO" | null {
    const verdictMatch = analysis.match(/VERDICT:\s*(APPROVE|VETO)/i);
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() as "APPROVE" | "VETO" : null;
    return verdict;
}

// ── proposeTrade's Oracle analysis (trade-actions.ts → the receiver's email) ───

export interface ProposeTradeAnalysisInputs {
  proposer: { id: string; team_name: string | null; faction: string | null };
  receiverId: string;
  receiverMember: { team_name: string | null; faction: string | null } | null;
  allMatchups: CompletedMatchupRow[] | null;
  pNames: string[];
  rNames: string[];
}

export function buildProposeTradeAnalysisPrompt({ proposer, receiverId, receiverMember, allMatchups, pNames, rNames }: ProposeTradeAnalysisInputs): string {
        const rows = allMatchups ?? [];
        const proposerRecord = getRecord(proposer.id, rows);
        const receiverRecord = getRecord(receiverId, rows);

        const proposerTeam = proposer.team_name ?? "Team A";
        const receiverTeam = receiverMember?.team_name ?? "Team B";

        const prompt = `You are the Oracle of Ultimate Fantasy Football. Evaluate this trade briefly.

${proposerTeam} [${proposer.faction ?? "?"}] (${proposerRecord.wins}W-${proposerRecord.losses}L) SENDS: ${pNames.join(", ")}
${receiverTeam} [${receiverMember?.faction ?? "?"}] (${receiverRecord.wins}W-${receiverRecord.losses}L) SENDS BACK: ${rNames.join(", ")}

2-3 sentence analysis only. Who benefits more and why? End with exactly one of: VERDICT: FAIR | VERDICT: SLIGHT EDGE TO [team name] | VERDICT: AVOID — [team name] is getting robbed`;

        return prompt;
}

export function proposeTradeAnalysisRequest(prompt: string) {
  return {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }],
          };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readProposeTradeAnalysisReply(aiData: any): string | undefined {
  return aiData.content?.[0]?.text ?? undefined;
}
