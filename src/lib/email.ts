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
 * Paginates to handle >1000 users correctly.
 */
export async function getAllUserEmails(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const map: Record<string, string> = {};
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error || !data) break;
    for (const u of data.users) {
      if (u.id && u.email) map[u.id] = u.email;
    }
    if (data.users.length < 1000) break; // reached last page
    page++;
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
  aiAnalysis,
}: {
  leagueId: string;
  leagueName: string;
  proposerTeamName: string;
  proposerPlayers: string[];
  receiverPlayers: string[];
  aiAnalysis?: string;
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/trade`;
  const oracleBlock = aiAnalysis
    ? `<div style="margin:20px 0;padding:14px 16px;border-left:3px solid #FFD700;background:rgba(255,215,0,0.05);">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#FFD700;text-transform:uppercase;">🔮 Oracle&apos;s Trade Analysis</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#d4d4e8;font-style:italic;">${aiAnalysis}</p>
      </div>`
    : "";
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#0057FF;margin:8px 0 16px;">New Trade Offer</h2>
    <p><strong>${proposerTeamName}</strong> has sent you a trade offer in <strong>${leagueName}</strong>.</p>
    <p><strong>They offer:</strong> ${proposerPlayers.join(", ") || "—"}</p>
    <p><strong>They want:</strong> ${receiverPlayers.join(", ") || "—"}</p>
    ${oracleBlock}
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

export function waiverResultsHtml({
  leagueId,
  leagueName,
  week,
  awarded,
  rejected,
}: {
  leagueId: string;
  leagueName: string;
  week: number;
  awarded: { playerName: string; bidAmount: number }[];
  rejected: { playerName: string; bidAmount: number }[];
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/free-agents`;
  const awardedRows = awarded.map(
    (b) => `<tr><td style="padding:6px 0;color:#3DDC84;font-weight:700;">✓ Won</td><td style="padding:6px 12px;color:#f4f4f8;">${b.playerName}</td><td style="padding:6px 0;color:#f4f4f8;text-align:right;">$${b.bidAmount}</td></tr>`
  ).join("");
  const rejectedRows = rejected.map(
    (b) => `<tr><td style="padding:6px 0;color:#CC0000;">✗ Lost</td><td style="padding:6px 12px;color:#a0a0b8;">${b.playerName}</td><td style="padding:6px 0;color:#a0a0b8;text-align:right;">$${b.bidAmount}</td></tr>`
  ).join("");
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#0057FF;margin:8px 0 4px;">${leagueName}</h2>
    <p style="${mutedStyle};margin:0 0 24px;">Week ${week} Waiver Results</p>
    ${awarded.length > 0 || rejected.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;">
      ${awardedRows}${rejectedRows}
    </table>` : `<p style="color:#a0a0b8;">No bids were submitted for Week ${week}.</p>`}
    <p style="margin-top:24px;"><a href="${url}" style="${linkStyle}">View free agents →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Waiver wire notification.</p>
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

export function announcementHtml({
  leagueId,
  leagueName,
  title,
  body,
}: {
  leagueId: string;
  leagueName: string;
  title: string;
  body: string;
}) {
  const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/announcements`;
  const bodyHtml = body
    .split(/\n\n+/)
    .map((p) => `<p style="line-height:1.7;margin:0 0 14px;">${p.trim()}</p>`)
    .join("");
  return `<div style="${baseStyle}">
    <p style="${goldStyle}">⚡ Ultimate Fantasy Football</p>
    <h2 style="color:#0057FF;margin:8px 0 4px;">${leagueName}</h2>
    <p style="${mutedStyle};margin:0 0 20px;">📢 Commissioner Announcement</p>
    <div style="border-left:3px solid #FFD700;padding:12px 16px;background:rgba(255,215,0,0.05);margin-bottom:24px;">
      <p style="margin:0 0 10px;font-weight:700;font-size:16px;">${title}</p>
      <div style="font-size:14px;">${bodyHtml}</div>
    </div>
    <p><a href="${url}" style="${linkStyle}">View announcement →</a></p>
    <p style="${mutedStyle};margin-top:32px;">Ultimate Fantasy Football · Commissioner announcement.</p>
  </div>`;
}

export function onTheClockHtml({
  teamName,
  round,
  pickNo,
  totalPicks,
  leagueId,
}: {
  teamName: string;
  round: number;
  pickNo: number;
  totalPicks: number;
  leagueId: string;
}) {
  return `<div style="${baseStyle}">
    <p style="${goldStyle}; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 4px;">Ultimate Fantasy Football</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #FFD700; margin: 0 0 8px;">You're on the clock! ⏰</h1>
    <p style="margin: 0 0 16px; color: #f4f4f8;">It's <strong>${teamName}</strong>'s turn to pick.</p>
    <div style="border: 1px solid #2a2a40; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <p style="margin: 0 0 4px;"><span style="${goldStyle}">Round ${round}</span> &mdash; Pick <strong style="color: #f4f4f8;">${pickNo}</strong> of ${totalPicks}</p>
    </div>
    <a href="https://uff-platform.vercel.app/dashboard/league/${leagueId}/draft"
       style="display: inline-block; background: #FFD700; color: #0d0d1a; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
      Make Your Pick →
    </a>
    <p style="${mutedStyle}; margin-top: 24px;">Your clock is running — don't miss your turn.</p>
  </div>`;
}

export function leagueInviteHtml({
  leagueName,
  commissionerName,
  joinCode,
}: {
  leagueName: string;
  commissionerName: string;
  joinCode: string;
}) {
  return `<div style="${baseStyle}">
    <p style="${goldStyle}; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 4px;">Ultimate Fantasy Football</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0057FF; margin: 0 0 8px;">You've been invited!</h1>
    <p style="margin: 0 0 16px; color: #f4f4f8;">
      <strong>${commissionerName}</strong> has invited you to join <strong style="${goldStyle}">${leagueName}</strong> on Ultimate Fantasy Football.
    </p>
    <div style="border: 1px solid #FFD700; border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: center;">
      <p style="color: #a0a0b8; font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.1em;">Your Join Code</p>
      <p style="font-size: 28px; font-weight: 800; color: #FFD700; letter-spacing: 0.15em; margin: 0;">${joinCode}</p>
    </div>
    <a href="https://uff-platform.vercel.app/join?code=${joinCode}"
       style="display: inline-block; background: #0057FF; color: #f4f4f8; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
      Join the League →
    </a>
    <p style="${mutedStyle}; margin-top: 24px;">
      Already have an account? Sign in first, then enter the join code. Don't have one? Create a free account at
      <a href="https://uff-platform.vercel.app" style="${linkStyle}">uff-platform.vercel.app</a>.
    </p>
  </div>`;
}
