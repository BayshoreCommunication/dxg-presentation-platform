import { redirect } from "next/navigation";
import { ApiError } from "./api";

/**
 * Turns an expired or missing session into the login screen instead of a crash page.
 *
 *     const { items } = await guard(listEvents(), "/");
 *
 * **Only 401 redirects.** A 403 means the session is perfectly valid and the role is
 * not sufficient — bouncing that person to a login screen they are already past sends
 * them round a loop with nothing explained. Those are left for the caller to render,
 * as `admin/users` and `client/[eventId]` already do.
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
    throw caught;
  }
}
