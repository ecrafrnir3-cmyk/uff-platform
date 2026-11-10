// Stand-in for @/lib/email: records what would be sent, sends nothing.
const S = () => globalThis.__QA__;
export async function sendEmail(args) { S().emails.push({ to: args?.to, subject: args?.subject }); return { ok: true, status: 200 }; }
export async function getUserEmail() { return 'member@example.test'; }
export async function getAllUserEmails() { return {}; }
export function tradeProposedHtml(args) { S().templates.push({ name: 'tradeProposedHtml', args }); return ''; }
export function tradeRespondedHtml(args) { S().templates.push({ name: 'tradeRespondedHtml', args }); return ''; }
export function tradeVetoedHtml(args) { S().templates.push({ name: 'tradeVetoedHtml', args }); return ''; }
export function newsletterHtml(args) { S().templates.push({ name: 'newsletterHtml', args }); return ''; }
