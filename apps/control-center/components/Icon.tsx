/**
 * The Kravio icon language (D-078), two-tone as on the reference site: the main shape
 * filled `#D9D9D9`, inner details `#F7F7F7`, every outline 1 px `#4B5563`. Portfolio, the
 * team glyph and the square and circle bodies are Kravio's own drawings, copied path for
 * path; the rest are drawn on the same grid in the same recipe.
 *
 * The colours are part of the drawing, so an icon no longer follows its link's text colour —
 * which is how Kravio behaves. A disabled nav item still dims through its own opacity.
 */
const FILL = "#D9D9D9";
const INNER = "#F7F7F7";
const INK = "#4B5563";

type Part = { d: string; fill?: string; stroke?: boolean; evenodd?: boolean };

// Kravio's shared bodies.
const SQUARE =
  "M1.665 8c0-2.986 0-4.478.928-5.406.927-.927 2.42-.927 5.405-.927 2.986 0 4.479 0 5.406.927.928.928.928 2.42.928 5.406 0 2.986 0 4.478-.928 5.406-.927.927-2.42.927-5.406.927-2.985 0-4.478 0-5.405-.927C1.665 12.478 1.665 10.986 1.665 8Z";
const WIDE =
  "M1.334 8c0-2.514 0-3.771.781-4.552.781-.781 2.038-.781 4.552-.781h2.667c2.514 0 3.771 0 4.552.781.781.781.781 2.038.781 4.552s0 3.771-.781 4.552c-.781.781-2.038.781-4.552.781H6.667c-2.514 0-3.771 0-4.552-.781C1.334 11.771 1.334 10.514 1.334 8Z";
const CIRCLE = "M8 14.667A6.667 6.667 0 1 0 8 1.333a6.667 6.667 0 0 0 0 13.334Z";
const DOC =
  "M8.666 1.667V2c0 1.886 0 2.828.586 3.414.586.586 1.528.586 3.414.586h.334m.333 1.104v2.229c0 2.514 0 3.771-.781 4.552-.781.782-2.038.782-4.553.782-2.514 0-3.77 0-4.552-.782-.781-.781-.781-2.038-.781-4.552V6.304c0-2.164 0-3.245.59-3.978.12-.148.255-.283.403-.402C4.392 1.333 5.473 1.333 7.637 1.333c.47 0 .705 0 .92.076.045.016.09.034.132.055.206.098.372.265.705.597l3.158 3.158c.385.385.578.578.68.823.1.245.1.518.1 1.063Z";
const TILE = (x: number, y: number) =>
  `M${x + 0.127} ${y + 3.971}C${x} ${y + 3.665} ${x} ${y + 3.277} ${x} ${y + 2.5}s0-1.165.127-1.471c.169-.408.493-.733.902-.902C${x + 1.335} ${y} ${x + 1.723} ${y} ${x + 2.5} ${y}s1.165 0 1.471.127c.408.169.733.493.902.902.127.306.127.694.127 1.471s0 1.165-.127 1.471c-.169.408-.493.733-.902.902C${x + 3.665} ${y + 5} ${x + 3.277} ${y + 5} ${x + 2.5} ${y + 5}s-1.165 0-1.471-.127a1.667 1.667 0 0 1-.902-.902Z`;

