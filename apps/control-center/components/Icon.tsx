/**
 * The Kravio icon language (D-078): 16 px outline glyphs, 1.2 px stroke, round caps
 * and joins, drawn in `currentColor` so a nav item's text colour tints its icon too.
 * Kept inline rather than pulled from a package: eleven glyphs do not justify a
 * dependency, and the stroke weight is the part that has to match.
 */
const PATHS: Record<string, string> = {
  grid: "M2.5 4A1.5 1.5 0 0 1 4 2.5h2A1.5 1.5 0 0 1 7.5 4v2A1.5 1.5 0 0 1 6 7.5H4A1.5 1.5 0 0 1 2.5 6ZM8.5 4A1.5 1.5 0 0 1 10 2.5h2A1.5 1.5 0 0 1 13.5 4v2A1.5 1.5 0 0 1 12 7.5h-2A1.5 1.5 0 0 1 8.5 6ZM2.5 10A1.5 1.5 0 0 1 4 8.5h2A1.5 1.5 0 0 1 7.5 10v2A1.5 1.5 0 0 1 6 13.5H4A1.5 1.5 0 0 1 2.5 12ZM8.5 10A1.5 1.5 0 0 1 10 8.5h2a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 8.5 12Z",
  plus: "M2.5 6.5c0-2 0-3 .6-3.5.6-.5 1.6-.5 3.4-.5h3c1.8 0 2.8 0 3.4.5.6.5.6 1.5.6 3.5v3c0 2 0 3-.6 3.5-.6.5-1.6.5-3.4.5h-3c-1.8 0-2.8 0-3.4-.5-.6-.5-.6-1.5-.6-3.5ZM8 5.5v5M5.5 8h5",
  review: "M9 1.8H5.5a2 2 0 0 0-2 2v8.4a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V5.3ZM9 1.8v3.5h3.5M6 9.6l1.3 1.3L10 8.2",
  mail: "M1.8 5c0-1.3 1-2.3 2.3-2.3h7.8c1.3 0 2.3 1 2.3 2.3v6c0 1.3-1 2.3-2.3 2.3H4.1c-1.3 0-2.3-1-2.3-2.3ZM2.3 4.2l4.6 3.6c.6.5 1.5.5 2.2 0l4.6-3.6",
  archive: "M2 3.5c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v1.3c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1ZM3 5.8v6.2c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5V5.8M6.5 8.5h3",
  users: "M8.5 5.3a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM1.8 13.5c.4-2.4 2.1-3.7 4.2-3.7s3.8 1.3 4.2 3.7M10.5 3a2.5 2.5 0 0 1 0 4.6M12 9.9c1.3.4 2.1 1.5 2.3 3.6",
  sync: "M13.2 6.5A5.3 5.3 0 0 0 3.4 5M2.8 9.5a5.3 5.3 0 0 0 9.8 1.5M13.5 2.5v4h-4M2.5 13.5v-4h4",
  monitor: "M1.8 4.2c0-1 .8-1.7 1.7-1.7h9c1 0 1.7.8 1.7 1.7v5.6c0 1-.8 1.7-1.7 1.7h-9c-1 0-1.7-.8-1.7-1.7ZM5.5 13.8h5M8 11.5v2.3",
  shield: "M8 1.8 3 3.6v4c0 3 2.1 5.3 5 6.6 2.9-1.3 5-3.6 5-6.6v-4ZM6.2 8l1.3 1.3 2.4-2.6",
  clipboard: "M5.5 2.8H4.3c-.8 0-1.5.7-1.5 1.5v8.4c0 .8.7 1.5 1.5 1.5h7.4c.8 0 1.5-.7 1.5-1.5V4.3c0-.8-.7-1.5-1.5-1.5h-1.2M6 1.8h4c.3 0 .5.2.5.5v1c0 .3-.2.5-.5.5H6c-.3 0-.5-.2-.5-.5v-1c0-.3.2-.5.5-.5ZM5.5 8h5M5.5 10.8h3",
  globe: "M14.2 8A6.2 6.2 0 1 1 1.8 8a6.2 6.2 0 0 1 12.4 0ZM1.8 8h12.4M8 1.8c1.6 1.7 2.4 3.8 2.4 6.2S9.6 12.5 8 14.2C6.4 12.5 5.6 10.4 5.6 8S6.4 3.5 8 1.8Z",
  chevrons: "M5 6 8 3l3 3M5 10l3 3 3-3",
  key: "M10.2 9.8a3.8 3.8 0 1 0-3.6-2.6L2 11.8V14h2.2v-1.5h1.5V11h1.5l.7-.7a3.8 3.8 0 0 0 2.3-.5ZM11 5h.01",
  lock: "M4.5 7V5.3a3.5 3.5 0 0 1 7 0V7M3.3 8.5c0-.8.7-1.5 1.5-1.5h6.4c.8 0 1.5.7 1.5 1.5v4c0 .8-.7 1.5-1.5 1.5H4.8c-.8 0-1.5-.7-1.5-1.5ZM8 10v1.3",
  logout: "M9.8 2.5H11c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2H9.8M6.5 5 3.5 8l3 3M3.5 8h7",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Kravio's two-tone top-bar glyphs, copied path for path from the reference site (D-078):
 * a `#D9D9D9` fill under a `#4B5563` 1.2 px outline, and the sidebar toggle in the muted
 * `#9CA3AF`. Separate from `Icon` because their colours are part of the drawing.
 */
export function Glyph({ name }: { name: "sidebar" | "grid" | "bell" | "settings" | "slash" }) {
  const svg = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, focusable: false } as const;
  switch (name) {
    case "sidebar":
      return (
        <svg {...svg}>
          <path d="M1.334 8c0-2.46 0-3.689.542-4.56.2-.323.45-.604.737-.83C3.388 2 4.481 2 6.667 2h2.667c2.186 0 3.279 0 4.054.61.287.226.536.507.737.83.542.871.542 2.1.542 4.56s0 3.689-.542 4.56c-.2.323-.45.604-.737.83-.775.61-1.868.61-4.054.61H6.667c-2.186 0-3.279 0-4.054-.61a3.1 3.1 0 0 1-.737-.83C1.334 11.689 1.334 10.46 1.334 8Z" stroke="#9CA3AF" strokeWidth="1.2" />
          <path d="M9.665 2v12" stroke="#9CA3AF" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case "grid": {
      const tile = (x: number, y: number) =>
        `M${x + 0.127} ${y + 3.971}C${x} ${y + 3.665} ${x} ${y + 3.277} ${x} ${y + 2.5}s0-1.165.127-1.471c.169-.408.493-.733.902-.902C${x + 1.335} ${y} ${x + 1.723} ${y} ${x + 2.5} ${y}s1.165 0 1.471.127c.408.169.733.493.902.902.127.306.127.694.127 1.471s0 1.165-.127 1.471c-.169.408-.493.733-.902.902C${x + 3.665} ${y + 5} ${x + 3.277} ${y + 5} ${x + 2.5} ${y + 5}s-1.165 0-1.471-.127a1.667 1.667 0 0 1-.902-.902Z`;
      return (
        <svg {...svg}>
          {[
            [9, 9],
            [9, 2],
            [2, 9],
            [2, 2],
          ].map(([x, y]) => (
            <path key={`${x}-${y}`} d={tile(x, y)} fill="#D9D9D9" stroke="#4B5563" strokeLinecap="square" strokeLinejoin="round" />
          ))}
        </svg>
      );
    }
    case "bell":
      return (
        <svg {...svg}>
          <path d="M10.333 12a2.333 2.333 0 0 1-4.666 0" stroke="#4B5563" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.821 12H3.179A1.179 1.179 0 0 1 2 10.821c0-.313.124-.613.345-.834l.402-.402c.375-.375.586-.884.586-1.414V6.333a4.667 4.667 0 0 1 9.334 0V8.17c0 .53.21 1.04.586 1.414l.402.402c.221.221.345.521.345.834 0 .651-.528 1.179-1.179 1.179Z" fill="#D9D9D9" stroke="#4B5563" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...svg}>
          <path d="M13.86 6.101c.538.927.807 1.39.807 1.899s-.269.972-.807 1.899l-1.282 2.21c-.535.923-.803 1.385-1.244 1.638C10.894 14 10.36 14 9.291 14H6.708c-1.068 0-1.602 0-2.043-.253-.44-.253-.707-.715-1.243-1.638l-1.282-2.21C1.602 8.972 1.333 8.509 1.333 8s.269-.972.807-1.899l1.282-2.21c.536-.923.803-1.385 1.243-1.638C5.106 2 5.64 2 6.708 2h2.583c1.069 0 1.603 0 2.043.253.44.253.709.715 1.244 1.638l1.282 2.21Z" fill="#D9D9D9" stroke="#4B5563" strokeWidth="1.2" />
          <path d="M10.333 8a2.333 2.333 0 1 1-4.666 0 2.333 2.333 0 0 1 4.666 0Z" fill="#F7F7F7" stroke="#4B5563" strokeWidth="1.2" />
        </svg>
      );
    case "slash":
      return (
        <svg width={7} height={11} viewBox="0 0 7 11" fill="none" aria-hidden focusable={false}>
          <path d="M.429 10.257 6.429.257" stroke="#6B7280" />
        </svg>
      );
  }
}
