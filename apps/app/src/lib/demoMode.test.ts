import { describe, expect, it } from "vitest";
import { decideDemoMode } from "./demoMode";

describe("decideDemoMode", () => {
  it("is on when the API URL is unset or empty", () => {
    expect(decideDemoMode({ apiUrl: undefined, demoFlag: undefined })).toBe(true);
    expect(decideDemoMode({ apiUrl: "", demoFlag: undefined })).toBe(true);
  });
  it("is off when an API URL is set", () => {
    expect(decideDemoMode({ apiUrl: "https://api.example.com", demoFlag: undefined })).toBe(false);
    expect(decideDemoMode({ apiUrl: "https://api.example.com", demoFlag: "0" })).toBe(false);
  });
  it("is forced on by EXPO_PUBLIC_DEMO=1 even with an API URL", () => {
    expect(decideDemoMode({ apiUrl: "https://api.example.com", demoFlag: "1" })).toBe(true);
  });
});
