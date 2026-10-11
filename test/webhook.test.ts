import { describe, expect, it } from "vitest";
import { attemptSend, backoffSeconds, runRetries } from "../src/outbox";
import { processWebhook } from "../src/webhook";
import { MemoryStore } from "./memoryStore";
import { env, sign, statusPayload, textPayload } from "./helpers";

async function post(store: MemoryStore, body: string, signature?: string | null) {
  return processWebhook({ rawBody: body, signature: signature === undefined ? await sign(body) : signature, traceId: "trace-1" }, store, env);
}

const okFetch = (id = "wamid.OUT1") =>
  (async () => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 })) as unknown as typeof fetch;
const failFetch = (status: number) =>
  (async () => new Response(JSON.stringify({ error: { code: 1, message: "nope" } }), { status })) as unknown as typeof fetch;

describe("inbound text", () => {
  it("stores the inbound message and one pending reply, then sends it", async () => {
    const store = new MemoryStore();
    const r = await post(store, textPayload());
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.sendIds).toHaveLength(1);
    expect(store.messages.map((m) => m.direction).sort()).toEqual(["inbound", "outbound"]);

    expect(await attemptSend(r.sendIds[0]!, { store, env, fetch: okFetch() })).toBe("sent");
    const out = store.messages.find((m) => m.direction === "outbound")!;
    expect(out.status).toBe("sent");
    expect(out.wa_message_id).toBe("wamid.OUT1");
    expect(out.trace_id).toBe("trace-1");
    expect(out.phone_number_id).toBe("PNID");
  });

  it("does not store or reply to a replayed payload", async () => {
    const store = new MemoryStore();
    const body = textPayload();
    await post(store, body);
    const again = await post(store, body);
    expect(again.status).toBe(200);
    if (again.status === 200) expect(again.sendIds).toHaveLength(0);
    expect(store.messages).toHaveLength(2);
  });

  it("ignores a message sent to an unknown phone number id", async () => {
    const store = new MemoryStore();
    store.accounts = [];
    const r = await post(store, textPayload());
    expect(r.status).toBe(200);
    expect(store.messages).toHaveLength(0);
  });

  it("stores a non-text message without replying", async () => {
    const store = new MemoryStore();
    const body = textPayload().replace('"type":"text"', '"type":"image"');
    const r = await post(store, body);
    expect(r.status === 200 && r.sendIds.length).toBe(0);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.type).toBe("image");
  });
});

describe("signature gate", () => {
  it("returns 401 and stores nothing for a bad signature", async () => {
    const store = new MemoryStore();
    const r = await post(store, textPayload(), "sha256=" + "0".repeat(64));
    expect(r.status).toBe(401);
    expect(store.messages).toHaveLength(0);
    expect(store.contacts).toHaveLength(0);
  });
  it("returns 401 for a missing signature", async () => {
    const store = new MemoryStore();
    expect((await post(store, textPayload(), null)).status).toBe(401);
    expect(store.messages).toHaveLength(0);
  });
  it("returns 400 for a signed body that is not JSON", async () => {
    const store = new MemoryStore();
    expect((await post(store, "not json")).status).toBe(400);
  });
});

describe("status updates", () => {
  async function sentStore() {
    const store = new MemoryStore();
    const r = await post(store, textPayload());
    if (r.status !== 200) throw new Error("setup");
    await attemptSend(r.sendIds[0]!, { store, env, fetch: okFetch("wamid.OUT1") });
    return store;
  }

  it("updates the stored outbound row and does not insert", async () => {
    const store = await sentStore();
    await post(store, statusPayload("wamid.OUT1", "delivered"));
    await post(store, statusPayload("wamid.OUT1", "read"));
    expect(store.messages).toHaveLength(2);
    expect(store.messages.find((m) => m.direction === "outbound")!.status).toBe("read");
  });

  it("does not move a status backwards", async () => {
    const store = await sentStore();
    await post(store, statusPayload("wamid.OUT1", "read"));
    await post(store, statusPayload("wamid.OUT1", "delivered"));
    expect(store.messages.find((m) => m.direction === "outbound")!.status).toBe("read");
  });

  it("records a failed status", async () => {
    const store = await sentStore();
    await post(store, statusPayload("wamid.OUT1", "failed"));
    expect(store.messages.find((m) => m.direction === "outbound")!.status).toBe("failed");
  });

  it("ignores a status for an id we never stored", async () => {
    const store = await sentStore();
    const r = await post(store, statusPayload("wamid.UNKNOWN", "read"));
    expect(r.status).toBe(200);
    expect(store.messages).toHaveLength(2);
  });
});

describe("retries and dead letters", () => {
  async function pendingStore() {
    const store = new MemoryStore();
    const r = await post(store, textPayload());
    if (r.status !== 200) throw new Error("setup");
    return { store, id: r.sendIds[0]! };
  }

  it("backs off exponentially", () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([30, 60, 120]);
    expect(backoffSeconds(30)).toBe(3600);
  });

  it("schedules a retry on a 5xx and dead-letters after the last attempt", async () => {
    const { store, id } = await pendingStore();
    const t0 = new Date("2026-10-12T00:00:00Z");
    expect(await attemptSend(id, { store, env, fetch: failFetch(503), now: () => t0 })).toBe("retry");
    const m = store.messages.find((x) => x.id === id)!;
    expect(m.attempts).toBe(1);
    expect(m.status).toBe("pending");
    expect(m.next_attempt_at).toBe(new Date(t0.getTime() + 30_000).toISOString());

    m.attempts = 5;
    expect(await attemptSend(id, { store, env, fetch: failFetch(503) })).toBe("dead");
    expect(m.status).toBe("failed");
    expect(store.deadLetters).toEqual([{ message_id: id, error: expect.stringContaining("503"), attempts: 6 }]);
  });

  it("dead-letters a 4xx straight away", async () => {
    const { store, id } = await pendingStore();
    expect(await attemptSend(id, { store, env, fetch: failFetch(400) })).toBe("dead");
    expect(store.deadLetters).toHaveLength(1);
  });

  it("dead-letters when the token env var is missing", async () => {
    const { store, id } = await pendingStore();
    expect(await attemptSend(id, { store, env: { ...env, WHATSAPP_ACCESS_TOKEN: "" }, fetch: okFetch() })).toBe("dead");
  });

  it("does not send a row twice", async () => {
    const { store, id } = await pendingStore();
    await attemptSend(id, { store, env, fetch: okFetch() });
    expect(await attemptSend(id, { store, env, fetch: okFetch("wamid.OUT2") })).toBe("skipped");
  });

  it("cron picks up only due rows", async () => {
    const { store, id } = await pendingStore();
    const m = store.messages.find((x) => x.id === id)!;
    const now = new Date("2026-10-12T00:00:00Z");
    m.next_attempt_at = new Date(now.getTime() + 60_000).toISOString();
    expect(await runRetries({ store, env, fetch: okFetch(), now: () => now })).toBe(0);
    m.next_attempt_at = new Date(now.getTime() - 1000).toISOString();
    expect(await runRetries({ store, env, fetch: okFetch(), now: () => now })).toBe(1);
    expect(m.status).toBe("sent");
  });
});
