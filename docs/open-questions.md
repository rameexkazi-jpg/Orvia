# Open questions and UNVERIFIED items

Items marked UNVERIFIED were not confirmed in docs I could read. Check each before relying on it.

## Meta

- **Graph API version.** `v26.0` is set in `wrangler.jsonc` (`GRAPH_API_VERSION`). Source: search result summary of Meta's Graph API versions page (v26.0 released 2026-07-29; v25.0 released 2026-02-18). I could not open the page itself, and the dashboard cURL sample showed a v25.x URL. Confirm the current version in the dashboard and change the var if needed.
- **Text send body.** `{ messaging_product, to, type: "text", text: { body } }` is from memory. The path and Bearer auth match the dashboard cURL sample. Confirm in the Cloud API send-messages reference.
- **Webhook payload shapes** in `src/parse.ts` come from memory and the dashboard's sample events. Confirm against the webhook reference.
- **Error codes for retry.** Only HTTP status is used (5xx and 429 retry, other 4xx dead-letter). Specific Meta error codes (expired token, outside the 24-hour window) are not handled yet.
- **Message fees.** Whether replies inside the 24-hour window are free, and the per-message price for templates in Pakistan. Check Meta's pricing page.
- **Tech Provider.** Fees, PKR billing for Pakistani businesses, and review timeline (brief section "Things to confirm").

## Supabase

- **Secret key header.** For new `sb_secret_` keys the store sends only the `apikey` header. Legacy JWT keys send `Authorization` as well. Confirm against Supabase's API key docs.
- **Free-plan limits** (active projects, pausing after inactivity, database size). Free projects pause after a period of inactivity, which would break the webhook. Check current terms.

## Cloudflare

- **Workers Free limits** confirmed from the limits page on 2026-10-12: 100,000 requests per day, 10 ms CPU per request, 50 subrequests per request, 5 cron triggers per account.
- **Pages vs Workers.** The server is a Worker. Check Cloudflare's current guidance before putting the future dashboard on Pages.

## Known edges

- **Status before send response.** A `sent` or `delivered` status webhook could arrive before the send response is stored. The row has no `wa_message_id` yet, so that status update changes nothing. The later `read` status still lands. A cheap fix is to look up by `reply_to_wa_message_id` too. Not done in slice 1.
- **Lost send response.** If Meta accepts a send but the response is lost, the retry sends a second reply. The Cloud API has no idempotency key that I know of (UNVERIFIED).
- **Fixed reply text.** Slice 1 replies with a fixed English test message. Language matching comes in slice 3.

## Before selling Orvia

- **Move the Worker to its own Cloudflare account.** It currently runs on the account whose workers.dev subdomain carries a client's name (`horizon-infrastructure-engineering-pllc`). Decision on 2026-10-12: keep it until Orvia is ready to sell. Moving means a new workers.dev subdomain, re-setting the four secrets, and updating the callback URL in Meta.
- Rotate the temporary Meta access token (it was pasted in chat) and switch to a system user token.
