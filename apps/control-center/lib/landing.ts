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
export function landingFor(principal: Principal, requested?: string): string {
  if (principal.must_change_password) return "/account/password?first=1";

  const events = principal.client_events;
  if (events.length === 0) return requested && requested !== "/" ? requested : "/";

  // A client who asked for a specific page they can actually use still gets it.
  if (requested?.startsWith("/client/")) return requested;

  return events.length === 1 ? `/client/${events[0]!.id}` : "/client";
}
