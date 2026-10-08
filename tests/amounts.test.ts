import { describe, expect, it } from "vitest";
import { computeFee, formatRaw, parseRaw, parseUiAmount } from "@/lib/amounts";

describe("amounts", () => {
  it("parses UI amounts without floats", () => {
    expect(parseUiAmount("1.5", 9)).toBe(1_500_000_000n);
    expect(parseUiAmount("0.000000001", 9)).toBe(1n);
    expect(parseUiAmount("123", 0)).toBe(123n);
    expect(() => parseUiAmount("1.0000000001", 9)).toThrow();
    expect(() => parseUiAmount("-1", 9)).toThrow();
    expect(() => parseUiAmount("1e5", 9)).toThrow();
    expect(() => parseUiAmount("18446744073709551616", 0)).toThrow();
  });
  it("parses raw strings strictly", () => {
    expect(parseRaw("42")).toBe(42n);
    expect(() => parseRaw("4.2")).toThrow();
    expect(() => parseRaw(" 42")).toThrow();
  });
  it("formats", () => {
    expect(formatRaw(1_500_000_000n, 9)).toBe("1.5");
    expect(formatRaw(1_234_567_000_000n, 6)).toBe("1,234,567");
  });
  it("computes fee as floor(gross * bps / 10000)", () => {
    expect(computeFee(2_000_000_000n, 50)).toBe(10_000_000n);
    expect(computeFee(199n, 50)).toBe(0n);
    expect(computeFee(201n, 50)).toBe(1n);
    expect(() => computeFee(1n, -1)).toThrow();
  });
});
