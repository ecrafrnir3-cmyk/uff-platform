import { createAdminClient } from "@/lib/supabase/admin";

const FROM = process.env.EMAIL_FROM ?? "UFF <onboarding@resend.dev>";
const RESEND_URL = "https://api.resend.com/emails";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[email] RESEND_API_KEY not set — skipping");
    return;
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[email] Resend API error:", res.status, text);
    }
  } catch (err) {
    // Email failures must never crash the calling action
    console.error("[email] send failed:", err);
  }
}

/**
 * Returns a map of userId → email for all users in the Supabase project.
 */
export async function getAllUserEmails(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const u of data.users) {
    if (u.id && u.email) map[u.id] = u.email;
  }
  return map;
}

/**
 * Get email for a single user by their auth user ID.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email;
}

// ── Email templates ───────────────────────────────────────────────────────────

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0d0d1a;
  color: #f4f4f8;
  max-width: 560px;
  margin: 0 auto;
  padding: 32px 24px;
`;

const linkStyle = `color: #0057FF; text-decoration: underline;`;
const goldStyle = `color: #FFD700; font-weight: 700;`;
const mutedStyle = `color: #a0a0b8; font-size: 13px;`;

export function tradeProposedHtml({
  leagueId,
  leagueName,
  proposerTeamName,
  proposerPlayers,
  receiverPlayers,
}: {
  leagueId: string;
  leagueName: string;
  proposerTeamName: string;
  proposerPlayers: string[];
  receiverPlayers: string[];
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/trade`;
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#0057FF;margin:8px 0 16px;">New Trade Offer</h2>
    <p><strong>${proposerTeamName}</strong> has sent you a trade offer in <strong>${leagueName}</strong>.</p>
    <p><strong>They offer:</strong> ${proposerPlayers.join(", ") || "—"}</p>
    <p><strong>They want:</strong> ${receiverPlayers.join(", ") || "—"}</p>
    <p style="margin-top:24px;"><a href="${url}" style="${linkStyle}">Review the offer →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Trade notification.</p>
  </div>`;
}

export function tradeRespondedHtml({
  leagueId,
  leagueName,
  responderTeamName,
  accepted,
  pendingReview,
}: {
  leagueId: string;
  leagueName: string;
  responderTeamName: string;
  accepted: boolean;
  pendingReview?: boolean;
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/trade`;
  const color = accepted ? "#3DDC84" : "#CC0000";
  const status = pendingReview
    ? "accepted (pending commissioner review)"
    : accepted ? "accepted ✅" : "rejected ❌";
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:${color};margin:8px 0 16px;">Trade ${accepted ? "Accepted" : "Rejected"}</h2>
    <p><strong>${responderTeamName}</strong> has <strong>${status}</strong> your trade offer in <strong>${leagueName}</strong>.</p>
    ${pendingReview ? '<p style="color:#FFD700;">The commissioner will review before rosters are updated.</p>' : ""}
    <p style="margin-top:24px;"><a href="${url}" style="${linkStyle}">View trade history →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Trade notification.</p>
  </div>`;
}

export function tradeVetoedHtml({
  leagueId,
  leagueName,
  reason,
}: {
  leagueId: string;
  leagueName: string;
  reason?: string | null;
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/trade`;
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#CC0000;margin:8px 0 16px;">Trade Vetoed</h2>
    <p>The commissioner has vetoed your trade in <strong>${leagueName}</strong>.</p>
    ${reason ? `<p style="color:#d4d4e8;font-style:italic;">"${reason}"</p>` : ""}
    <p style="margin-top:24px;"><a href="${url}" style="${linkStyle}">View trade history →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Trade notification.</p>
  </div>`;
}

export function newsletterHtml({
  leagueId,
  leagueName,
  week,
  content,
}: {
  leagueId: string;
  leagueName: string;
  week: number;
  content: string;
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}`;
  const body = content
    .split(/\n\n+/)
    .map((p) => `<p style="line-height:1.7;margin:0 0 16px;">${p.trim()}</p>`)
    .join("");
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#0057FF;margin:8px 0 4px;">${leagueName}</h2>
    <p style="${mutedStyle};margin:0 0 24px;">Week ${week} Newsletter · The Oracle Speaks</p>
    <div style="border-left:3px solid #FFD700;padding-left:16px;">${body}</div>
    <p style="margin-top:24px;"><a href="${url}" style="${linkStyle}">View league →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Weekly newsletter.</p>
  </div>`;
}
