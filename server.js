const express = require("express");
const path = require("path");
const db = require("./db");
const { runScheduler, sendOrderToAntera, today } = require("./scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- accounts ----
app.get("/api/accounts", (req, res) => {
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY name").all();
  res.json(accounts);
});

app.post("/api/accounts", (req, res) => {
  const { name, rooms } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const info = db.prepare("INSERT INTO accounts (name, rooms, payment_terms) VALUES (?,?,?)").run(name, rooms || 0, "net30");
  res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(info.lastInsertRowid));
});

app.get("/api/accounts/:id/subscriptions", (req, res) => {
  const subs = db
    .prepare(
      `SELECT s.*, p.name AS product_name, p.unit, p.price_per_unit, p.available_cadences
       FROM subscriptions s JOIN products p ON p.id = s.product_id
       WHERE s.account_id = ? ORDER BY p.name`
    )
    .all(req.params.id);
  const withCadences = subs.map((s) => ({
    ...s,
    available_cadences: s.available_cadences.split(",").map(Number),
  }));
  res.json(withCadences);
});

// ---- products ----
app.get("/api/products", (req, res) => {
  res.json(db.prepare("SELECT * FROM products").all());
});

// ---- manual order tracking ----
// This is the core of the "manually enter orders, system tracks when
// the next one is due" workflow — no auto-generation, no Antera call.
// Reuses the same subscriptions/orders tables from earlier work.

function dueStatus(nextOrderDate) {
  const days = Math.floor((new Date(nextOrderDate) - new Date(today())) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 7) return "due_soon";
  return "ok";
}

app.get("/api/subscriptions", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, a.name AS account_name, p.name AS product_name, p.unit, p.available_cadences
       FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       JOIN products p ON p.id = s.product_id
       ORDER BY s.next_order_date ASC`
    )
    .all();
  const withStatus = rows.map((r) => ({
    ...r,
    available_cadences: r.available_cadences.split(",").map(Number),
    status: dueStatus(r.next_order_date),
  }));
  res.json(withStatus);
});

app.post("/api/subscriptions", (req, res) => {
  const { account_id, product_id, qty, cadence_weeks, last_sent_date } = req.body;
  if (!account_id || !product_id || !qty || !cadence_weeks) {
    return res.status(400).json({ error: "account_id, product_id, qty, and cadence_weeks are required" });
  }
  const product = db.prepare("SELECT available_cadences FROM products WHERE id = ?").get(product_id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const allowed = product.available_cadences.split(",").map(Number);
  if (!allowed.includes(cadence_weeks)) {
    return res.status(400).json({ error: `${cadence_weeks} weeks isn't allowed for this product. Allowed: ${allowed.join(", ")}` });
  }
  const lastSent = last_sent_date || today();
  const nextDue = new Date(lastSent);
  nextDue.setDate(nextDue.getDate() + cadence_weeks * 7);
  const nextDueStr = nextDue.toISOString().slice(0, 10);

  try {
    const info = db
      .prepare(
        `INSERT INTO subscriptions (account_id, product_id, qty, cadence_weeks, active, last_order_date, next_order_date)
         VALUES (?,?,?,?,1,?,?)`
      )
      .run(account_id, product_id, qty, cadence_weeks, lastSent, nextDueStr);
    res.json(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "This account already has an order tracked for this product. Edit the existing row instead of adding a duplicate." });
    }
    res.status(500).json({ error: "Could not save this order." });
  }
});

// The main daily action: staff actually places/ships the order, then
// clicks this to log it and roll the next-due date forward.
app.post("/api/subscriptions/:id/mark-sent", (req, res) => {
  const sub = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id);
  if (!sub) return res.status(404).json({ error: "Not found" });
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(sub.product_id);
  const amount = Math.round(sub.qty * product.price_per_unit * 100) / 100;

  db.prepare(
    "INSERT INTO orders (subscription_id, account_id, product_id, qty, amount, status, created_at, sent_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(sub.id, sub.account_id, sub.product_id, sub.qty, amount, "sent", today(), today());

  const nextDue = new Date(today());
  nextDue.setDate(nextDue.getDate() + sub.cadence_weeks * 7);
  const nextDueStr = nextDue.toISOString().slice(0, 10);
  db.prepare("UPDATE subscriptions SET last_order_date = ?, next_order_date = ? WHERE id = ?").run(today(), nextDueStr, sub.id);

  res.json(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(sub.id));
});

app.patch("/api/subscriptions/:id", (req, res) => {
  const { qty, cadence_weeks, active } = req.body;
  const sub = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subscription not found" });

  if (cadence_weeks !== undefined) {
    const product = db.prepare("SELECT available_cadences FROM products WHERE id = ?").get(sub.product_id);
    const allowed = product.available_cadences.split(",").map(Number);
    if (!allowed.includes(cadence_weeks)) {
      return res.status(400).json({ error: `${cadence_weeks} weeks isn't an available cadence for this product. Allowed: ${allowed.join(", ")}` });
    }
  }

  db.prepare(
    "UPDATE subscriptions SET qty = COALESCE(?, qty), cadence_weeks = COALESCE(?, cadence_weeks), active = COALESCE(?, active) WHERE id = ?"
  ).run(qty ?? null, cadence_weeks ?? null, active === undefined ? null : active ? 1 : 0, req.params.id);

  res.json(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id));
});

// resize a whole account's quantities when room count changes
app.post("/api/accounts/:id/resize", (req, res) => {
  const { rooms } = req.body;
  db.prepare("UPDATE accounts SET rooms = ? WHERE id = ?").run(rooms, req.params.id);
  const subs = db.prepare("SELECT * FROM subscriptions WHERE account_id = ?").all(req.params.id);
  const update = db.prepare("UPDATE subscriptions SET qty = ? WHERE id = ?");
  subs.forEach((s) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(s.product_id);
    update.run(Math.round(product.per_room_qty * rooms), s.id);
  });
  res.json({ ok: true });
});

// ---- orders ----
app.get("/api/orders", (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.*, a.name AS account_name, p.name AS product_name, p.unit
       FROM orders o
       JOIN accounts a ON a.id = o.account_id
       JOIN products p ON p.id = o.product_id
       ORDER BY o.created_at DESC, o.id DESC`
    )
    .all();
  res.json(orders);
});

app.post("/api/orders/:id/approve", async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  try {
    const result = await sendOrderToAntera(order);
    db.prepare("UPDATE orders SET status = 'sent', sent_at = ? WHERE id = ?").run(today(), req.params.id);
    res.json({ ...result, order: db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id) });
  } catch (err) {
    res.status(502).json({ error: `Antera order creation failed: ${err.message}` });
  }
});

// runs the due-order check (in production this is a daily cron job)
app.post("/api/scheduler/run", (req, res) => {
  const createdIds = runScheduler();
  res.json({ created: createdIds.length, orderIds: createdIds });
});

// ---- forecast: naive projection based on active subscriptions ----
app.get("/api/forecast", (req, res) => {
  const subs = db
    .prepare(
      `SELECT s.*, p.price_per_unit FROM subscriptions s JOIN products p ON p.id = s.product_id WHERE s.active = 1`
    )
    .all();
  const monthlyRun = subs.reduce((sum, s) => sum + (s.qty / s.cadence_weeks) * 4.33 * s.price_per_unit, 0);
  const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];
  const growth = [0.35, 0.45, 0.56, 0.68, 0.84, 1];
  const forecast = months.map((m, i) => ({ month: m, revenue: Math.round(monthlyRun * growth[i]) }));
  res.json({ forecast, thisMonth: Math.round(monthlyRun) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ParLevel running at http://localhost:${PORT}`));
