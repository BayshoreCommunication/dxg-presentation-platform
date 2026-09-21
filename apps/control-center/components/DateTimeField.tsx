"use client";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { datePickerPopperModifiers, useDatePickerYearNavigation } from "@/components/DatePickerHeader";

/**
 * The date and time control, in the DXG dashboard's style (D-044).
 *
 * It speaks the strings the rest of this screen speaks — `YYYY-MM-DD` for a day
 * and `HH:MM` for a clock — rather than `Date` objects, because that is what the
 * importer reads and what every cell already holds. Converting at the edge keeps
 * the calendar's `Date` habit out of the row editor entirely.
 *
 * The formats shown are DXG's own sheet formats: `MM/DD/YYYY` and `h:mm AM/PM`.
 */

const TIME_STEP_MINUTES = 15;

const dayToDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  // Noon, not midnight: a date built at midnight can slip a day under a
  // daylight-saving shift, and only the calendar day is ever read back out.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
};

const dateToDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const clockToDate = (value: string): Date | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateToClock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();
const clockMinutes = (value?: string) => {
  const parsed = value ? clockToDate(value) : null;
  return parsed ? minutesOf(parsed) : null;
};

export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
  ariaLabel,
  disabled,
}: {
  id: string;
  /** `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  invalid?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const minDate = min ? (dayToDate(min) ?? undefined) : undefined;
  const maxDate = max ? (dayToDate(max) ?? undefined) : undefined;
  const yearNavigation = useDatePickerYearNavigation({ minDate, maxDate });

  return (
    <DatePicker
      id={id}
      selected={dayToDate(value)}
      onChange={(date: Date | null) => onChange(date ? dateToDay(date) : "")}
      dateFormat="MM/dd/yyyy"
      placeholderText="MM/DD/YYYY"
      minDate={minDate}
      maxDate={maxDate}
      disabled={disabled}
      ariaInvalid={invalid ? "true" : undefined}
      className={`dxg-field${invalid ? " dxg-field--invalid" : ""}`}
      wrapperClassName="dxg-field-wrap"
      popperPlacement="bottom-start"
      popperProps={{ strategy: "fixed" }}
      popperModifiers={datePickerPopperModifiers}
      popperClassName="dxg-datepicker-popper"
      showPopperArrow={false}
      calendarClassName={`dxg-datepicker${yearNavigation.yearViewClassName}`}
      renderCustomHeader={yearNavigation.renderCustomHeader}
      onCalendarClose={yearNavigation.onCalendarClose}
      {...(ariaLabel ? { ariaLabel } : {})}
    />
  );
}

export function TimeField({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
  ariaLabel,
  disabled,
}: {
  id: string;
  /** `HH:MM`, or empty. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest offerable time, `HH:MM`. */
  min?: string;
  /** Latest offerable time, `HH:MM`. */
  max?: string;
  invalid?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const floor = clockMinutes(min);
  const ceiling = clockMinutes(max);
  const selected = clockToDate(value);

  /*
   * `includeTimes`, not `filterTime`. Both were tried: `filterTime` only marks
   * the excluded times disabled and still renders all ninety-six of them, so the
   * operator scrolls a whole day to reach the twenty minutes their session
   * allows — offered-but-refused, which is the thing D-043 set out to stop.
   * `includeTimes` renders the list itself, so what is not allowed is not there.
   *
   * A value the file supplied that the window excludes is added back, because a
   * time absent from this list does not display at all — and a field showing
   * nothing where the row holds 11:45 would hide the very thing to be corrected.
   */
  const step = TIME_STEP_MINUTES;
  const offered: Date[] | undefined =
    floor === null || ceiling === null
      ? undefined
      : (() => {
          const times: Date[] = [];
          for (let at = Math.ceil(floor / step) * step; at <= ceiling; at += step) {
            times.push(new Date(2000, 0, 1, Math.floor(at / 60), at % 60));
          }
          for (const edge of [floor, ceiling]) {
            if (!times.some((time) => minutesOf(time) === edge)) {
              times.push(new Date(2000, 0, 1, Math.floor(edge / 60), edge % 60));
            }
          }
          if (selected && !times.some((time) => minutesOf(time) === minutesOf(selected))) {
            times.push(selected);
          }
          return times.sort((a, b) => minutesOf(a) - minutesOf(b));
        })();

  return (
    <DatePicker
      id={id}
      selected={selected}
      onChange={(date: Date | null) => onChange(date ? dateToClock(date) : "")}
      showTimeSelect
      showTimeSelectOnly
      timeIntervals={TIME_STEP_MINUTES}
      timeCaption="Time"
      timeFormat="hh:mm aa"
      dateFormat="hh:mm aa"
      placeholderText="h:mm AM/PM"
      {...(offered ? { includeTimes: offered } : {})}
      disabled={disabled}
      ariaInvalid={invalid ? "true" : undefined}
      className={`dxg-field${invalid ? " dxg-field--invalid" : ""}`}
      wrapperClassName="dxg-field-wrap"
      popperPlacement="bottom-start"
      popperProps={{ strategy: "fixed" }}
      popperModifiers={datePickerPopperModifiers}
      popperClassName="dxg-datepicker-popper"
      showPopperArrow={false}
      calendarClassName="dxg-datepicker dxg-datepicker--time-only"
      {...(ariaLabel ? { ariaLabel } : {})}
    />
  );
}

/** Used by callers that need the same conversions, e.g. to compare two clocks. */
export const clockToMinutes = clockMinutes;
