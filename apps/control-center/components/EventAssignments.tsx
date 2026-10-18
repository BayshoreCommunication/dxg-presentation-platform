"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserMinusIcon } from "@heroicons/react/24/outline";
import type { EventRow, StaffRow, WorkedRow } from "@/lib/api";
import { assignStaffToEvent, ApiError } from "@/lib/api";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ACCOUNT_KIND, formatDateRange, ROLE, wordsFor } from "@pmp/format";
import { Icon } from "@/components/Icon";
import { SelectMenu } from "@/components/SelectMenu";

type AssignmentFilter = "all" | "needs_staff" | "assigned";
type AssignmentSort = "upcoming" | "latest";
const PAGE_SIZE = 8;

const SORT_OPTIONS = [
  { value: "upcoming", label: "Upcoming first" },
  { value: "latest", label: "Latest first" },
] as const;

function paginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const items: Array<number | "ellipsis"> = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1]! > 1) items.push("ellipsis");
    items.push(page);
  });
  return items;
}

/** One person per event, carrying every responsibility they have there. */
function byEvent(staff: StaffRow[], events: EventRow[]) {
  return events.map((event) => ({
    event,
    people: staff
      .map((person) => ({
        person,
        roles: person.roles.filter((held) => held.event_id === event.id).map((held) => held.role),
      }))
      .filter((entry) => entry.roles.length > 0)
      .sort((a, b) => a.person.display_name.localeCompare(b.person.display_name)),
  }));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function StaffIdentity({ person, roles }: { person: StaffRow; roles: string[] }) {
  const roleLabels = roles.map((role) => wordsFor(ROLE, role).label);
  const visibleRoles = roleLabels.slice(0, 1);
  const hiddenRoles = roleLabels.length - visibleRoles.length;
  const accountLabel = ACCOUNT_KIND[person.account_type]?.label ?? person.account_type;

  return (
    <div className="assignment-person">
      <span className="assignment-avatar" aria-hidden="true">{initials(person.display_name)}</span>
      <span className="assignment-person-copy">
        <strong>{person.display_name}</strong>
        <span title={[accountLabel, ...roleLabels].join(" · ")}>{[accountLabel, ...visibleRoles].join(" · ")}</span>
      </span>
      {hiddenRoles > 0 && (
        <span className="assignment-role-count" title={roleLabels.slice(1).join(", ")}>+{hiddenRoles}</span>
      )}
      {!person.is_active && <span className="assignment-person-alert">Deactivated</span>}
      {person.is_active && !person.mfa_enrolled && <span className="assignment-person-alert">Sign-in app not set up</span>}
    </div>
  );
}

/** Who works which event, with gaps surfaced before the administrator opens an editor. */
export function EventAssignments({
  initial,
  events,
  history = [],
  assign,
}: {
  initial: StaffRow[];
  events: EventRow[];
  /** Who worked each finished event, once freed from it (D-181). */
  history?: WorkedRow[];
  assign?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // D-181: finished events retain their staffing history, but cannot receive assignments.
  const today = new Date().toISOString().slice(0, 10);
  const { current, past } = useMemo(() => {
    const finished = (event: EventRow) => event.status === "archived" || event.ends_on < today;
    return {
      current: events.filter((event) => !finished(event)),
      past: events.filter(finished).sort((a, b) => b.ends_on.localeCompare(a.ends_on)),
    };
  }, [events, today]);
  const [error, setError] = useState<{ eventId: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<{ eventId: string; person: StaffRow } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssignmentFilter>("all");
  const [sort, setSort] = useState<AssignmentSort>("upcoming");
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const newcomer = assign
    ? initial.find((person) => person.id === assign && person.is_active && person.account_type !== "root_admin")
    : undefined;

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const visible = byEvent(initial, current).filter(({ event, people }) => {
      if (filter === "needs_staff" && people.length > 0) return false;
      if (filter === "assigned" && people.length === 0) return false;
      if (!needle) return true;
      const searchText = [
        event.name,
        formatDateRange(event.starts_on, event.ends_on),
        ...people.flatMap(({ person, roles }) => [
          person.display_name,
          ACCOUNT_KIND[person.account_type]?.label ?? person.account_type,
          ...roles.map((role) => wordsFor(ROLE, role).label),
        ]),
      ].join(" ").toLocaleLowerCase();
      return searchText.includes(needle);
    });
    return visible.sort((a, b) => {
      const order = a.event.starts_on.localeCompare(b.event.starts_on);
      return sort === "upcoming" ? order : -order;
    });
  }, [current, filter, initial, query, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstResult = rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(currentPage * PAGE_SIZE, rows.length);

  const resetPage = () => {
    setPage(1);
    setOpenEventId(null);
    setRemoving(null);
  };

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(next, 1), totalPages));
    setOpenEventId(null);
    setRemoving(null);
  };

  const setWho = (eventId: string, who: string) => setDraft((current) => ({ ...current, [eventId]: who }));

  async function run(eventId: string, work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError({ eventId, message: caught instanceof ApiError ? caught.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  const toggleEditor = (eventId: string) => {
    setError(null);
    setRemoving(null);
    setOpenEventId((current) => (current === eventId ? null : eventId));
  };

  return (
    <>
      <div className="assignment-page-head">
        <div>
          <h1 className="htitle">Event assignments</h1>
          <p>Assign staff to events and manage who can access each workspace.</p>
        </div>
        <Link href="/admin/users" className="btn assignment-manage-accounts">
          <Icon name="users" />
          Manage staff accounts
        </Link>
      </div>

      {newcomer && (
        <div className="assignment-newcomer" role="status">
          <strong>Assigning {newcomer.display_name}</strong>
          <span>Choose the event they will work, then confirm the assignment.</span>
        </div>
      )}

      <div className="card assignment-card">
        <div className="assignment-toolbar">
          <label className="assignment-search">
            <span className="sr-only">Search events</span>
            <Icon name="search" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Search events…" />
          </label>

          <div className="assignment-filters" aria-label="Filter event assignments">
            {([ ["all", "All events", "calendar"], ["needs_staff", "Needs staff", "warning"], ["assigned", "Assigned", "check"] ] as const).map(([value, label, icon]) => (
              <button key={value} type="button" className={filter === value ? "on" : ""} aria-pressed={filter === value} onClick={() => { setFilter(value); resetPage(); }}>
                <Icon name={icon} size={15} />{label}
              </button>
            ))}
          </div>

          <div className="assignment-toolbar-end">
            <SelectMenu
              label="Sort events"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(value) => { setSort(value as AssignmentSort); resetPage(); }}
              className="assignment-sort-select"
            />
            <span className="assignment-result-count">{rows.length} {rows.length === 1 ? "event" : "events"}</span>
          </div>
        </div>

        <div className="assignment-table-wrap">
          <table className="assignment-table">
            <colgroup>
              <col className="assignment-col-event" />
              <col className="assignment-col-date" />
              <col className="assignment-col-staff" />
              <col className="assignment-col-status" />
              <col className="assignment-col-action" />
            </colgroup>
            <thead>
              <tr><th>Event</th><th>Date</th><th>Assigned staff</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {pageRows.map(({ event, people }) => {
                const isOpen = openEventId === event.id;
                // Any number of technicians may share an event (D-192): one per room plus backups.
                const available = initial.filter((person) =>
                  person.is_active && person.account_type !== "root_admin" &&
                  !people.some((entry) => entry.person.id === person.id),
                );
                const selectedPerson = available.find((person) => person.id === draft[event.id]);

                return (
                  <Fragment key={event.id}>
                    <tr className={isOpen ? "assignment-row-open" : undefined} data-starts-on={event.starts_on}>
                      <td><strong className="assignment-event-name">{event.name}</strong></td>
                      <td className="assignment-date">{formatDateRange(event.starts_on, event.ends_on)}</td>
                      <td>
                        {people.length > 0 ? (
                          <div className="assignment-people">
                            {people.map(({ person, roles }) => <StaffIdentity key={person.id} person={person} roles={roles} />)}
                          </div>
                        ) : <span className="assignment-empty">—</span>}
                      </td>
                      <td>
                        <span className={`assignment-status ${people.length > 0 ? "assigned" : "needs-staff"}`}>
                          <Icon name={people.length > 0 ? "check" : "warning"} />
                          {people.length > 0 ? "Assigned" : "Needs staff"}
                        </span>
                      </td>
                      <td>
                        {people.length === 0 ? (
                          <button type="button" className="btn pri assignment-assign-button" onClick={() => toggleEditor(event.id)}>
                            <Icon name="add" />Assign staff
                          </button>
                        ) : (
                          <button type="button" className="btn assignment-more-button" aria-label={`Manage assignments for ${event.name}`} aria-expanded={isOpen} onClick={() => toggleEditor(event.id)}>
                            <Icon name="chevronDown" size={18} />
                          </button>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="assignment-editor-row">
                        <td colSpan={5}>
                          <div className="assignment-editor">
                            <div className="assignment-editor-head">
                              <div><strong>Manage {event.name}</strong><span>Add someone new or remove an existing assignment.</span></div>
                            </div>

                            {people.length > 0 && (
                              <div className="assignment-current-team">
                                {people.map(({ person, roles }) => (
                                  <div className="assignment-current-person" key={person.id}>
                                    <StaffIdentity person={person} roles={roles} />
                                    <button type="button" className="btn assignment-remove-button" disabled={busy} onClick={() => { setError(null); setRemoving({ eventId: event.id, person }); }}>
                                      <UserMinusIcon width={16} height={16} aria-hidden="true" />Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {removing?.eventId === event.id && (
                              <ConfirmInline
                                question={`Take ${removing.person.display_name} off ${event.name}?`}
                                detail="They will no longer see this event. You can assign them again at any time."
                                confirmLabel="Remove"
                                icon="trash"
                                busyLabel="Removing…"
                                danger
                                onConfirm={async () => { await assignStaffToEvent(removing.person.id, event.id, false); setRemoving(null); router.refresh(); }}
                                onClose={() => setRemoving(null)}
                              />
                            )}

                            <div className="assignment-add-person">
                              <div><strong>Assign additional staff</strong><span>Access follows the staff member&apos;s account type. Assign as many DXG Technicians as the event&apos;s rooms need, backups included.</span></div>
                              <div className="assignment-add-controls">
                                {newcomer && draft[event.id] !== newcomer.id && available.some((person) => person.id === newcomer.id) && (
                                  <button type="button" className="btn" onClick={() => setWho(event.id, newcomer.id)}>Choose {newcomer.display_name}</button>
                                )}
                                <SelectMenu
                                  label={`Choose staff for ${event.name}`}
                                  value={selectedPerson?.id ?? ""}
                                  placeholder="Choose a staff member…"
                                  options={available.map((person) => ({
                                    value: person.id,
                                    label: `${person.display_name} — ${ACCOUNT_KIND[person.account_type]?.label ?? person.account_type}`,
                                  }))}
                                  onChange={(value) => setWho(event.id, value)}
                                  disabled={busy || available.length === 0}
                                  className="assignment-staff-select"
                                />
                                <button type="button" className="btn pri" disabled={busy || !selectedPerson} onClick={() => void run(event.id, async () => {
                                  if (!selectedPerson) throw new ApiError("request", "Choose who to assign.", 400);
                                  await assignStaffToEvent(selectedPerson.id, event.id, true);
                                  setDraft((current) => ({ ...current, [event.id]: "" }));
                                })}>
                                  <Icon name="add" />{busy ? "Assigning…" : "Assign to event"}
                                </button>
                              </div>
                            </div>

                            {available.length === 0 && <p className="assignment-all-assigned">Every active staff member is already assigned.</p>}
                            {error?.eventId === event.id && <div className="err assignment-error" role="alert">{error.message}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {rows.length === 0 && (
                <tr><td colSpan={5} className="assignment-no-results"><Icon name="search" size={20} /><strong>No events found</strong><span>Try a different search or status filter.</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="assignment-pagination" aria-label="Event assignment pages">
            <span className="assignment-page-summary">Showing {firstResult}–{lastResult} of {rows.length}</span>
            {totalPages > 1 && (
              <div className="assignment-page-controls">
                <button type="button" className="btn assignment-page-step" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Previous page">
                  <Icon name="chevronDown" size={15} />Previous
                </button>
                <div className="assignment-page-numbers">
                  {paginationItems(currentPage, totalPages).map((item, index) => item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
                  ) : (
                    <button key={item} type="button" className={item === currentPage ? "on" : ""} aria-label={`Page ${item}`} aria-current={item === currentPage ? "page" : undefined} onClick={() => goToPage(item)}>{item}</button>
                  ))}
                </div>
                <button type="button" className="btn assignment-page-step" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Next page">
                  Next<Icon name="chevronDown" size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

        {/* D-181: finished events — their staff were freed; who worked each is kept. */}
        {past.length > 0 && (
          <div className="card">
            <details>
              <summary className="chd" style={{ cursor: "pointer" }}>
                <h3>Finished events · {past.length}</h3>
                <span className="m">archived or over — staff are freed; who worked each is kept</span>
              </summary>
              <div className="cbd" style={{ padding: "0 0 4px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Worked this event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((event) => {
                      // Only support staff and technicians are freed (D-181): clients keep their own
                      // event, and a DXG Admin (a practice event's owner, say) reaches every event.
                      const still = byEvent(initial, [event])[0]!.people.filter(
                        (entry) => entry.person.account_type === "support" || entry.person.account_type === "technician",
                      );
                      const worked = workedOn(history, event.id).filter(
                        (entry) => !still.some((held) => held.person.id === entry.user_id),
                      );
                      return (
                        <tr key={event.id}>
                          <td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                            <div style={{ fontWeight: 600 }}>{event.name}</div>
                            <span className="note">
                              {formatDateRange(event.starts_on, event.ends_on)} ·{" "}
                              {event.status === "archived" ? "archived" : "over"}
                            </span>
                          </td>
                          <td>
                            {worked.length === 0 && still.length === 0 && <span className="note">Nobody recorded.</span>}
                            {worked.map((entry) => (
                              <div key={entry.user_id} style={{ marginBottom: 4 }}>
                                <span style={{ display: "inline-block", minWidth: 150 }}>{entry.display_name}</span>
                                <span className="note">{entry.roles.map((role) => wordsFor(ROLE, role).label).join(" · ")}</span>
                              </div>
                            ))}
                            {/* Over but not yet freed: the worker frees them the day after the last day (D-181). */}
                            {still.map(({ person, roles }) => (
                              <div key={person.id} style={{ marginBottom: 4 }}>
                                <span style={{ display: "inline-block", minWidth: 150 }}>{person.display_name}</span>
                                <span className="note">{roles.map((role) => wordsFor(ROLE, role).label).join(" · ")}</span>{" "}
                                <span
                                  className="chip c-mut"
                                  title="The event is over. Staff are freed automatically the day after its last day, or when it is archived."
                                >
                                  still assigned
                                </span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
    </>
  );
}

/** Who worked an event, one line per person with every role they held (D-181). */
function workedOn(history: WorkedRow[], eventId: string): { user_id: string; display_name: string; roles: string[] }[] {
  const byPerson = new Map<string, { user_id: string; display_name: string; roles: string[] }>();
  for (const row of history.filter((entry) => entry.event_id === eventId)) {
    const entry = byPerson.get(row.user_id) ?? { user_id: row.user_id, display_name: row.display_name, roles: [] };
    if (!entry.roles.includes(row.role)) entry.roles.push(row.role);
    byPerson.set(row.user_id, entry);
  }
  return [...byPerson.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}
