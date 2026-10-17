import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // A Callback URL saved in the GitHub App with a trailing space arrives as ".../callback%20"; send it to the real route.
  if (/^\/api\/sources\/github\/callback(?:%20|\s)+$/i.test(request.nextUrl.pathname)) {
    const clean = request.nextUrl.clone();
    clean.pathname = "/api/sources/github/callback";
    return NextResponse.redirect(clean);
  }
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!api/health/live|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
