import type { Principal } from "./api";

/**
 * Where an account belongs after signing in.
 *
 * DXG staff land on the portfolio. A client has no use for it — they are refused on
 * every staff route — so they go to their own event instead of discovering by
 * rejection that the front door is not theirs.
 *
 * With more than one event the choice is theirs to make, not ours to guess: sending
 * someone to the wrong client's event would be worse than asking. `/client` lists
 * them.
 */
/**
 * A `next` that stays on this site: a path, never `https://…`, `//host` or `/\\host`,
 * which the router would follow off-site straight after a real sign-in.
 */
export function safePath(requested?: string): string | undefined {
  if (!requested || !requested.startsWith("/") || requested.startsWith("//") || requested.startsWith("/\\")) return undefined;
  return requested;
}

export function landingFor(principal: Principal, nextPath?: string): string {
  if (principal.must_change_password) return "/account/password?first=1";
  const requested = safePath(nextPath);

  // A speaker account (D-146) has one place: its presentations. A staff page it was sent
  // to sign in for would only refuse it.
  if (principal.account_kind === "speaker") {
    return requested?.startsWith("/presentations") || requested?.startsWith("/account/") ? requested : "/presentations";
  }

  const events = principal.client_events;
  if (events.length === 0) return requested && requested !== "/" ? requested : "/";

  // A client who asked for a specific page they can actually use still gets it.
  if (requested?.startsWith("/client/")) return requested;

  return events.length === 1 ? `/client/${events[0]!.id}` : "/client";
}
