# Orvia: build brief for Claude Code

Working name: Orvia (not yet cleared for domain or trademark; keep it in one config constant so it is easy to rename).
Owner: Rameez Qazi, Pine Peak Creatives.
Goal: a WhatsApp ordering and automation platform for Pakistani businesses, priced in PKR, with Urdu and Roman Urdu support. Later it becomes a Meta Tech Provider so many businesses can connect their own WhatsApp Business accounts.

## Rules for this build

- Ask me when something is unclear. Do not guess. If a fact about the Meta API, Whatchimp or a payment provider is not in the official docs you can read, mark it `UNVERIFIED` in a code comment and in `docs/open-questions.md`.
- Use the current Meta Graph API version from the official WhatsApp Cloud API docs. Do not hardcode a version from memory.
- No secrets in code or in git. Read them from environment variables and document them in `.env.example`.
- Keep the code private to my repo. Nothing in this brief needs to be published.
- Write plain, short comments. No marketing language in code or docs.

## Product scope for v1 (ordering)

Customer flow, over WhatsApp:
1. Customer messages the business number.
2. The assistant replies in the language the customer used (English, Urdu, or Roman Urdu).
3. The assistant collects the order (items, quantity, notes), shows a summary, and the customer confirms.
4. Payment: cash on pickup, or Easypaisa, JazzCash or bank transfer with a screenshot that staff confirm.
5. Customer gets status messages as staff move the order along.
6. A human can take over any conversation at any time.

Order states (forward only):
`RECEIVED -> PAYMENT_CONFIRMED -> PREPARING -> READY_FOR_PICKUP -> COMPLETED`
`CANCELLED` is allowed only from `RECEIVED` or `PAYMENT_CONFIRMED`. Cash orders skip the payment wait. An invalid change returns HTTP 409. Every change writes an audit row: actor, timestamp, previous state, new state, trace id.

Out of scope for v1: delivery, riders, broadcasts, flow builder, billing, automated payment confirmation, any delivery company integration.

## Slice 1: webhook loop (do this first, then stop and show me)

Build the smallest server that proves the Meta loop works on the test number.

- `GET /webhook/whatsapp`: handle Meta's verification handshake using `WHATSAPP_VERIFY_TOKEN`.
- `POST /webhook/whatsapp`: verify the `X-Hub-Signature-256` header using the app secret. Reject invalid signatures with 401. Return 200 quickly and process after.
- Idempotency: ignore a message whose Meta message id has already been stored.
- Parse incoming text messages and message status updates (sent, delivered, read, failed).
- Send one reply through the Cloud API using the access token from the environment.
- Store every inbound and outbound message with a timestamp, the phone number id and a trace id.
- Structured JSON logs.
- Retry failed outbound sends with exponential backoff. Keep failures in a dead-letter table.
- Health endpoint `GET /healthz`.

Acceptance for slice 1:
- Meta accepts the callback URL and the verify token.
- Sending a text to the test number produces a reply and two stored rows.
- Replaying the same webhook payload does not create a second reply.
- A payload with a bad signature gets 401 and is not stored.
- Tests cover signature checking, idempotency and the handshake.

For local testing I will use a public tunnel URL. Document how to run it, but do not hardcode a tunnel provider.

## Data model (multi-tenant from day one)

Even though v1 has one business, every table carries `tenant_id` so Tech Provider onboarding later does not need a rewrite.

- `tenants` (id, name, plan, created_at)
- `whatsapp_accounts` (id, tenant_id, waba_id, phone_number_id, display_name, token_ref)
- `contacts` (id, tenant_id, wa_id, name, language, opted_in_at)
- `messages` (id, tenant_id, contact_id, direction, wa_message_id unique, type, body, status, trace_id, created_at)
- `orders` (id, tenant_id, contact_id, state, total_pkr, payment_method, notes, created_at)
- `order_items` (id, order_id, name, qty, price_pkr)
- `order_events` (id, order_id, actor, from_state, to_state, trace_id, created_at)
- `dead_letters` (id, tenant_id, payload, error, attempts, created_at)

Tokens are never stored in plain text in the database. Store a reference and read the token from a secret store or environment.

## Slices after 1 (only start when I say so)

2. Order service and state machine, with tests for every allowed and blocked transition.
3. Ordering conversation in English, Urdu and Roman Urdu with scripted replies first. Add the AI assistant only after the scripted flow works. Language detection must handle Roman Urdu such as "mujhe 2 shirts chahiye".
4. Staff dashboard: live orders, payment confirmation queue, status buttons, conversation view, human takeover.
5. Message templates (Meta-approved) for anything sent outside the 24-hour reply window.
6. Reports: orders, revenue, conversations to orders.

## Suggested stack (change it if you have a better reason, and tell me why)

TypeScript, Node, a small HTTP framework, PostgreSQL, Vitest for tests. A simple React dashboard later. Keep the webhook server separate from the dashboard code.

## Pricing context (for later billing work, not v1)

Starter about PKR 4,000 to 5,000 per month, Growth about PKR 8,000 to 10,000 per month, Meta message fees passed through. These are estimates to test with real merchants, not final prices.

## Meta Tech Provider readiness (human steps, tracked here so they are not forgotten)

From Meta's Tech Provider guide:
1. Create the Meta app with the WhatsApp use case and a business portfolio. (Done: app "Orvia", portfolio "Pine Peak Creatives".)
2. Verify the business with Meta. This must happen before app review.
3. App review: app icon, privacy policy and category in the app settings; two videos (a message sent from the app and received in WhatsApp, and a template created with the app); documentation; then Begin App Review.
4. Advanced access to `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Webhooks must be live before clients can send, receive or manage templates.
6. Onboard clients with Embedded Signup. Clients must add a payment method to their WhatsApp Business Platform account.

Things to confirm with Meta, not assume: fees for Tech Provider status, whether Pakistani businesses can be billed in PKR, and the review timeline.

## What I need from you first

Before writing code, reply with:
1. The stack you plan to use and why.
2. A list of everything you need from me (tokens, URLs, secrets, accounts).
3. Anything in this brief that is unclear or conflicts with Meta's official docs.
Then build slice 1 only.
