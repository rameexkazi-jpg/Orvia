import { BACKOFF_BASE_SECONDS, BACKOFF_MAX_SECONDS, CLAIM_LEASE_SECONDS, MAX_SEND_ATTEMPTS } from "./config";
import { log } from "./log";
import type { Env, Store } from "./types";
import { sendText } from "./whatsapp";

export interface SendDeps {
  store: Store;
  env: Env;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** (attempts - 1), BACKOFF_MAX_SECONDS);
}

/** Resolves the access token named by whatsapp_accounts.token_ref from the environment. */
function tokenFor(env: Env, ref: string): string | null {
  const v = (env as unknown as Record<string, unknown>)[ref];
  return typeof v === "string" && v ? v : null;
}

/** Tries one send for a stored outbound row. Safe to call twice: it skips rows that are no longer pending. */
export async function attemptSend(id: string, deps: SendDeps): Promise<"sent" | "retry" | "dead" | "skipped"> {
  const { store, env } = deps;
  const now = deps.now ?? (() => new Date());
  const msg = await store.getMessage(id);
  if (!msg || msg.direction !== "outbound" || msg.status !== "pending") return "skipped";

  const account = await store.findAccount(msg.phone_number_id);
  const to = await store.getContactWaId(msg.contact_id);
  const token = account ? tokenFor(env, account.token_ref) : null;
  const attempts = msg.attempts + 1;

  if (!account || !to || !token) {
    const error = !account ? "no account for phone_number_id" : !to ? "contact has no wa_id" : `token not set for ${account.token_ref}`;
    await store.deadLetter(msg, attempts, error);
    log("send_dead", { trace_id: msg.trace_id, message_id: msg.id, error });
    return "dead";
  }

  const result = await sendText({ graphVersion: env.GRAPH_API_VERSION, phoneNumberId: msg.phone_number_id, token }, to, msg.body ?? "", deps.fetch);
  if (result.ok) {
    await store.markSent(msg.id, result.messageId);
    log("send_ok", { trace_id: msg.trace_id, message_id: msg.id, wa_message_id: result.messageId, attempts });
    return "sent";
  }

  if (!result.retryable || attempts >= MAX_SEND_ATTEMPTS) {
    await store.deadLetter(msg, attempts, result.error);
    log("send_dead", { trace_id: msg.trace_id, message_id: msg.id, attempts, error: result.error });
    return "dead";
  }

  const next = new Date(now().getTime() + backoffSeconds(attempts) * 1000).toISOString();
  await store.scheduleRetry(msg.id, attempts, next, result.error);
  log("send_retry", { trace_id: msg.trace_id, message_id: msg.id, attempts, next_attempt_at: next, error: result.error });
  return "retry";
}

/** Cron entry point: takes due retries and tries them. */
export async function runRetries(deps: SendDeps, limit = 20): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const lease = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000).toISOString();
  const due = await deps.store.claimDue(now.toISOString(), lease, limit);
  for (const m of due) await attemptSend(m.id, deps);
  return due.length;
}
