import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/account/password", "/account/mfa"];

/**
 * First gate only: no session cookie means no point rendering a staff screen.
 * Whether the cookie is *valid* is decided by the API, and a 401 from there
 * sends the user back here too.
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
