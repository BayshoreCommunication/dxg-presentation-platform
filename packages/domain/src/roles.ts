/** SRS §5 roles, as stored in event_roles (db/migrations/002). */
export const EVENT_ROLES = [
  "platform_admin",
  "project_manager",
  "presentation_manager",
  "srr_technician",
  "room_technician",
  "content_reviewer",
  "client_event_admin",
  "scoped_reviewer",
] as const;

export type EventRole = (typeof EVENT_ROLES)[number];

/**
 * The staff seniority ladder used by WORKFLOW_STATES' "X or above" phrasing.
 * `room_technician` is deliberately NOT on the ladder: it is a different axis of
 * authority (physical custody of a room), so rules that allow it name it explicitly.
 * Client-side roles are never on the ladder.
 */
const LADDER: readonly EventRole[] = [
  "content_reviewer",
  "srr_technician",
  "presentation_manager",
  "project_manager",
  "platform_admin",
];

/** Expands "presentation_manager or above" into the concrete set of roles. */
export function atLeast(role: (typeof LADDER)[number]): EventRole[] {
  const index = LADDER.indexOf(role);
  if (index < 0) throw new Error(`${role} is not on the staff ladder`);
  return LADDER.slice(index);
}

export type Actor = {
  readonly id: string;
  readonly roles: readonly EventRole[];
  /** Agents and workers act as machines; machine-only transitions require this. */
  readonly isMachine?: boolean;
};

export const hasAnyRole = (actor: Actor, roles: readonly EventRole[]): boolean =>
  actor.roles.some((held) => roles.includes(held));
