/**
 * Integer amount helpers. Settlement math never touches JS floats:
 * token amounts are raw base units and SOL is lamports, both as bigint.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const U64_MAX = (1n << 64n) - 1n;

const DIGITS = /^\d+$/;

/** Parse a raw integer string (as stored in signed orders). Rejects signs, decimals, leading junk. */
export function parseRaw(value: string): bigint {
  if (!DIGITS.test(value)) throw new Error(`Invalid raw amount: ${value}`);
  const n = BigInt(value);
  if (n > U64_MAX) throw new Error("Amount exceeds u64");
  return n;
}

/** Convert a user-entered decimal string ("1.5") into raw units with `decimals` places. */
export function parseUiAmount(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error("Enter a valid number");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals})`);
  const raw = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  if (raw > U64_MAX) throw new Error("Amount too large");
  return raw;
}

/** Format raw units as a decimal string, trimming trailing zeros. */
export function formatRaw(raw: bigint, decimals: number, maxFraction = decimals): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction);
  frac = frac.replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${frac ? "." + frac : ""}`;
}

export function formatSol(lamports: bigint, maxFraction = 9): string {
  return formatRaw(lamports, 9, maxFraction);
}

/** floor(a * b / c) */
export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("Division by zero");
  return (a * b) / c;
}

/** Fee for an OTC trade: floor(gross * bps / 10_000). */
export function computeFee(grossLamports: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error("Invalid fee bps");
  return mulDivFloor(grossLamports, BigInt(feeBps), 10_000n);
}

/**
 * Approximate SOL price per whole token, for display only.
 * Returns a string with up to `precision` significant fraction digits.
 */
export function impliedUnitPriceSol(lamports: bigint, tokenRaw: bigint, decimals: number): string {
  if (tokenRaw === 0n) return "—";
  // price (lamports per whole token) scaled by 1e9 for 9 extra digits of precision
  const scaled = (lamports * 10n ** BigInt(decimals) * 1_000_000_000n) / tokenRaw;
  return formatRaw(scaled, 18, 12);
}
