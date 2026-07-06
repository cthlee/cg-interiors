# CG Interiors — Inquiry Backend

A serverless inquiry pipeline on Cloudflare: the contact form posts to a Pages
Function that **validates → blocks spam (Turnstile + honeypot) → saves to a D1
database → emails an auto-reply to the client and an alert to the studio** via
Resend. The lead is saved *before* any email is sent, so it is never lost.

```
Contact form ─▶ /api/inquiry (Pages Function)
                   ├─▶ D1 database        (permanent record)
                   └─▶ Resend  ─┬─▶ Auto-reply to client  (< 1 min)
                                └─▶ Alert to studio inbox
```

## Files

| Path | What it is |
|------|------------|
| `functions/api/inquiry.js` | The endpoint (POST `/api/inquiry`) |
| `schema.sql` | D1 table definition |
| `wrangler.toml` | Pages + D1 binding + non-secret vars |
| `.dev.vars.example` | Template for local secrets (`.dev.vars`) |
| `contact.html` / `assets/js/main.js` | Form: honeypot, Turnstile, real fetch POST |

---

## Accounts to prepare (one-time)

1. **Cloudflare** — free. Hosting, functions, database, Turnstile, DNS.
2. **Resend** — free (3k emails/mo). Transactional email.
3. **Your domain** — you have one. Needed so email lands in inboxes.
4. **A studio inbox** — where alerts go (e.g. `studio@yourdomain`).

---

## Setup

### 0. Install the CLI

```bash
npm install -g wrangler        # or use: npx wrangler ...
wrangler login
```

### 1. Create the database

```bash
wrangler d1 create cg-interiors-inquiries
```

Copy the printed `database_id` into `wrangler.toml` (replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID`). Then create the table:

```bash
wrangler d1 execute cg-interiors-inquiries --remote --file=./schema.sql
```

### 2. Set up Resend (email deliverability — the important step)

1. Create a Resend account and **add your domain** (Resend → Domains → Add).
2. Resend shows a few **DNS records** (SPF, DKIM, and a return-path/MX).
   Add them to your domain's DNS. If your domain uses **Cloudflare DNS**, add
   them under that domain's *DNS → Records*. Wait for Resend to show
   **"Verified"** (usually minutes).
3. Create an **API key** (Resend → API Keys).
4. Set `FROM_EMAIL` / `STUDIO_INBOX` in `wrangler.toml` to your real addresses.
   `FROM_EMAIL` **must** be on the verified domain, e.g.
   `CG Interiors <studio@yourdomain.com>`.

> Until the domain is verified you can test using Resend's sandbox sender
> `onboarding@resend.dev` (it can only email *your own* Resend account address).

### 3. Set up Turnstile (spam protection)

1. Cloudflare dashboard → **Turnstile → Add widget** (your domain).
2. Copy the **Site Key** → paste into `data-sitekey` on the `.cf-turnstile`
   div in `contact.html` (replacing the `1x00…AA` test key).
3. Copy the **Secret Key** → store it as a secret (next step).

### 4. Store secrets (never commit these)

```bash
wrangler pages secret put RESEND_API_KEY
wrangler pages secret put TURNSTILE_SECRET
```

(Or Cloudflare dashboard → Pages → your project → Settings → Variables & Secrets.)

### 5. Deploy

```bash
wrangler pages deploy .
```

Point your domain at the Pages project (Pages → Custom domains). Done.

---

## Test locally

```bash
cp .dev.vars.example .dev.vars     # fill in a Resend key + your test inbox
wrangler pages dev . --d1 DB=cg-interiors-inquiries
```

Open the printed URL, go to **/contact.html**, submit the form. The Turnstile
**test** keys always pass, so you can exercise the full path. Check the row:

```bash
wrangler d1 execute cg-interiors-inquiries --local \
  --command "SELECT id, created_at, name, email, project_type FROM inquiries ORDER BY id DESC LIMIT 5"
```

> Note: opening the static files directly (or via a plain `python -m http.server`)
> will **not** run the function — `/api/inquiry` only exists under
> `wrangler pages dev` or once deployed. Served statically, the form validates
> and then reports a friendly "try again" error, which is expected.

---

## Graceful degradation (build it up in stages)

The function checks for each capability and skips what isn't configured yet:

- **No `TURNSTILE_SECRET`** → spam check skipped (honeypot still active).
- **No `RESEND_API_KEY`** → emails skipped, inquiry still saved to D1.
- **No `DB` binding** → returns a 500 (this one is required).

So you can ship the database first, watch inquiries land, then add email.

---

## Reading inquiries

For now, inquiries arrive as **email alerts** and are stored in D1. Browse them:

```bash
wrangler d1 execute cg-interiors-inquiries --remote \
  --command "SELECT id, created_at, name, email, project_type, status FROM inquiries ORDER BY id DESC LIMIT 25"
```

When you want a point-and-click dashboard later, the clean upgrade is to move
storage to **Supabase** (managed Postgres with a built-in table viewer the
studio can log into) — the function's insert is the only part that changes.
