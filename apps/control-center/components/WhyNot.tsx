/**
 * Why a control is greyed out, said on the page (D-111, UX_REVIEW batch 3). A hover title
 * is useless on touch screens and in print, so every disabled control that has a reason
 * shows it here — one line, plain words, and the alternative when there is one:
 * "Enter a name, start date and end date to continue."
 *
 * Put it right after the control (or its button row). Renders nothing without a reason,
 * so callers pass `reason={disabled ? "…" : null}` and keep one expression for both.
 */
export function WhyNot({ reason, id }: { reason: string | null | undefined | false; id?: string }) {
  if (!reason) return null;
  return (
    <p className="why-not" role="note" {...(id ? { id } : {})}>
      {reason}
    </p>
  );
}
