import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseStore } from "../src/supabaseStore";

afterEach(() => vi.unstubAllGlobals());

describe("SupabaseStore default fetch", () => {
  it("calls the global fetch without a receiver (Workers throws Illegal invocation otherwise)", async () => {
    // Mimics the Workers rule: the global fetch must be called with no `this`.
    const seen: unknown[] = [];
    vi.stubGlobal("fetch", function (this: unknown) {
      seen.push(this);
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    const store = new SupabaseStore("http://x", "key");
    expect(await store.findAccount("PNID")).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("sends only the apikey header for sb_ keys", async () => {
    let headers: Record<string, string> = {};
    const f = (async (_u: unknown, init?: RequestInit) => {
      headers = init!.headers as Record<string, string>;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await new SupabaseStore("http://x", "sb_secret_abc", f).findAccount("1");
    expect(headers.apikey).toBe("sb_secret_abc");
    expect(headers.authorization).toBeUndefined();
  });
});
