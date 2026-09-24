import { Icon } from "@/components/Icon";

export type KpiTone = "ok" | "warn" | "bad";

/**
 * Kravio's KPI tile (D-078): a hatched tray with the label and a two-tone icon on top,
 * and a white panel holding the number at its foot with one short line under it.
 *
 * As in Kravio the number itself is never coloured. Colour belongs to the line under
 * it, and only when it says something — green for done, amber for needs attention,
 * red for a problem. Kravio's sparkline slot needs history this product does not keep,
 * so a tile that is a genuine share (collected of total, rooms ready of rooms) shows a
 * small progress ring there instead, and every other tile leaves it empty.
 */
export function Kpi({
  label,
  icon,
  value,
  caption,
  tone,
  progress,
  help,
}: {
  label: string;
  icon: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: KpiTone;
  /** 0–1, for a tile that is a share of a whole. */
  progress?: number;
  /** An explanation rendered beside the label (an InfoTip). */
  help?: React.ReactNode;
}) {
  return (
    <section className="kpi">
      <div className="kpi-head">
        <h3>
          <span className="kpi-label">{label}</span>
          {help}
        </h3>
        <span className="kpi-ico">
          <Icon name={icon} />
        </span>
      </div>
      <div className="kpi-body">
        <div className="kpi-stat">
          <p className="kv num">{value}</p>
          {caption !== undefined && caption !== null && caption !== "" && (
            <p className={tone ? `kpi-sub tone-${tone}` : "kpi-sub"}>{caption}</p>
          )}
        </div>
        {progress !== undefined && <Ring value={progress} tone={tone} />}
      </div>
    </section>
  );
}

function Ring({ value, tone }: { value: number; tone?: KpiTone }) {
  const share = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={tone ? `kpi-ring tone-${tone}` : "kpi-ring"} width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={radius} className="track" />
      {/* A zero-length arc still paints its round cap as a dot, so an empty share draws no arc. */}
      {share > 0 && (
        <circle
          cx="18"
          cy="18"
          r={radius}
          className="fill"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform="rotate(-90 18 18)"
        />
      )}
    </svg>
  );
}
