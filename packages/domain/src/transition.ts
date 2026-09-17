import type { Actor, EventRole } from "./roles.ts";
import { hasAnyRole } from "./roles.ts";
import type { DomainError, Result } from "./result.ts";
import { err, ok } from "./result.ts";

/** Who may perform a transition: an explicit role set, or the system itself. */
export type Authority = readonly EventRole[] | "machine";

export type TransitionRule<S extends string, A extends string> = {
  readonly from: S;
  readonly action: A;
  readonly to: S;
  readonly authority: Authority;
  /** Mandatory free-text reason, recorded in the audit trail. */
  readonly requiresReason?: boolean;
};

export type Lifecycle<S extends string, A extends string> = {
  readonly name: string;
  readonly states: readonly S[];
  readonly labels: Readonly<Record<S, string>>;
  readonly terminal: readonly S[];
  readonly rules: readonly TransitionRule<S, A>[];
  /** Roles permitted to force a transition the rules do not allow. */
  readonly overrideRoles: readonly EventRole[];
};

export type TransitionInput<S extends string, A extends string> = {
  readonly from: S;
  readonly action: A;
  readonly actor: Actor;
  readonly reason?: string;
  /** An audited escape hatch; always needs an authorised role and a reason. */
  readonly override?: { readonly to: S };
};

export type TransitionOutcome<S extends string> = {
  readonly to: S;
  readonly reason?: string;
  readonly overridden: boolean;
};

export function allowedActions<S extends string, A extends string>(
  lifecycle: Lifecycle<S, A>,
  from: S,
): A[] {
  return lifecycle.rules.filter((rule) => rule.from === from).map((rule) => rule.action);
}

/**
 * The only write path for state (WORKFLOW_STATES common rules). Pure: no I/O,
 * no clock, no randomness — so every legal and illegal pair is table-testable.
 */
export function transition<S extends string, A extends string>(
  lifecycle: Lifecycle<S, A>,
  input: TransitionInput<S, A>,
): Result<TransitionOutcome<S>, DomainError> {
  const { name } = lifecycle;
  const rule = lifecycle.rules.find((r) => r.from === input.from && r.action === input.action);

  if (!rule) {
    if (!input.override) {
      const allowed = allowedActions(lifecycle, input.from);
      const allowedText = allowed.length > 0 ? allowed.join(", ") : "none — this state is terminal";
      return err({
        code: `${name}.illegal_transition`,
        message: `Cannot ${input.action} while ${name} is "${lifecycle.labels[input.from]}". Allowed: ${allowedText}.`,
        current_state: input.from,
        detail: { allowed },
      });
    }
    if (!hasAnyRole(input.actor, lifecycle.overrideRoles)) {
      return err({
        code: `${name}.override_forbidden`,
        message: `Overriding a ${name} transition requires one of: ${lifecycle.overrideRoles.join(", ")}.`,
        current_state: input.from,
      });
    }
    if (!input.reason?.trim()) {
      return err({
        code: `${name}.reason_required`,
        message: "An override must record a reason.",
        current_state: input.from,
      });
    }
    if (!lifecycle.states.includes(input.override.to)) {
      return err({
        code: `${name}.unknown_state`,
        message: `"${input.override.to}" is not a ${name} state.`,
        current_state: input.from,
      });
    }
    return ok({ to: input.override.to, reason: input.reason, overridden: true });
  }

  if (rule.authority === "machine") {
    if (!input.actor.isMachine) {
      return err({
        code: `${name}.forbidden`,
        message: `"${input.action}" is performed by the system, not by a user.`,
        current_state: input.from,
      });
    }
  } else if (!hasAnyRole(input.actor, rule.authority)) {
    return err({
      code: `${name}.forbidden`,
      message: `"${input.action}" requires one of: ${rule.authority.join(", ")}.`,
      current_state: input.from,
      detail: { required: rule.authority },
    });
  }

  if (rule.requiresReason && !input.reason?.trim()) {
    return err({
      code: `${name}.reason_required`,
      message: `"${input.action}" requires a reason.`,
      current_state: input.from,
    });
  }

  const outcome: TransitionOutcome<S> = input.reason?.trim()
    ? { to: rule.to, reason: input.reason, overridden: false }
    : { to: rule.to, overridden: false };
  return ok(outcome);
}
