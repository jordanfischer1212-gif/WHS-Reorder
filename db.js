const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// On Render (or similar), set DATA_DIR to the mounted persistent disk path
// so the database survives restarts/redeploys. Locally, it just defaults
// to this project folder.
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "parlevel.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rooms INTEGER NOT NULL,
  payment_terms TEXT NOT NULL DEFAULT 'net30'
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price_per_unit REAL NOT NULL,
  per_room_qty REAL NOT NULL,
  default_cadence_weeks INTEGER NOT NULL,
  available_cadences TEXT NOT NULL DEFAULT '4,6,8'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  cadence_weeks INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_order_date TEXT,
  next_order_date TEXT NOT NULL,
  UNIQUE(account_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
`);

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// migration for databases created before available_cadences existed
const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productCols.includes("available_cadences")) {
  db.exec("ALTER TABLE products ADD COLUMN available_cadences TEXT NOT NULL DEFAULT '4,6,8'");
}

const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
if (productCount === 0) {
  const insertProduct = db.prepare(
    "INSERT INTO products (name, unit, price_per_unit, per_room_qty, default_cadence_weeks, available_cadences) VALUES (?,?,?,?,?,?)"
  );
  const seedProducts = [
    ["Key cards", "cards", 0.18, 4.5, 4, "2,4,6"],
    ["Key card sleeves", "sleeves", 0.09, 4.5, 4, "2,4,6"],
    ["Guest pens", "pens", 0.22, 2.2, 6, "4,6,8,12"],
    ["Notepads", "pads", 0.35, 1.4, 8, "6,8,12"],
  ];
  seedProducts.forEach((p) => insertProduct.run(...p));

  const insertAccount = db.prepare("INSERT INTO accounts (name, rooms, payment_terms) VALUES (?,?,?)");
  const seedAccounts = [
    ["Harbor View Inn", 84, "net30"],
    ["Aster Business Suites", 210, "net30"],
    ["The Meridian Downtown", 156, "net30"],
    ["Cove & Pine Resort", 340, "net30"],
    ["Birchwood Extended Stay", 60, "net30"],
  ];
  const accountIds = seedAccounts.map((a) => insertAccount.run(...a).lastInsertRowid);

  const products = db.prepare("SELECT * FROM products").all();
  const insertSub = db.prepare(
    "INSERT INTO subscriptions (account_id, product_id, qty, cadence_weeks, active, last_order_date, next_order_date) VALUES (?,?,?,?,?,?,?)"
  );
  accountIds.forEach((accountId, i) => {
    const account = seedAccounts[i];
    products.forEach((p, pi) => {
      const qty = Math.round(p.per_room_qty * account[1]);
      const active = !(i === 4 && pi === 3) ? 1 : 0;
      const nextOffset = [3, 1, 4, 9, -1][(i + pi) % 5];
      insertSub.run(accountId, p.id, qty, p.default_cadence_weeks, active, daysFromNow(-20), daysFromNow(nextOffset));
    });
  });
}

module.exports = db;
