"use client";

/**
 * Which days before the upload deadline the automatic reminder goes out (D-096).
 * Replaced a free-text box that nothing read. Choosing none turns reminders off.
 */
export const REMINDER_CHOICES = [14, 7, 3, 2, 1] as const;
export const DEFAULT_REMINDER_DAYS = [14, 7, 2];

/** The event's saved days, or the default when the setting has never been written. */
export function reminderDaysFrom(settings: Record<string, unknown> | undefined): number[] {
  const raw = settings?.reminder_days;
  if (!Array.isArray(raw)) return DEFAULT_REMINDER_DAYS;
  return raw.filter((day): day is number => (REMINDER_CHOICES as readonly unknown[]).includes(day));
}

export const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().every((day, index) => day === [...b].sort()[index]);

export function ReminderDaysField({
  value,
  onChange,
  disabled = false,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  const toggle = (day: number) =>
    onChange(value.includes(day) ? value.filter((kept) => kept !== day) : [...value, day].sort((a, b) => b - a));

  return (
    <div>
      <div role="group" aria-label="Automatic reminder days" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {REMINDER_CHOICES.map((day) => {
          const on = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              className="btn"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(day)}
              style={{
                padding: "4px 10px",
                ...(on ? { borderColor: "var(--green, #16a34a)", color: "var(--green, #16a34a)" } : { opacity: 0.75 }),
              }}
            >
              {on ? "✓ " : ""}
              {day === 1 ? "1 day" : `${day} days`}
            </button>
          );
        })}
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        {value.length === 0
          ? "Off — no reminder is sent automatically. “Remind speakers missing files” on Speakers still works."
          : "Before the upload deadline, at 09:00 event time, to every speaker still missing a file. Starts once the event is activated."}
      </div>
    </div>
  );
}
