import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** No session cookie means the presenter needs to sign in first. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/t/")) return NextResponse.next();
  // The presenter's own cookie (D-088) — a staff session in the same browser is not one.
  if (request.cookies.has("pmp_presenter")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login?reason=required", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
