import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/account/password", "/account/mfa"];

/**
 * First gate only: no session cookie means no point rendering a staff screen.
 * Whether the cookie is *valid* is decided by the API — a cookie can be present
 * but expired, or belong to a presenter, and this gate waves both through. The
 * 401 that follows is turned back into a redirect here by `guard()` in
 * `lib/guard.ts`, which every page's data fetch goes through.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((path) => pathname.startsWith(path))) return NextResponse.next();
  if (request.cookies.has("pmp_session")) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  login.searchParams.set("reason", "required");
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
