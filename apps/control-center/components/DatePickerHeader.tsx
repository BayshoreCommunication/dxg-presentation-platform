"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ReactDatePickerCustomHeaderProps } from "react-datepicker";
import { shift } from "@floating-ui/react";

/**
 * The DXG dashboard's calendar header, ported (D-044): month and year as a
 * dropdown toggle, with previous/next arrows beside it.
 *
 * Two deliberate differences from the original. Its chevrons come from
 * `lucide-react`; four arrows are not worth a dependency, so they are inline SVG.
 * And its `containedDatePickerPopperModifiers` — for pickers inside a marked
 * scroll viewport — is left out until something here needs it, rather than
 * ported unused.
 */

/** Reuse react-datepicker's own Floating UI so a popup can escape a modal. */
export const datePickerPopperModifiers = [
  shift(({ elements }) => ({
    boundary: [],
    rootBoundary: "viewport" as const,
    crossAxis: true,
    padding:
      (elements.floating.ownerDocument.defaultView?.innerWidth ?? 1024) < 768
        ? { top: 72, bottom: 88, left: 8, right: 8 }
        : 8,
  })),
];

const Chevron = ({ to, size = 16 }: { to: "up" | "down" | "left" | "right"; size?: number }) => {
  const path = {
    up: "M4 10 L8 6 L12 10",
    down: "M4 6 L8 10 L12 6",
    left: "M10 4 L6 8 L10 12",
    right: "M6 4 L10 8 L6 12",
  }[to];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

type DateBounds = { minDate?: Date; maxDate?: Date };

/** Browsing defaults, not validation limits: dates outside this window still exist. */
export function getPickerYearRange(year: number, { minDate, maxDate }: DateBounds) {
  const firstYear = minDate?.getFullYear() ?? Math.min(1900, year, maxDate?.getFullYear() ?? year);
  const lastYear = maxDate?.getFullYear() ?? Math.max(2100, year, firstYear);
  return { firstYear, lastYear };
}

function YearList({
  id,
  year,
  firstYear,
  lastYear,
  onSelect,
  onCancel,
}: {
  id: string;
  year: number;
  firstYear: number;
  lastYear: number;
  onSelect: (year: number) => void;
  onCancel: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedYear, setFocusedYear] = useState(Math.max(firstYear, Math.min(lastYear, year)));

  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLButtonElement>('[tabindex="0"]');
    if (list && option) {
      option.focus({ preventScroll: true });
      // Scroll only this list, never the dialog around it.
      list.scrollTop = option.offsetTop - (list.clientHeight - option.clientHeight) / 2;
    }
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    const nextYear = {
      ArrowLeft: focusedYear - 1,
      ArrowRight: focusedYear + 1,
      ArrowUp: focusedYear - 4,
      ArrowDown: focusedYear + 4,
      PageUp: focusedYear - 20,
      PageDown: focusedYear + 20,
      Home: firstYear,
      End: lastYear,
    }[event.key];
    if (nextYear === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const boundedYear = Math.max(firstYear, Math.min(lastYear, nextYear));
    setFocusedYear(boundedYear);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-year="${boundedYear}"]`)?.focus();
  };

  return (
    <div
      id={id}
      ref={listRef}
      className="dxg-datepicker__years"
      role="group"
      aria-label="Choose a year"
      onKeyDown={handleKeyDown}
    >
      {Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, index) => firstYear + index).map(
        (option) => (
          <button
            key={option}
            type="button"
            data-year={option}
            aria-label={`Choose year ${option}`}
            aria-pressed={option === year}
            tabIndex={option === focusedYear ? 0 : -1}
            className="dxg-datepicker__year-option"
            onFocus={() => setFocusedYear(option)}
            onClick={() => onSelect(option)}
          >
            {option}
          </button>
        ),
      )}
    </div>
  );
}

function DatePickerHeader({
  date,
  changeYear,
  changeMonth,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
  minDate,
  maxDate,
  choosingYear,
  onViewChange,
}: ReactDatePickerCustomHeaderProps &
  DateBounds & { choosingYear: boolean; onViewChange: (open: boolean) => void }) {
  const titleRef = useRef<HTMLButtonElement>(null);
  const yearListId = useId();
  const year = date.getFullYear();
  const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  const { firstYear, lastYear } = getPickerYearRange(year, { minDate, maxDate });

  const returnToDays = () => {
    onViewChange(false);
    titleRef.current?.focus({ preventScroll: true });
  };

  const selectYear = (nextYear: number) => {
    changeYear(nextYear);
    // A boundary year may allow only some months. Start at an allowed one.
    const firstMonth = minDate?.getFullYear() === nextYear ? minDate.getMonth() : 0;
    const lastMonth = maxDate?.getFullYear() === nextYear ? maxDate.getMonth() : 11;
    const nextMonth = Math.max(firstMonth, Math.min(lastMonth, date.getMonth()));
    // Always restore the intended month: setYear on 29 February rolls into March.
    changeMonth(nextMonth);
    // Choosing a year commits nothing; the operator still picks a day.
    returnToDays();
  };

  return (
    <>
      <div className="dxg-datepicker__toolbar">
        <button
          ref={titleRef}
          type="button"
          className="dxg-datepicker__view-toggle"
          aria-label={`${monthTitle}, ${choosingYear ? "return to calendar" : "choose year"}`}
          aria-expanded={choosingYear}
          aria-controls={choosingYear ? yearListId : undefined}
          onClick={() => onViewChange(!choosingYear)}
        >
          {monthTitle}
          <Chevron to={choosingYear ? "up" : "down"} />
        </button>
        {!choosingYear && (
          <div className="dxg-datepicker__month-navigation">
            <button
              type="button"
              aria-label="Previous month"
              className="dxg-datepicker__month-arrow"
              disabled={prevMonthButtonDisabled}
              onClick={decreaseMonth}
            >
              <Chevron to="left" size={18} />
            </button>
            <button
              type="button"
              aria-label="Next month"
              className="dxg-datepicker__month-arrow"
              disabled={nextMonthButtonDisabled}
              onClick={increaseMonth}
            >
              <Chevron to="right" size={18} />
            </button>
          </div>
        )}
      </div>
      {choosingYear && (
        <YearList
          id={yearListId}
          year={year}
          firstYear={firstYear}
          lastYear={lastYear}
          onSelect={selectYear}
          onCancel={returnToDays}
        />
      )}
    </>
  );
}

/** Both date-only and date/time fields share the same year navigation. */
export function useDatePickerYearNavigation(bounds: DateBounds) {
  const [choosingYear, setChoosingYear] = useState(false);
  return {
    yearViewClassName: choosingYear ? " dxg-datepicker--choosing-year" : "",
    onCalendarClose: () => setChoosingYear(false),
    renderCustomHeader: (props: ReactDatePickerCustomHeaderProps) => (
      <DatePickerHeader {...props} {...bounds} choosingYear={choosingYear} onViewChange={setChoosingYear} />
    ),
  };
}
