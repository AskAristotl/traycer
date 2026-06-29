import { describe, expect, it } from "vitest";
import { createWebSecureStorage, createWebTokenStore } from "../web-storage";

function fakeStore(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("createWebSecureStorage", () => {
  it("round-trips and deletes a value", async () => {
    const s = createWebSecureStorage(fakeStore());
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
  });
});

describe("createWebTokenStore", () => {
  it("round-trips a token pair", async () => {
    const store = createWebTokenStore(fakeStore());
    expect(await store.get()).toBeNull();
    await store.set({ token: "t1", refreshToken: "r1" });
    expect(await store.get()).toEqual({ token: "t1", refreshToken: "r1" });
    await store.delete();
    expect(await store.get()).toBeNull();
  });

  it("returns null for malformed persisted JSON", async () => {
    const backing = fakeStore();
    backing.setItem("traycer.tokens", "{not json");
    const store = createWebTokenStore(backing);
    expect(await store.get()).toBeNull();
  });

  it("returns null when a persisted entry is missing a field", async () => {
    const backing = fakeStore();
    backing.setItem("traycer.tokens", JSON.stringify({ token: "only-token" }));
    const store = createWebTokenStore(backing);
    expect(await store.get()).toBeNull();
  });
});
