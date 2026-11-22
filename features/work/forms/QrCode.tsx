"use client";

import { useMemo } from "react";
import { encodeQr, qrPath } from "@/lib/qr/encode";

// v1.66.0 (D-374): a QR code of a form's link, drawn as one SVG path (our own
// encoder, lib/qr/encode.ts). Dark modules on a light square in both themes,
// so phone cameras read it whatever the app's theme.
export function QrCode({ text, label, size = 176 }: { text: string; label: string; size?: number }) {
  const drawn = useMemo(() => {
    const grid = encodeQr(text);
    return grid ? qrPath(grid) : null;
  }, [text]);
  if (!drawn) return <p className="text-caption text-ink-muted">This link is too long for a QR code.</p>;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${drawn.size} ${drawn.size}`} width={size} height={size} className="rounded-md border border-line" shapeRendering="crispEdges" data-testid="form-qr">
      <rect width={drawn.size} height={drawn.size} fill="#ffffff" />
      <path d={drawn.path} fill="#000000" />
    </svg>
  );
}
