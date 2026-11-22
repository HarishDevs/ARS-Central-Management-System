import { describe, expect, it } from "vitest";
import { codewords, encodeQr, formatBits, qrPath, rsRemainder, versionFor } from "@/lib/qr/encode";

// v1.66.0 (D-374): our own QR encoder for form links. Checked against the
// standard's fixed values (format words, Reed–Solomon) and by reading the
// matrix back: the format bits in both copies, then every data codeword
// along the zigzag with the mask removed.
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

describe("QR encoder", () => {
  it("uses the standard format words for level M", () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(5)).toBe(0b100000011001110);
    expect(formatBits(4)).toBe(0b100010111111001);
    expect(formatBits(7)).toBe(0b100101010100000);
  });

  it("computes Reed–Solomon error correction (the standard's 1-M example)", () => {
    // ISO/IEC 18004 Annex I: "01234567" in numeric mode, version 1-M.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it("picks the smallest version that fits, and refuses what is too long", () => {
    expect(versionFor(10)).toBe(1);
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(70)).toBe(5);
    expect(versionFor(213)).toBe(10);
    expect(encodeQr("x".repeat(400))).toBeNull();
  });

  it.each(["https://approval.arssteels.net/users/forms/AbCdEfGhIjKlMnOpQrStUv", "HELLO", "x".repeat(150)])("reads back what it wrote: %s", (text) => {
    const bytes = new TextEncoder().encode(text);
    const version = versionFor(bytes.length)!;
    const expected = codewords(bytes, version);
    for (const mask of [0, 3, 6]) {
      const grid = encodeQr(text, mask)!;
      const size = grid.length;
      expect(size).toBe(version * 4 + 17);
      // Finder pattern corners and the dark module.
      expect(grid[0]![0]).toBe(true);
      expect(grid[0]![size - 1]).toBe(true);
      expect(grid[size - 1]![0]).toBe(true);
      expect(grid[size - 8]![8]).toBe(true);
      // Format bits, both copies (bit i of the 15-bit word).
      const first: number[] = [];
      for (let i = 0; i <= 5; i += 1) first[i] = grid[i]![8] ? 1 : 0;
      first[6] = grid[7]![8] ? 1 : 0;
      first[7] = grid[8]![8] ? 1 : 0;
      first[8] = grid[8]![7] ? 1 : 0;
      for (let i = 9; i < 15; i += 1) first[i] = grid[8]![14 - i] ? 1 : 0;
      const second: number[] = [];
      for (let i = 0; i < 8; i += 1) second[i] = grid[8]![size - 1 - i] ? 1 : 0;
      for (let i = 8; i < 15; i += 1) second[i] = grid[size - 15 + i]![8] ? 1 : 0;
      const word = (bits: number[]) => bits.reduce((acc, bit, i) => acc | (bit << i), 0);
      expect(word(first)).toBe(formatBits(mask));
      expect(word(second)).toBe(formatBits(mask));
      // Data along the zigzag, unmasked, skipping function modules (as a reader does).
      const reserved = functionModules(version);
      const bits: number[] = [];
      for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert += 1)
          for (let j = 0; j < 2; j += 1) {
            const c = right - j;
            const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
            if (reserved[r]![c]) continue;
            bits.push(grid[r]![c] !== MASKS[mask]!(r, c) ? 1 : 0);
          }
      }
      const read: number[] = [];
      for (let i = 0; i + 8 <= bits.length && read.length < expected.length; i += 8) read.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
      expect(read).toEqual(expected);
    }
  });

  it("draws an SVG path with a quiet zone", () => {
    const grid = encodeQr("HELLO")!;
    const drawn = qrPath(grid);
    expect(drawn.size).toBe(grid.length + 8);
    expect(drawn.path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});

// Function modules (finders + separators, timing, alignment, format, version), independently of the encoder.
function functionModules(version: number): boolean[][] {
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) grid[r]![c] = true;
  };
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 8],
    [size - 8, 0],
  ] as const)
    for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) mark(r0 + r, c0 + c);
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  const step = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] } as Record<number, number[]>;
  const centres = step[version]!;
  for (const r of centres)
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
    }
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  if (version >= 7)
    for (let i = 0; i < 18; i += 1) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  return grid;
}
