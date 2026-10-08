import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/t/"];

/**
 * First gate only: no speaker session cookie (D-148) means the speaker needs to sign in.
 * Whether the cookie is *valid* is decided by the API; a 401 there sends them to sign in
 * from the page itself.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((path) => pathname.startsWith(path))) return NextResponse.next();
  if (request.cookies.has("pmp_speaker")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login?reason=required", request.url));
}

export const config = {
  // `/api` is the API behind this site, which checks its own sessions.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
