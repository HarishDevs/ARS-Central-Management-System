// v1.66.0 (D-374): our own small QR code encoder for the form share link (no
// new dependency). Byte mode, error correction level M, versions 1–10 (up to
// 213 bytes: plenty for a link), the mask with the lowest penalty. Follows
// ISO/IEC 18004; pure, unit-tested (format bits, Reed–Solomon, layout).

export type QrMatrix = boolean[][]; // [row][column], true = dark

// Data codewords and error-correction layout per version for level M:
// [ecc codewords per block, [block count, data codewords per block]...]
const M_LAYOUT: Record<number, { ecPerBlock: number; groups: [number, number][] }> = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
  7: { ecPerBlock: 18, groups: [[4, 31]] },
  8: { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9: { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};
const ALIGNMENT: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
export const MAX_VERSION = 10;

const dataCapacity = (version: number) => M_LAYOUT[version]!.groups.reduce((sum, [count, size]) => sum + count * size, 0);

// ---- Reed–Solomon over GF(256), polynomial 0x11D ------------------------------------------
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
})();
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

export function rsGenerator(degree: number): number[] {
  // Coefficients from highest to lowest power, leading 1 omitted.
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ mul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly.slice(1);
}
export function rsRemainder(data: readonly number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i += 1) result[i] = result[i]! ^ mul(generator[i]!, factor);
  }
  return result;
}

// ---- format and version information ---------------------------------------------------------
// 15 bits: level M (00) + mask, BCH(15,5), XOR 0x5412.
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---- encoding ----------------------------------------------------------------------------------
export function codewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCapacity(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  // Split into blocks, add error correction, interleave.
  const { ecPerBlock, groups } = M_LAYOUT[version]!;
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: rsRemainder(chunk, ecPerBlock) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]!);
  for (let i = 0; i < ecPerBlock; i += 1) for (const block of blocks) out.push(block.ec[i]!);
  return out;
}

export function versionFor(byteLength: number): number | null {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const header = 4 + (version < 10 ? 8 : 16);
    if (header + byteLength * 8 <= dataCapacity(version) * 8) return version;
  }
  return null;
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function build(version: number, data: readonly number[], mask: number): QrMatrix {
  const size = version * 4 + 17;
  const grid: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    grid[r]![c] = dark;
    fixed[r]![c] = true;
  };
  // Finder patterns with separators.
  for (const [row, col] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r += 1)
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(rr, cc, ring !== 2 && ring !== 4);
      }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns.
  const centres = ALIGNMENT[version]!;
  for (const r of centres)
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  // Format information (and the dark module).
  const format = formatBits(mask);
  // set(row, column): bits 0–7 run down column 8 by the top-left finder (and
  // along row 8 by the top-right), bits 8–14 along row 8 (and up column 8 by
  // the bottom-left finder).
  const bitOf = (i: number) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) set(i, 8, bitOf(i));
  set(7, 8, bitOf(6));
  set(8, 8, bitOf(7));
  set(8, 7, bitOf(8));
  for (let i = 9; i < 15; i += 1) set(8, 14 - i, bitOf(i));
  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, bitOf(i));
  for (let i = 8; i < 15; i += 1) set(size - 15 + i, 8, bitOf(i));
  set(size - 8, 8, true);
  // Version information (version 7 and up).
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  // Data, in the zigzag from the bottom right, two columns at a time.
  let bit = 0;
  const total = data.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fixed[r]![c]) continue;
        let dark = false;
        if (bit < total) dark = ((data[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1;
        bit += 1;
        grid[r]![c] = dark !== MASKS[mask]!(r, c);
      }
    }
  }
  return grid;
}

// The ISO penalty score (lower is better).
export function penalty(grid: QrMatrix): number {
  const size = grid.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
    // Finder-like 1:1:3:1:1 with four light modules on either side.
    for (let i = 0; i + 10 < size; i += 1) {
      const pattern = [true, false, true, true, true, false, true];
      const matches = pattern.every((value, k) => get(i + k) === value);
      if (!matches) continue;
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
      const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k));
      if (before || after) score += 40;
    }
  };
  for (let r = 0; r < size; r += 1) line((i) => grid[r]![i]!);
  for (let c = 0; c < size; c += 1) line((i) => grid[i]![c]!);
  for (let r = 0; r + 1 < size; r += 1)
    for (let c = 0; c + 1 < size; c += 1) {
      const v = grid[r]![c];
      if (v === grid[r]![c + 1] && v === grid[r + 1]![c] && v === grid[r + 1]![c + 1]) score += 3;
    }
  const dark = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

// The QR code for `text` (UTF-8), or null when it is too long for version 10.
export function encodeQr(text: string, forcedMask?: number): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) return null;
  const data = codewords(bytes, version);
  if (forcedMask !== undefined) return build(version, data, forcedMask);
  let best: QrMatrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = build(version, data, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return best;
}

// One SVG path for the dark modules (with a 4-module quiet zone).
export function qrPath(grid: QrMatrix): { path: string; size: number } {
  const parts: string[] = [];
  grid.forEach((row, r) => row.forEach((dark, c) => dark && parts.push(`M${c + 4} ${r + 4}h1v1h-1z`)));
  return { path: parts.join(""), size: grid.length + 8 };
}
