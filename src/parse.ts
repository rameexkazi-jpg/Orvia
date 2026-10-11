// Shapes follow Meta's WhatsApp Cloud API webhook payload for the "messages" field.
// UNVERIFIED: read from memory and the sample events in the Meta dashboard; confirm against the webhook reference docs.

export interface InboundMessage {
  phoneNumberId: string;
  waId: string;
  name: string | null;
  id: string;
  type: string;
  text: string | null;
  timestamp: string | null;
}

export interface StatusUpdate {
  phoneNumberId: string;
  id: string;
  status: string;
  recipientId: string | null;
  errors: unknown;
}

export interface ParsedPayload {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One payload can hold several entries, changes, messages and statuses. */
export function parsePayload(payload: unknown): ParsedPayload {
  const out: ParsedPayload = { messages: [], statuses: [] };
  if (!isObj(payload)) return out;
  for (const entry of arr(payload.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) continue;
      const value = change.value;
      const phoneNumberId = isObj(value.metadata) ? str(value.metadata.phone_number_id) : null;
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        if (isObj(c) && str(c.wa_id) && isObj(c.profile) && str(c.profile.name)) names.set(c.wa_id as string, c.profile.name as string);
      }

      for (const m of arr(value.messages)) {
        if (!isObj(m)) continue;
        const id = str(m.id);
        const from = str(m.from);
        if (!id || !from) continue;
        const type = str(m.type) ?? "unknown";
        out.messages.push({
          phoneNumberId,
          waId: from,
          name: names.get(from) ?? null,
          id,
          type,
          text: type === "text" && isObj(m.text) ? str(m.text.body) : null,
          timestamp: str(m.timestamp),
        });
      }

      for (const s of arr(value.statuses)) {
        if (!isObj(s)) continue;
        const id = str(s.id);
        const status = str(s.status);
        if (!id || !status) continue;
        out.statuses.push({ phoneNumberId, id, status, recipientId: str(s.recipient_id), errors: s.errors ?? null });
      }
    }
  }
  return out;
}
