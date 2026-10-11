export interface Env {
  APP_NAME?: string;
  GRAPH_API_VERSION: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  // Default token. Each whatsapp_accounts.token_ref names the env var that holds its token.
  WHATSAPP_ACCESS_TOKEN: string;
}

export type MessageStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed";

export interface Account {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  token_ref: string;
}

export interface MessageRow {
  id: string;
  tenant_id: string;
  contact_id: string;
  phone_number_id: string;
  direction: "inbound" | "outbound";
  wa_message_id: string | null;
  type: string;
  body: string | null;
  status: MessageStatus;
  trace_id: string;
  reply_to_wa_message_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
}

export type NewMessage = Omit<MessageRow, "id" | "created_at" | "attempts" | "last_error">;

export interface Store {
  findAccount(phoneNumberId: string): Promise<Account | null>;
  upsertContact(tenantId: string, waId: string, name: string | null): Promise<{ id: string; wa_id: string }>;
  /** Returns true if the row was inserted, false if wa_message_id already existed. */
  insertInbound(row: NewMessage): Promise<boolean>;
  /** Returns null if a reply to this inbound message already exists. */
  insertPendingReply(row: NewMessage): Promise<MessageRow | null>;
  /** Moves an outbound row forward only. Returns the number of rows changed. */
  applyStatus(tenantId: string, waMessageId: string, status: MessageStatus): Promise<number>;
  getMessage(id: string): Promise<MessageRow | null>;
  getContactWaId(contactId: string): Promise<string | null>;
  markSent(id: string, waMessageId: string): Promise<void>;
  scheduleRetry(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void>;
  /** Marks the message failed and writes a dead_letters row. */
  deadLetter(msg: MessageRow, attempts: number, error: string): Promise<void>;
  /** Finds due pending sends and pushes their next_attempt_at to leaseUntil so only one runner takes each. */
  claimDue(nowIso: string, leaseUntilIso: string, limit: number): Promise<MessageRow[]>;
}
