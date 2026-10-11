import { CLAIM_LEASE_SECONDS, DEFAULT_APP_NAME } from "./config";
import { log } from "./log";
import { parsePayload, type InboundMessage } from "./parse";
import { verifySignature } from "./signature";
import type { Env, MessageStatus, Store } from "./types";

export interface WebhookInput {
  rawBody: string;
  signature: string | null | undefined;
  traceId: string;
}

export type WebhookResult = { status: 401 | 400 } | { status: 200; sendIds: string[] };

const STATUS_MAP: Record<string, MessageStatus> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

export function replyText(env: Env, _m: InboundMessage): string {
  // Slice 1 reply is fixed. The ordering conversation comes in slice 3.
  return `Thanks, your message reached ${env.APP_NAME ?? DEFAULT_APP_NAME}. This is a test reply.`;
}

/**
 * Verifies the signature on the raw body, then stores inbound messages and status updates.
 * Nothing is written before the signature passes. Throws on storage errors so the caller can
 * return 5xx and let Meta retry; the unique wa_message_id makes that safe.
 */
export async function processWebhook(input: WebhookInput, store: Store, env: Env): Promise<WebhookResult> {
  const valid = await verifySignature(input.rawBody, input.signature, env.WHATSAPP_APP_SECRET);
  if (!valid) {
    log("webhook_rejected", { trace_id: input.traceId, reason: "bad_signature" });
    return { status: 401 };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    log("webhook_rejected", { trace_id: input.traceId, reason: "bad_json" });
    return { status: 400 };
  }

  const parsed = parsePayload(payload);
  const sendIds: string[] = [];

  for (const m of parsed.messages) {
    const account = await store.findAccount(m.phoneNumberId);
    if (!account) {
      log("webhook_unknown_number", { trace_id: input.traceId, phone_number_id: m.phoneNumberId });
      continue;
    }
    const contact = await store.upsertContact(account.tenant_id, m.waId, m.name);
    const inserted = await store.insertInbound({
      tenant_id: account.tenant_id,
      contact_id: contact.id,
      phone_number_id: m.phoneNumberId,
      direction: "inbound",
      wa_message_id: m.id,
      type: m.type,
      body: m.text,
      status: "received",
      trace_id: input.traceId,
      reply_to_wa_message_id: null,
      next_attempt_at: null,
    });
    if (!inserted) {
      log("webhook_duplicate", { trace_id: input.traceId, wa_message_id: m.id });
      continue;
    }
    log("inbound_stored", { trace_id: input.traceId, wa_message_id: m.id, type: m.type });
    if (m.type !== "text") continue;

    // The first send is tried right away. next_attempt_at keeps the cron from racing it.
    const holdUntil = new Date(Date.now() + CLAIM_LEASE_SECONDS * 1000).toISOString();
    const reply = await store.insertPendingReply({
      tenant_id: account.tenant_id,
      contact_id: contact.id,
      phone_number_id: m.phoneNumberId,
      direction: "outbound",
      wa_message_id: null,
      type: "text",
      body: replyText(env, m),
      status: "pending",
      trace_id: input.traceId,
      reply_to_wa_message_id: m.id,
      next_attempt_at: holdUntil,
    });
    if (reply) sendIds.push(reply.id);
  }

  for (const s of parsed.statuses) {
    const account = await store.findAccount(s.phoneNumberId);
    const mapped = STATUS_MAP[s.status];
    if (!account || !mapped) {
      log("status_ignored", { trace_id: input.traceId, status: s.status });
      continue;
    }
    // Updates the stored outbound row. Never inserts, so it cannot collide with message dedupe.
    const changed = await store.applyStatus(account.tenant_id, s.id, mapped);
    log("status_applied", { trace_id: input.traceId, wa_message_id: s.id, status: mapped, rows: changed });
  }

  return { status: 200, sendIds };
}
