const db = require("./db");
const { sendOrderToAntera } = require("./antera-adapter");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addWeeks(dateStr, weeks) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

// Finds subscriptions whose next_order_date has arrived, creates a
// draft order for each, and advances next_order_date by one cadence.
function runScheduler() {
  const due = db
    .prepare("SELECT * FROM subscriptions WHERE active = 1 AND next_order_date <= ?")
    .all(today());

  const insertOrder = db.prepare(
    "INSERT INTO orders (subscription_id, account_id, product_id, qty, amount, status, created_at) VALUES (?,?,?,?,?,?,?)"
  );
  const updateSub = db.prepare(
    "UPDATE subscriptions SET last_order_date = ?, next_order_date = ? WHERE id = ?"
  );
  const getProduct = db.prepare("SELECT * FROM products WHERE id = ?");

  const created = [];
  due.forEach((sub) => {
    const product = getProduct.get(sub.product_id);
    const amount = Math.round(sub.qty * product.price_per_unit * 100) / 100;
    const info = insertOrder.run(sub.id, sub.account_id, sub.product_id, sub.qty, amount, "draft", today());
    updateSub.run(today(), addWeeks(sub.next_order_date, sub.cadence_weeks), sub.id);
    created.push(info.lastInsertRowid);
  });

  return created;
}

module.exports = { runScheduler, sendOrderToAntera, today };
