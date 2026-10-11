export type HandshakeResult = { ok: true; challenge: string } | { ok: false };

/** Meta's GET verification: echo hub.challenge only if mode and token match. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): HandshakeResult {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !verifyToken || token !== verifyToken || challenge === null) return { ok: false };
  return { ok: true, challenge };
}
