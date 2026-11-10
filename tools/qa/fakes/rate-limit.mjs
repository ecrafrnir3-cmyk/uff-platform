// Stand-in for @/lib/rate-limit: always allowed (the parity check calls each handler once per case).
export async function checkRateLimit() { return { allowed: true, remaining: 99 }; }
