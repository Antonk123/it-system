import { describe, expect, it } from "vitest";

import { formatDuration, parseDuration } from "./duration";

describe("parseDuration", () => {
  it("parsar decimaltimmar", () => {
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2t")).toBe(120);
  });

  it("parsar kombinerade timmar och minuter", () => {
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("2t15min")).toBe(135);
  });

  it("parsar minuter och rena heltal", () => {
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("90")).toBe(90);
  });

  it("returnerar null för ogiltiga eller tomma värden", () => {
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration(" ")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formaterar minuter konsekvent", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});
