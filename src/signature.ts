const PREFIX = "sha256=";

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Checks Meta's X-Hub-Signature-256 header against the raw request body.
 * Uses crypto.subtle.verify, which compares in constant time.
 */
export async function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string): Promise<boolean> {
  if (!header || !appSecret || !header.startsWith(PREFIX)) return false;
  const sig = hexToBytes(header.slice(PREFIX.length));
  if (!sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(rawBody));
}
