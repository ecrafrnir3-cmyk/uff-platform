// Stand-in for next/navigation: redirect() throws, as Next.js's does, and the parity check catches it.
export class QaRedirect extends Error {
  constructor(to) { super(`NEXT_REDIRECT ${to}`); this.redirectTo = to; }
}
export function redirect(to) { throw new QaRedirect(to); }