const GLYPHS: Record<string, Part[]> = {
  grid: [TILE(9, 9), TILE(9, 2), TILE(2, 9), TILE(2, 2)].map((d) => ({ d, fill: FILL, stroke: true })),
  plus: [
    { d: SQUARE, fill: FILL, stroke: true },
    { d: "M8 5.333v5.334M5.333 8h5.334", stroke: true },
  ],
  review: [
    { d: DOC, fill: FILL, stroke: true },
    { d: "M5.667 10.167 7 11.5l3-3", stroke: true },
  ],
  mail: [
    { d: WIDE, fill: FILL, stroke: true },
    { d: "M4 5.333 6.878 7.49c.664.498 1.58.498 2.244 0L12 5.333", stroke: true },
  ],
  archive: [
    {
      d: "M2.667 5.667v4.666c0 1.886 0 2.829.586 3.415.585.585 1.528.585 3.414.585h2.666c1.886 0 2.829 0 3.415-.585.585-.586.585-1.529.585-3.415V5.667",
      fill: FILL,
      stroke: true,
    },
    {
      d: "M1.667 3.667c0-.943 0-1.414.293-1.707.293-.293.764-.293 1.707-.293h8.666c.943 0 1.414 0 1.707.293.293.293.293.764.293 1.707s0 1.414-.293 1.707c-.293.293-.764.293-1.707.293H3.667c-.943 0-1.414 0-1.707-.293-.293-.293-.293-.764-.293-1.707Z",
      fill: INNER,
      stroke: true,
    },
    { d: "M6.667 8.667h2.666", stroke: true },
  ],
  users: [
    { d: "M11.002 7.167c2.254 0 4.165 1.672 4.165 3.833a.5.5 0 0 1-.5.5H1.334a.5.5 0 0 1-.5-.5c0-2.161 1.913-3.833 4.168-3.833h6Z", fill: FILL, evenodd: true },
    { d: "M14.667 11c0-1.841-1.642-3.333-3.667-3.333H5c-2.025 0-3.666 1.492-3.666 3.333", stroke: true },
    { d: "M10.322 7.567c.214.065.442.1.678.1a2.333 2.333 0 1 0-2.322-2.567", fill: FILL, stroke: true },
    { d: "M7.321 5.1A2.333 2.333 0 1 0 5 7.667c.235 0 .463-.035.678-.1", fill: FILL, stroke: true },
    { d: "M10.332 7.333a2.333 2.333 0 1 0-4.667 0 2.333 2.333 0 0 0 4.667 0Z", fill: INNER, stroke: true },
    { d: "M11.668 13c0-1.841-1.641-3.333-3.666-3.333-2.026 0-3.667 1.492-3.667 3.333", fill: INNER, stroke: true },
  ],
  sync: [
    { d: CIRCLE, fill: FILL, stroke: true },
    { d: "M10.833 6.667A3 3 0 0 0 5.2 6.9M10.833 5v1.667H9.167M5.167 9.333a3 3 0 0 0 5.633.234M5.167 11V9.333h1.666", stroke: true },
  ],
  monitor: [
    {
      d: "M1.334 6.667c0-2.2 0-3.3.683-3.983C2.7 2 3.8 2 6 2h4c2.2 0 3.3 0 3.983.684.684.683.684 1.783.684 3.983v.666c0 2.2 0 3.3-.684 3.984-.683.683-1.783.683-3.983.683H6c-2.2 0-3.3 0-3.983-.683-.683-.684-.683-1.784-.683-3.984Z",
      fill: FILL,
      stroke: true,
    },
    { d: "M8 12v2M5.333 14h5.334", stroke: true },
  ],
  shield: [
    { d: "M8 1.667 3 3.5v3.833c0 3.1 2.087 5.524 5 6.834 2.913-1.31 5-3.734 5-6.834V3.5Z", fill: FILL, stroke: true },
    { d: "M6.167 8 7.5 9.333l2.5-2.666", stroke: true },
  ],
  clipboard: [
    {
      d: "M5.333 2.667h-.666c-1.1 0-1.65 0-1.992.341-.342.342-.342.892-.342 1.992v6.667c0 1.414 0 2.121.44 2.56.439.44 1.146.44 2.56.44h5.334c1.414 0 2.121 0 2.56-.44.44-.439.44-1.146.44-2.56V5c0-1.1 0-1.65-.342-1.992-.341-.341-.891-.341-1.991-.341h-.667",
      fill: FILL,
      stroke: true,
    },
    {
      d: "M5.333 2.333c0-.471 0-.707.147-.853.146-.147.382-.147.853-.147h3.334c.471 0 .707 0 .853.147.147.146.147.382.147.853s0 .707-.147.854c-.146.146-.382.146-.853.146H6.333c-.471 0-.707 0-.853-.146-.147-.147-.147-.383-.147-.854Z",
      fill: INNER,
      stroke: true,
    },
    { d: "M5.333 7.333h5.334M5.333 10h3.334", stroke: true },
  ],
  globe: [
    { d: CIRCLE, fill: FILL, stroke: true },
    { d: "M8 1.333c1.667 1.825 2.5 4.047 2.5 6.667S9.667 12.842 8 14.667C6.333 12.842 5.5 10.62 5.5 8S6.333 3.158 8 1.333Z", fill: INNER, stroke: true },
    { d: "M1.333 8h13.334", stroke: true },
  ],
  lock: [
    { d: "M5 6.667V5a3 3 0 0 1 6 0v1.667", stroke: true },
    {
      d: "M2.667 10c0-1.886 0-2.828.585-3.414.586-.586 1.529-.586 3.415-.586h2.666c1.886 0 2.829 0 3.415.586.585.586.585 1.528.585 3.414s0 2.828-.585 3.414C12.162 14 11.219 14 9.333 14H6.667c-1.886 0-2.829 0-3.415-.586-.585-.586-.585-1.528-.585-3.414Z",
      fill: FILL,
      stroke: true,
    },
    { d: "M8 9.333v1.334", stroke: true },
  ],
  key: [
    { d: "M13.667 5.667a3.333 3.333 0 1 1-6.667 0 3.333 3.333 0 0 1 6.667 0Z", fill: FILL, stroke: true },
    { d: "M7.667 8.333 2 14M4 12l1.333 1.333M5.333 10.667 6.667 12M11 5h.006", stroke: true },
  ],
  logout: [
    {
      d: "M8.667 2.667h2c.943 0 1.414 0 1.707.293.293.293.293.764.293 1.707v6.666c0 .943 0 1.414-.293 1.707-.293.293-.764.293-1.707.293h-2Z",
      fill: FILL,
      stroke: true,
    },
    { d: "M10 8H2.667M5 5.667 2.667 8 5 10.333", stroke: true },
  ],
};

// Line-only glyphs that should follow the text colour (chevrons and the like).
const LINES: Record<string, string> = {
  chevrons: "M5 6 8 3l3 3M5 10l3 3 3-3",
};

export type IconName = keyof typeof GLYPHS | keyof typeof LINES;

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const frame = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, focusable: false } as const;
  const line = LINES[name];
  if (line) {
    return (
      <svg {...frame} stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        <path d={line} />
      </svg>
    );
  }
  const parts = GLYPHS[name];
  if (!parts) return null;
  return (
    <svg {...frame} strokeLinecap="round" strokeLinejoin="round">
      {parts.map((part, index) => (
        <path
          key={index}
          d={part.d}
          fill={part.fill ?? "none"}
          stroke={part.stroke ? INK : "none"}
          fillRule={part.evenodd ? "evenodd" : undefined}
        />
      ))}
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
