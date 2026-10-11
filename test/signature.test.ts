import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/signature";
import { SECRET, sign } from "./helpers";

describe("verifySignature", () => {
  const body = '{"a":1}';

  it("accepts a correct signature", async () => {
    expect(await verifySignature(body, await sign(body), SECRET)).toBe(true);
  });
  it("rejects a changed body", async () => {
    expect(await verifySignature('{"a":2}', await sign(body), SECRET)).toBe(false);
  });
  it("rejects the wrong secret", async () => {
    expect(await verifySignature(body, await sign(body, "other"), SECRET)).toBe(false);
  });
  it("rejects a missing header", async () => {
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, undefined, SECRET)).toBe(false);
  });
  it("rejects a header without the sha256= prefix", async () => {
    const h = (await sign(body)).replace("sha256=", "");
    expect(await verifySignature(body, h, SECRET)).toBe(false);
  });
  it("rejects bad hex and empty signatures", async () => {
    expect(await verifySignature(body, "sha256=zz", SECRET)).toBe(false);
    expect(await verifySignature(body, "sha256=abc", SECRET)).toBe(false);
    expect(await verifySignature(body, "sha256=", SECRET)).toBe(false);
  });
  it("rejects when no secret is configured", async () => {
    expect(await verifySignature(body, await sign(body), "")).toBe(false);
  });
});
