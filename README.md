# ParLevel — Auto-Replenishment Prototype

A working subscription/auto-replenishment system for hotel supply
consumables (key cards, sleeves, pens, notepads). Real backend, real
database, real scheduling logic — built to be run, clicked through,
and eventually connected to Antera.

## Run it

Requires Node.js (v18+).

```
npm install
npm start
```

Then open **http://localhost:3000**.

That's it — no external services, no API keys, no build step. Data
lives in a local SQLite file (`parlevel.db`), created automatically
with 5 sample accounts and 4 products the first time you run it.

## What's real vs. what's stubbed

**Real:**
- SQLite database with accounts, products, subscriptions, orders
- Every UI action (pause/resume, change cadence, resize by room count)
  writes to the database immediately
- The scheduler (`scheduler.js`) genuinely checks which subscriptions
  are due and creates real draft order rows — this is the same logic
  a production cron job would run daily
- The forecast is computed from real active-subscription data, not
  hardcoded

**Stubbed (intentionally, until you have Antera API credentials):**
- `sendOrderToAntera()` in `scheduler.js` — this is the one function
  that would call Antera's Open API to create the real order against
  the customer's Net-30 account. Right now it just marks the local
  order as "sent" so you can exercise the full approve flow. The
  comment above that function shows roughly what the real call would
  look like once you have API access.
- There's no login/authentication — the customer view has an "viewing
  as" dropdown instead of real accounts. Add auth before this touches
  real customer data.
- No email/notification sending (e.g. "your shipment is on its way").

## Where things live

```
server.js       Express API — all routes
db.js           SQLite schema + seed data (5 sample hotel accounts)
scheduler.js    Due-order logic + the Antera integration stub
public/         Frontend (vanilla JS, no build step)
```

## Managing products (cadence options, pricing, etc.)

Cadence options are a per-product attribute (`available_cadences`), not a
global list — e.g. pens might offer 4/6/8/12 weeks while key cards only
offer 2/4/6. This is catalog data, so it's meant to be edited directly
rather than through a UI. Two ways to do that:

**Option A — a quick Node script (no extra tools needed)**

```
node -e "
const db = require('./db');
db.prepare('UPDATE products SET available_cadences = ? WHERE name = ?')
  .run('4,8,12', 'Notepads');
console.log('updated');
"
```

**Option B — the sqlite3 CLI, if you have it installed**

```
sqlite3 parlevel.db "UPDATE products SET available_cadences = '4,8,12' WHERE name = 'Notepads';"
sqlite3 parlevel.db "INSERT INTO products (name, unit, price_per_unit, per_room_qty, default_cadence_weeks, available_cadences) VALUES ('Do Not Disturb tags', 'tags', 0.12, 1.0, 8, '8,12,16');"
```

Either way, `available_cadences` is a comma-separated list of weeks
(e.g. `"2,4,6"`) and the app enforces it: the customer portal only
shows those options in the dropdown, and the server rejects any
cadence that isn't in that list, even if someone calls the API
directly.

If you add a new product this way, existing accounts won't have a
subscription row for it automatically — that's intentional, since a
brand-new product usually needs a deliberate decision about which
accounts to offer it to, not a silent opt-in for everyone.

## Deploying to Render, for coworkers to use

This needs Render's paid Starter tier ($7/month) or above — Render's
**free tier doesn't support persistent disks**, which means without
paying, every restart or redeploy would wipe out everyone's tracked
orders. `render.yaml` in this repo is already set to the Starter plan
with a 1GB disk attached, so you shouldn't need to configure that by
hand.

**Steps:**

1. **Push this folder to a GitHub repo** (private is fine — Render can
   deploy from a private repo once you connect your GitHub account).
   ```
   git init
   git add .
   git commit -m "ParLevel order tracker"
   ```
   Then create a repo on GitHub and push to it.

2. **Go to [render.com](https://render.com)** and sign up / log in.

3. **New → Blueprint**, and connect the GitHub repo. Render reads
   `render.yaml` automatically and sets up the web service, the disk,
   and the `DATA_DIR` environment variable for you.

4. Click **Apply** / **Create**. Render installs dependencies, starts
   the app, and gives you a live URL like `parlevel.onrender.com`.

5. **Send that URL to your coworkers.** That's it — no separate
   accounts needed on their end, though see the note below about
   access control.

**Before wider use, worth adding:** there's currently no login on this
app — anyone with the URL can view and edit everything. Fine for a
demo, but if this is going to be used regularly by multiple people,
even a simple shared password gate is worth adding first. Ask me and
I can build that in.

**If you ever need to reset the data on Render:** go to your service's
**Shell** tab in the Render dashboard and run:
```
rm /var/data/parlevel.db*
```
then restart the service — it reseeds automatically on next boot,
same as it does locally.

## Suggested next steps toward production

1. Swap `sendOrderToAntera()` for a real call to Antera's Open API
   (they publish this — ask your Antera account rep for API docs and
   a sandbox/test key before touching production orders)
2. Add real authentication so each hotel account only sees its own data
3. Move `runScheduler()` from a manual button to an actual daily cron
   job (e.g. `node-cron`, or your hosting platform's scheduled tasks)
4. Swap SQLite for Postgres/MySQL if this needs to run on shared
   infrastructure rather than a single server
5. Add email notifications when an order ships or a subscription
   needs attention
6. Get sign-off from whoever manages security/compliance before any
   real customer or payment data touches this
