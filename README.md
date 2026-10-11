# Orvia

WhatsApp ordering for Pakistani businesses. Working name; it is set in `src/config.ts` and `wrangler.jsonc` (`APP_NAME`). The build brief is in `ORVIA-BUILD-BRIEF.md`.

Slice 1: a Cloudflare Worker that receives WhatsApp webhooks, stores messages in Supabase, and sends one reply.

## Layout

- `src/` Worker code: webhook handler, signature check, handshake, send client, retry outbox, Supabase store.
- `test/` Vitest tests with an in-memory store.
- `supabase/migrations/` schema. `supabase/seed.sql` dev tenant.
- `docs/open-questions.md` everything not yet verified.

## Run the tests

```bash
npm install
npm test
npm run typecheck
```

## Local run

1. Copy `.dev.vars.example` to `.dev.vars` and fill in the values.
2. `npm run dev` serves on `http://localhost:8787`.
3. Expose it with any public tunnel you like and point the Meta webhook at `https://<tunnel>/webhook/whatsapp`. No tunnel provider is built in.

## Deploy

```bash
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put SUPABASE_SECRET_KEY
npm run deploy
```

Then in the Meta dashboard (WhatsApp > Configuration) set the callback URL to `https://<worker>.workers.dev/webhook/whatsapp`, enter the verify token, and subscribe to the `messages` field.

## Endpoints

- `GET /healthz`
- `GET /webhook/whatsapp` Meta verification handshake.
- `POST /webhook/whatsapp` signed events. Bad signature gives 401 and nothing is stored.
