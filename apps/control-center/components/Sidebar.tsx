"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";

/**
 * Navigation structure, grouping and screen names are fixed by the client
 * baseline (VISUAL_ACCEPTANCE §2.1/§2.2). Screens not yet built are shown but
 * marked, rather than hidden — the information architecture is the contract.
 */
const GROUPS: { group: string; items: { label: string; href?: string }[] }[] = [
  {
    group: "CONTROL CENTER",
    items: [
      { label: "Portfolio", href: "/" },
      { label: "Create event" },
      { label: "Schedule import", href: "/events/:id/import" },
      { label: "Command center", href: "/events/:id" },
      { label: "Speakers", href: "/events/:id/speakers" },
      { label: "Presentation detail" },
      { label: "Inspection" },
      { label: "Review & approval", href: "/events/:id/review" },
      { label: "Communications" },
      { label: "Archive builder", href: "/events/:id/archive" },
    ],
  },
  {
    group: "ONSITE",
    items: [
      { label: "Speaker Ready Room", href: "/events/:id/srr" },
      { label: "Check-in" },
      { label: "USB intake" },
      { label: "Room sync", href: "/events/:id/sync" },
    ],
  },
  { group: "DEVICE", items: [{ label: "Room Agent", href: "/events/:id/agent" }] },
  {
    group: "EXTERNAL",
    items: [{ label: "Speaker portal" }, { label: "Client portal", href: "/client/:id" }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const eventId = params?.id ?? "22222222-2222-4222-8222-222222222222";

  return (
    <aside>
      <div className="logo">
        <b>DXG·PM</b>
      </div>
      <div className="evtctx">MedTech Fwd 26 · Day 2</div>
      <nav>
        {GROUPS.map(({ group, items }) => (
          <div key={group}>
            <div className="grp">{group}</div>
            {items.map((item) => {
              const href = item.href?.replace(":id", eventId);
              if (!href) {
                return (
                  <a key={item.label} className="" style={{ opacity: 0.38, cursor: "default" }}>
                    {item.label}
                  </a>
                );
              }
              return (
                <Link key={item.label} href={href} className={pathname === href ? "on" : ""}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
