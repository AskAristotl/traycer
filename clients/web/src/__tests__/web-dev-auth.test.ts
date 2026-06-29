import { describe, expect, it } from "vitest";
import { parseDevAuthFragment } from "../web-dev-auth";

describe("parseDevAuthFragment", () => {
  it("parses a token|refresh fragment", () => {
    expect(parseDevAuthFragment("#devauth=abc|def")).toEqual({
      token: "abc",
      refreshToken: "def",
    });
  });

  it("decodes percent-encoded values", () => {
    const token = "ey.Jheader.sig";
    const refresh = "r/with slash+plus";
    const hash = `#devauth=${encodeURIComponent(token)}|${encodeURIComponent(refresh)}`;
    expect(parseDevAuthFragment(hash)).toEqual({
      token,
      refreshToken: refresh,
    });
  });

  it("handles a percent-encoded `|` separator (iOS Safari)", () => {
    expect(parseDevAuthFragment("#devauth=abc%7Cdef")).toEqual({
      token: "abc",
      refreshToken: "def",
    });
  });

  it("returns null without the devauth prefix", () => {
    expect(parseDevAuthFragment("#code=abc")).toBeNull();
    expect(parseDevAuthFragment("")).toBeNull();
  });

  it("returns null when the separator is missing", () => {
    expect(parseDevAuthFragment("#devauth=onlytoken")).toBeNull();
  });

  it("returns null when either part is empty", () => {
    expect(parseDevAuthFragment("#devauth=|def")).toBeNull();
    expect(parseDevAuthFragment("#devauth=abc|")).toBeNull();
  });
});
