import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase auth callback route.
 * Handles both email-confirmation links and password-reset links.
 * Supabase sends users here with either:
 *   - ?code=...           (PKCE flow, email confirmation)
 *   - ?token_hash=...&type=recovery  (password reset)
 * After exchanging the token we redirect to `next` (default: /dashboard).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=` + encodeURIComponent("Link expired or already used. Please try again."));
    }
  } else if (tokenHash && type) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as any });
    if (error) {
      console.error("[auth/callback] verifyOtp error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=` + encodeURIComponent("Link expired or already used. Please try again."));
    }
    // Password reset flow — always land on /reset-password so user can enter new password
    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/reset-password`);
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=` + encodeURIComponent("Invalid auth link."));
  }

  return NextResponse.redirect(`${origin}${next}`);
}
