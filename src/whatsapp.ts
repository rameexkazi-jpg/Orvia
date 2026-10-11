// Send client for the WhatsApp Cloud API.
// Path and Bearer auth match the cURL sample in the Meta dashboard (POST /{phone_number_id}/messages).
// UNVERIFIED: the text-message body shape and the error-code behaviour below come from memory,
// not from docs I could read. Confirm against the Cloud API "send messages" reference.

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; retryable: boolean };

export interface SendConfig {
  graphVersion: string;
  phoneNumberId: string;
  token: string;
}

export async function sendText(cfg: SendConfig, to: string, body: string, f: typeof fetch = fetch): Promise<SendResult> {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  try {
    const res = await f(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
    const id = json?.messages?.[0]?.id;
    if (res.ok && typeof id === "string") return { ok: true, messageId: id };
    const detail = json?.error ? `${json.error.code ?? ""} ${json.error.message ?? ""}`.trim() : "no error body";
    // 5xx and 429 are retried. Other 4xx (bad token, outside the 24h window, bad number) will not fix themselves.
    return { ok: false, error: `${res.status} ${detail}`.slice(0, 300), retryable: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}
