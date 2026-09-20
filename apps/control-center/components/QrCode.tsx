import qrcode from "qrcode-generator";

/**
 * Renders an `otpauth://` URI as a scannable QR code, as inline SVG.
 *
 * Generated in the browser from the secret already on the page — nothing is sent
 * anywhere. D-017 originally declined QR codes partly because a third-party image
 * service would have meant handing someone else the secret; that objection is what
 * this avoids, rather than something it accepts.
 *
 * The panel is deliberately white with dark modules whatever the surrounding theme.
 * Scanners expect that contrast, and an inverted code is unreliable to read.
 */
export function QrCode({ value, size = 184 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M"); // 0 picks the smallest version that fits
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4; // the spec's mandatory quiet zone; without it scanners struggle
  const extent = count + quiet * 2;

  const modules: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        modules.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code containing your authenticator setup key"
      shapeRendering="crispEdges"
      style={{ display: "block", background: "#FFFFFF", borderRadius: 6 }}
    >
      <path d={modules.join("")} fill="#0B1418" />
    </svg>
  );
}
