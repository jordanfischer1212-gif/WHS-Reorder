const app = document.getElementById("app");
let accounts = [];
let products = [];

async function api(path, opts) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  return res.json();
}

function statusLabel(status) {
  if (status === "overdue") return { text: "Overdue", color: "var(--rust)" };
  if (status === "due_soon") return { text: "Due within 7 days", color: "var(--brass)" };
  return { text: "On track", color: "var(--teal)" };
}

async function loadLookups() {
  [accounts, products] = await Promise.all([api("/api/accounts"), api("/api/products")]);
}

function cadenceOptionsFor(productId) {
  const p = products.find((p) => p.id === Number(productId));
  if (!p) return [];
  return p.available_cadences.split(",").map(Number);
}

function renderForm() {
  return `
    <div class="form-card">
      <h2 style="font-size:18px;margin-bottom:14px;">Log a new tracked order</h2>
      <div class="form-row">
        <div class="field">
          <label>Hotel account</label>
          <select id="f-account">
            ${accounts.map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}
            <option value="__new__">+ Add new account&hellip;</option>
          </select>
        </div>
        <div class="field" id="new-account-field" style="display:none;">
          <label>New account name</label>
          <input id="f-new-account-name" placeholder="e.g. Riverside Suites" />
        </div>
        <div class="field">
          <label>Product</label>
          <select id="f-product">
            ${products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Quantity</label>
          <input id="f-qty" type="number" min="1" value="500" />
        </div>
        <div class="field">
          <label>Reorder every</label>
          <select id="f-cadence"></select>
        </div>
        <div class="field">
          <label>Last sent (defaults to today)</label>
          <input id="f-last-sent" type="date" />
        </div>
      </div>
      <button id="f-submit" class="submit-btn">Add to tracker</button>
      <p id="f-error" style="color:var(--rust);font-size:13px;margin-top:8px;display:none;"></p>
    </div>`;
}

function populateCadenceOptions() {
  const productSel = document.getElementById("f-product");
  const cadenceSel = document.getElementById("f-cadence");
  const opts = cadenceOptionsFor(productSel.value);
  cadenceSel.innerHTML = opts.map((c) => `<option value="${c}">${c} weeks</option>`).join("");
}

function renderTable(rows) {
  if (rows.length === 0) {
    return `<p style="color:var(--slate);font-size:14px;margin-top:20px;">Nothing tracked yet — add your first order above.</p>`;
  }
  return `
    <table class="orders" style="margin-top:24px;">
      <thead><tr><th>Account</th><th>Product</th><th>Qty</th><th>Cadence</th><th>Last sent</th><th>Next due</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map(renderRow).join("")}
      </tbody>
    </table>`;
}

function renderRow(r) {
  const st = statusLabel(r.status);
  return `
    <tr>
      <td>${r.account_name}</td>
      <td>${r.product_name}</td>
      <td class="mono">${r.qty} ${r.unit}</td>
      <td class="mono">${r.cadence_weeks}w</td>
      <td class="mono">${r.last_order_date || "&mdash;"}</td>
      <td class="mono">${r.next_order_date}</td>
      <td><span class="status-pill"><span class="status-dot" style="background:${st.color};"></span>${st.text}</span></td>
      <td><button class="approve-btn" data-mark-sent="${r.id}">Mark sent today</button></td>
    </tr>`;
}

async function renderAll() {
  const rows = await api("/api/subscriptions");
  app.innerHTML = `
    <div class="wrap">
      <div class="topbar">
        <div class="brand"><span class="mark">P</span> ParLevel &mdash; Order Tracker</div>
      </div>
      <p class="lede" style="margin-top:0;">Manually log each order when it goes out. This tracks quantity, cadence, and tells you when the next one is due &mdash; no auto-sending, nothing touches Antera.</p>
      ${renderForm()}
      ${renderTable(rows)}
    </div>`;

  document.getElementById("f-last-sent").valueAsDate = new Date();
  populateCadenceOptions();

  document.getElementById("f-product").addEventListener("change", populateCadenceOptions);
  document.getElementById("f-account").addEventListener("change", (e) => {
    document.getElementById("new-account-field").style.display = e.target.value === "__new__" ? "block" : "none";
  });

  document.getElementById("f-submit").addEventListener("click", async () => {
    const errorEl = document.getElementById("f-error");
    errorEl.style.display = "none";
    let accountId = document.getElementById("f-account").value;

    if (accountId === "__new__") {
      const name = document.getElementById("f-new-account-name").value.trim();
      if (!name) { errorEl.textContent = "Enter a name for the new account."; errorEl.style.display = "block"; return; }
      const newAccount = await api("/api/accounts", { method: "POST", body: JSON.stringify({ name, rooms: 0 }) });
      accountId = newAccount.id;
    }

    const payload = {
      account_id: Number(accountId),
      product_id: Number(document.getElementById("f-product").value),
      qty: Number(document.getElementById("f-qty").value),
      cadence_weeks: Number(document.getElementById("f-cadence").value),
      last_sent_date: document.getElementById("f-last-sent").value,
    };
    const result = await api("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) });
    if (result.error) { errorEl.textContent = result.error; errorEl.style.display = "block"; return; }
    await loadLookups();
    renderAll();
  });

  document.querySelectorAll("[data-mark-sent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/subscriptions/${btn.dataset.markSent}/mark-sent`, { method: "POST" });
      renderAll();
    });
  });
}

(async function init() {
  await loadLookups();
  renderAll();
})();
