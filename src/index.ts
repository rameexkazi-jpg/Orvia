import { Hono } from "hono";
import { DEFAULT_APP_NAME } from "./config";
import { verifyHandshake } from "./handshake";
import { log } from "./log";
import { attemptSend, runRetries } from "./outbox";
import { SupabaseStore } from "./supabaseStore";
import type { Env } from "./types";
import { processWebhook } from "./webhook";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ ok: true, app: c.env.APP_NAME ?? DEFAULT_APP_NAME }));

app.get("/webhook/whatsapp", (c) => {
  const r = verifyHandshake(new URL(c.req.url).searchParams, c.env.WHATSAPP_VERIFY_TOKEN);
  if (!r.ok) return c.text("forbidden", 403);
  return c.text(r.challenge, 200);
});

app.post("/webhook/whatsapp", async (c) => {
  const traceId = crypto.randomUUID();
  const rawBody = await c.req.text();
  const store = new SupabaseStore(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  try {
    const result = await processWebhook({ rawBody, signature: c.req.header("x-hub-signature-256"), traceId }, store, c.env);
    if (result.status !== 200) return c.json({ error: result.status === 401 ? "invalid signature" : "bad request" }, result.status);
    // Respond now, send after. If this is lost, the cron picks the pending row up.
    c.executionCtx.waitUntil(Promise.all(result.sendIds.map((id) => attemptSend(id, { store, env: c.env }))));
    return c.json({ ok: true });
  } catch (e) {
    // A 5xx makes Meta retry. Replays are safe because wa_message_id is unique.
    log("webhook_error", { trace_id: traceId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: "internal" }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
    ctx.waitUntil(runRetries({ store, env }).then((n) => log("retry_run", { claimed: n })));
  },
};
