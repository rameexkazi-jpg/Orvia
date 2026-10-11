import { describe, expect, it } from "vitest";
import { verifyHandshake } from "../src/handshake";

const q = (s: string) => new URLSearchParams(s);

describe("verifyHandshake", () => {
  it("echoes the challenge when mode and token match", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345"), "tok")).toEqual({ ok: true, challenge: "12345" });
  });
  it("rejects a wrong token", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1"), "tok").ok).toBe(false);
  });
  it("rejects a wrong mode", () => {
    expect(verifyHandshake(q("hub.mode=unsubscribe&hub.verify_token=tok&hub.challenge=1"), "tok").ok).toBe(false);
  });
  it("rejects a missing challenge", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=tok"), "tok").ok).toBe(false);
  });
  it("rejects when no verify token is configured", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), "").ok).toBe(false);
  });
});
