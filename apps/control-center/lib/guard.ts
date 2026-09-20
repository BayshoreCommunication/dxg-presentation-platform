import { redirect } from "next/navigation";
import { ApiError } from "./api";

/**
 * Turns an authentication or authorisation failure into a page that explains itself,
 * instead of a crash.
 *
 *     const { items } = await guard(listEvents(), "/");
 *
 * The two cases are genuinely different and must not be conflated:
 *
 * - **401** — no usable session. Send them to sign in, remembering where they were.
 * - **403 `auth.mfa_required`** — the account simply has not enrolled a second factor
 *   yet. That is a step to finish, not a refusal, so send them to the enrolment screen
 *   rather than telling them they lack access.
 * - **403 otherwise** — the session is perfectly valid; the *role* is not sufficient.
 *   Sending this person to a login screen they are already past would loop them: they
 *   sign in successfully and bounce straight back. They need telling what is actually
 *   wrong, which `/no-access` does.
 *
 * A newly created staff account meets the 403 path on its very first sign-in, because
 * an account exists before it has a role on any event. That is the ordinary case, not
 * an edge case, so it gets a real page rather than a stack trace.
 *
 * This deliberately does **not** live in `lib/api.ts`. That module is imported by
 * client components too, and `LoginForm` needs to render a 401 as "that password is
 * wrong" rather than navigate away from the form the user is typing into. A blanket
 * redirect inside `request()` would break sign-in.
 */
export async function guard<T>(work: Promise<T>, returnTo: string): Promise<T> {
  try {
    return await work;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}&reason=required`);
    }
    if (caught instanceof ApiError && caught.status === 403) {
      // Not yet enrolled is a step to finish, not a door being closed.
      if (caught.code === "auth.mfa_required") {
        redirect("/account/mfa");
      }
      redirect(`/no-access?reason=${encodeURIComponent(caught.message)}`);
    }
    throw caught;
  }
}
