import type { Account, MessageRow, MessageStatus, NewMessage, Store } from "./types";

// Talks to Supabase through its REST (PostgREST) API with the server-side key, so the Worker
// needs no database password. Row Level Security is on with no policies, so only this key can read or write.

// Statuses a given new status may overwrite. Status only moves forward.
const CAN_OVERWRITE: Record<string, string[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent", "delivered"],
};

export class SupabaseStore implements Store {
  // Wrapped on purpose: calling the global fetch as a method (this.f(...)) throws "Illegal invocation" on Workers.
  constructor(private url: string, private key: string, private f: typeof fetch = (input, init) => fetch(input, init)) {}

  private async req<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    // UNVERIFIED: new "sb_secret_" keys go in the apikey header only; legacy JWT keys also go in Authorization.
    const headers: Record<string, string> = { apikey: this.key, "content-type": "application/json" };
    if (!this.key.startsWith("sb_")) headers.authorization = `Bearer ${this.key}`;
    if (prefer) headers.prefer = prefer;
    const res = await this.f(`${this.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`supabase ${method} ${path.split("?")[0]} ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : []) as T;
  }

  async findAccount(phoneNumberId: string): Promise<Account | null> {
    const rows = await this.req<Account[]>("GET", `whatsapp_accounts?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=id,tenant_id,phone_number_id,token_ref&limit=1`);
    return rows[0] ?? null;
  }

  async upsertContact(tenantId: string, waId: string, name: string | null) {
    const row: Record<string, unknown> = { tenant_id: tenantId, wa_id: waId };
    if (name) row.name = name;
    const rows = await this.req<{ id: string; wa_id: string }[]>("POST", "contacts?on_conflict=tenant_id,wa_id&select=id,wa_id", row, "resolution=merge-duplicates,return=representation");
    return rows[0]!;
  }

  async insertInbound(row: NewMessage): Promise<boolean> {
    const rows = await this.req<unknown[]>("POST", "messages?on_conflict=wa_message_id&select=id", row, "resolution=ignore-duplicates,return=representation");
    return rows.length > 0;
  }

  async insertPendingReply(row: NewMessage): Promise<MessageRow | null> {
    const rows = await this.req<MessageRow[]>("POST", "messages?on_conflict=reply_to_wa_message_id", row, "resolution=ignore-duplicates,return=representation");
    return rows[0] ?? null;
  }

  async applyStatus(tenantId: string, waMessageId: string, status: MessageStatus): Promise<number> {
    const from = CAN_OVERWRITE[status];
    if (!from) return 0;
    const rows = await this.req<unknown[]>(
      "PATCH",
      `messages?tenant_id=eq.${tenantId}&wa_message_id=eq.${encodeURIComponent(waMessageId)}&direction=eq.outbound&status=in.(${from.join(",")})&select=id`,
      { status },
      "return=representation",
    );
    return rows.length;
  }

  async getMessage(id: string): Promise<MessageRow | null> {
    const rows = await this.req<MessageRow[]>("GET", `messages?id=eq.${id}&limit=1`);
    return rows[0] ?? null;
  }

  async getContactWaId(contactId: string): Promise<string | null> {
    const rows = await this.req<{ wa_id: string }[]>("GET", `contacts?id=eq.${contactId}&select=wa_id&limit=1`);
    return rows[0]?.wa_id ?? null;
  }

  async markSent(id: string, waMessageId: string): Promise<void> {
    await this.req("PATCH", `messages?id=eq.${id}&status=eq.pending`, { status: "sent", wa_message_id: waMessageId, next_attempt_at: null, last_error: null });
  }

  async scheduleRetry(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void> {
    await this.req("PATCH", `messages?id=eq.${id}&status=eq.pending`, { attempts, next_attempt_at: nextAttemptAt, last_error: error });
  }

  async deadLetter(msg: MessageRow, attempts: number, error: string): Promise<void> {
    await this.req("PATCH", `messages?id=eq.${msg.id}`, { status: "failed", attempts, next_attempt_at: null, last_error: error });
    await this.req("POST", "dead_letters", { tenant_id: msg.tenant_id, message_id: msg.id, payload: { to_contact_id: msg.contact_id, body: msg.body, trace_id: msg.trace_id }, error, attempts });
  }

  async claimDue(nowIso: string, leaseUntilIso: string, limit: number): Promise<MessageRow[]> {
    const due = await this.req<{ id: string }[]>("GET", `messages?direction=eq.outbound&status=eq.pending&next_attempt_at=lte.${encodeURIComponent(nowIso)}&select=id&order=next_attempt_at.asc&limit=${limit}`);
    const claimed: MessageRow[] = [];
    for (const { id } of due) {
      // The filter on next_attempt_at makes this a compare-and-set: a second runner gets an empty result.
      const rows = await this.req<MessageRow[]>(
        "PATCH",
        `messages?id=eq.${id}&status=eq.pending&next_attempt_at=lte.${encodeURIComponent(nowIso)}`,
        { next_attempt_at: leaseUntilIso },
        "return=representation",
      );
      if (rows[0]) claimed.push(rows[0]);
    }
    return claimed;
  }
}
