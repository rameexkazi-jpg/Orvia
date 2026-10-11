import type { Account, MessageRow, MessageStatus, NewMessage, Store } from "../src/types";

const CAN_OVERWRITE: Record<string, string[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent", "delivered"],
};

/** In-memory fake that enforces the same unique keys as the database. */
export class MemoryStore implements Store {
  accounts: Account[] = [{ id: "acc1", tenant_id: "t1", phone_number_id: "PNID", token_ref: "WHATSAPP_ACCESS_TOKEN" }];
  contacts: { id: string; tenant_id: string; wa_id: string; name: string | null }[] = [];
  messages: MessageRow[] = [];
  deadLetters: { message_id: string; error: string; attempts: number }[] = [];
  private n = 0;

  async findAccount(phoneNumberId: string) {
    return this.accounts.find((a) => a.phone_number_id === phoneNumberId) ?? null;
  }

  async upsertContact(tenantId: string, waId: string, name: string | null) {
    let c = this.contacts.find((x) => x.tenant_id === tenantId && x.wa_id === waId);
    if (!c) {
      c = { id: `c${++this.n}`, tenant_id: tenantId, wa_id: waId, name };
      this.contacts.push(c);
    } else if (name) c.name = name;
    return { id: c.id, wa_id: c.wa_id };
  }

  private add(row: NewMessage): MessageRow {
    const m: MessageRow = { ...row, id: `m${++this.n}`, attempts: 0, last_error: null, created_at: new Date().toISOString() };
    this.messages.push(m);
    return m;
  }

  async insertInbound(row: NewMessage) {
    if (row.wa_message_id && this.messages.some((m) => m.wa_message_id === row.wa_message_id)) return false;
    this.add(row);
    return true;
  }

  async insertPendingReply(row: NewMessage) {
    if (this.messages.some((m) => m.reply_to_wa_message_id === row.reply_to_wa_message_id)) return null;
    return this.add(row);
  }

  async applyStatus(tenantId: string, waMessageId: string, status: MessageStatus) {
    const from = CAN_OVERWRITE[status] ?? [];
    const m = this.messages.find((x) => x.tenant_id === tenantId && x.wa_message_id === waMessageId && x.direction === "outbound" && from.includes(x.status));
    if (!m) return 0;
    m.status = status;
    return 1;
  }

  async getMessage(id: string) {
    return this.messages.find((m) => m.id === id) ?? null;
  }

  async getContactWaId(contactId: string) {
    return this.contacts.find((c) => c.id === contactId)?.wa_id ?? null;
  }

  async markSent(id: string, waMessageId: string) {
    const m = this.messages.find((x) => x.id === id && x.status === "pending");
    if (m) Object.assign(m, { status: "sent", wa_message_id: waMessageId, next_attempt_at: null, last_error: null });
  }

  async scheduleRetry(id: string, attempts: number, nextAttemptAt: string, error: string) {
    const m = this.messages.find((x) => x.id === id && x.status === "pending");
    if (m) Object.assign(m, { attempts, next_attempt_at: nextAttemptAt, last_error: error });
  }

  async deadLetter(msg: MessageRow, attempts: number, error: string) {
    const m = this.messages.find((x) => x.id === msg.id);
    if (m) Object.assign(m, { status: "failed", attempts, next_attempt_at: null, last_error: error });
    this.deadLetters.push({ message_id: msg.id, error, attempts });
  }

  async claimDue(nowIso: string, leaseUntilIso: string, limit: number) {
    const due = this.messages.filter((m) => m.direction === "outbound" && m.status === "pending" && m.next_attempt_at !== null && m.next_attempt_at <= nowIso).slice(0, limit);
    for (const m of due) m.next_attempt_at = leaseUntilIso;
    return due;
  }
}
