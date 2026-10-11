import type { Env } from "../src/types";

export const SECRET = "test-app-secret";

export const env: Env = {
  APP_NAME: "Orvia",
  GRAPH_API_VERSION: "v0.0-test",
  SUPABASE_URL: "http://unused",
  SUPABASE_SECRET_KEY: "unused",
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: "verify-me",
  WHATSAPP_ACCESS_TOKEN: "test-token",
};

export async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function textPayload(id = "wamid.IN1", text = "hello", from = "923001234567"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15556477104", phone_number_id: "PNID" },
      contacts: [{ profile: { name: "Test User" }, wa_id: from }],
      messages: [{ from, id, timestamp: "1760000000", type: "text", text: { body: text } }],
    } }] }],
  });
}

export function statusPayload(id: string, status: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15556477104", phone_number_id: "PNID" },
      statuses: [{ id, status, timestamp: "1760000001", recipient_id: "923001234567" }],
    } }] }],
  });
}
