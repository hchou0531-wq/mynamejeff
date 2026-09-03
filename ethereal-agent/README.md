# Ethereal Agent

A private Telegram operations agent for the Ethereal marketplace. Check earnings, review
orders, pull dashboard images, and fulfill Toy Code orders — without opening the dashboard.

Only Telegram user IDs you explicitly allow can talk to it. Everyone else gets `Not available.`

## Setup

**1. Create the bot**

Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow the prompts.
It gives you a token like `8123456789:AAH...`.

**2. Get your Telegram user ID**

Message [@userinfobot](https://t.me/userinfobot). It replies with your numeric ID.
This is a number, not your `@username`.

**3. Get the Ethereal admin token**

Ethereal uses the admin user's `id` as its API token. With the site's database reachable:

```bash
cd ..   # the main ethereal project
MONGO_URL=$(grep '^MONGO_URL' .env | cut -d= -f2-) DB_NAME=$(grep '^DB_NAME' .env | cut -d= -f2-) \
node -e "const{MongoClient}=require('mongodb');(async()=>{const c=await new MongoClient(process.env.MONGO_URL).connect();const a=await c.db(process.env.DB_NAME).collection('users').findOne({isAdmin:true});console.log(a.id);await c.close()})()"
```

Treat that value like a password — it grants full admin access to your API.

**4. Configure**

```bash
cp .env.example .env
```

Fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `ETHEREAL_API_KEY`.
`AI_API_KEY` is optional — see *AI analysis* below.

**5. Run**

```bash
npm start
```

Ethereal itself must be running (`npm run dev` in the parent project) and reachable at
`ETHEREAL_API_URL`.

## Commands

| Command | What it does |
| --- | --- |
| `/start`, `/help` | List commands |
| `/earnings` | Revenue + order counts for today / week / month, plus analysis |
| `/orders` | Recent orders. Also `/orders pending`, `/orders fulfilled`, `/orders today` |
| `/order <id>` | Full detail for one order |
| `/dashboard` | Dashboard image. Also `/dashboard earnings\|orders\|analytics` |
| `/fulfill <order_id> <code>` | **Stages** a Toy Code fulfillment — writes nothing yet |
| `/confirm <order_id>` | Carries out the staged fulfillment |

Plain questions work too: *"how much did I make today?"*, *"which orders need fulfillment?"*

`<order_id>` is the order number shown as `#1042`. The 6-character order code (`AB12CD`)
also works.

## Fulfillment safety

Delivering a Toy Code is irreversible, so it takes two steps. `/fulfill` only *stages* the
request after checking that the order exists, is a Toy Code order, is paid, and isn't
already fulfilled. Nothing is written until you reply `/confirm <order_id>`.

Before writing, the agent re-checks the order — so if it was fulfilled elsewhere (the
Discord dashboard, another operator) in the meantime, the confirm is refused rather than
delivering a second code. Success is only ever reported when the Ethereal API confirms it;
a failure says so and takes no further action.

Staged confirmations expire after 10 minutes and are scoped to the operator who staged them.

## AI analysis

`AI_API_KEY` is optional.

- **Without a key** — analysis is computed directly from your order data: week-over-week
  change, strongest category, pending count, average order value.
- **With a key** — the same figures are handed to Claude to describe in plain language, and
  free-text questions get a fuller answer.

Either way **every number comes from your Ethereal data**. The model is given finished
figures to describe; it is never asked to produce one, and its read-only tools are the only
way it can reach your data. It cannot fulfill orders — that is driven solely by the slash
commands you type.

## Notifications

The agent polls for paid Toy Code orders awaiting a code (`NOTIFY_POLL_SECONDS`, default
120) and messages you once per order. Set to `0` to disable. It never auto-fulfills.

## Tests

```bash
npm test
```

29 tests covering authorization, rate limiting, earnings maths, the fulfillment guard rails
(wrong type, unpaid, double-fulfill, API failure, cross-operator confirms), notification
dedupe, image rendering, and the guarantee that toy codes never reach the audit log. They
run against a fake Ethereal API — no bot token, network, or database needed.

## Notes on the build

- **Plain ESM JavaScript, not TypeScript.** The parent project is plain JS with no TS
  toolchain; adding one for this service would have meant a build step for no real gain.
  The module layout follows the spec exactly.
- **File-backed store, not a database engine.** Ethereal's MongoDB is the source of truth
  for orders and earnings. The agent only persists its own state — notification dedupe, the
  pending-confirmation handshake, and the audit log — which is a few KB. A JSON file avoids
  a second database and any native dependency. `src/database/` is a clean seam if you
  outgrow it.
- **Dashboard images are rendered, not screenshotted.** Your Discord dashboard sits behind
  admin login *and* TOTP, so a headless browser would have meant automating a 2FA bypass —
  fragile, and it would undercut protection that exists on purpose. The images are composed
  from the same API the dashboard itself calls, so the numbers are identical, with no
  browser and no secret handling.
- **No Telegram library.** The Bot API is a few HTTPS calls; `src/bot/telegram.js` covers
  what's needed in ~80 lines and avoids the dependency.

## Security

- Secrets live in `.env` only, and are scrubbed from anything logged or sent to Telegram.
- Toy codes are never written to the audit log.
- Customer Discord IDs are masked to the last four digits.
- Per-user rate limiting (25 commands/minute).
- Every action is logged: user, command, order, outcome, timestamp.
