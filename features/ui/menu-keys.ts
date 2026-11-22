// v1.72.0 (D-387): the arrow-key and letter moves of a dropdown menu
// (features/ui/MenuCore.tsx). Pure and unit-tested.

// The next item for ↓ ↑ Home End (wrapping), or null for any other key.
export function menuMove(count: number, index: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return index < 0 ? 0 : (index + 1) % count;
  if (key === "ArrowUp") return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// The next item (after the current one, wrapping) whose label starts with the letter.
export function menuTypeahead(labels: readonly string[], index: number, letter: string): number | null {
  const wanted = letter.toLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const at = (index + step + labels.length) % labels.length;
    if ((labels[at] ?? "").trim().toLowerCase().startsWith(wanted)) return at;
  }
  return null;
}
