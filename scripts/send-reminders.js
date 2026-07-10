// Runs once a day via GitHub Actions (see .github/workflows/reminder-check.yml).
// Checks every tracked order in Firestore; if it's due within 3 days,
// emails the account's reminder address via Resend, with pause/cancel
// links that draft a pre-filled email to customer service — nothing
// pauses or cancels automatically, a human still has to act on it.
//
// Required environment variables (set as GitHub Actions secrets):
//   FIREBASE_SERVICE_ACCOUNT   the full JSON key for a Firebase service account
//   RESEND_API_KEY             API key from resend.com

const admin = require("firebase-admin");
const { Resend } = require("resend");

const REMINDER_DAYS_BEFORE = 3;
const CUSTOMER_SERVICE_EMAIL = "Jordan@corporateimagegroup.com";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function mailtoLink(action, order, account) {
  const subject = `${action} request: ${account.name} — ${order.productName}`;
  const body =
    `Please ${action.toLowerCase()} the following order:\n\n` +
    `Account: ${account.name}\n` +
    `Product: ${order.productName}\n` +
    `Quantity: ${order.qty} ${order.unit}\n` +
    `Current due date: ${order.nextDue}\n\n` +
    `Requested via reminder email by the account contact.`;
  return `mailto:${CUSTOMER_SERVICE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const resend = new Resend(process.env.RESEND_API_KEY);

  const [ordersSnap, accountsSnap] = await Promise.all([
    db.collection("trackedOrders").get(),
    db.collection("accounts").get(),
  ]);

  const accountsById = Object.fromEntries(
    accountsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }])
  );

  let sentCount = 0;
  let skippedNoEmail = 0;

  for (const orderDoc of ordersSnap.docs) {
    const order = { id: orderDoc.id, ...orderDoc.data() };
    const account = accountsById[order.accountId];
    const daysUntilDue = daysBetween(today(), order.nextDue);

    if (daysUntilDue > REMINDER_DAYS_BEFORE || daysUntilDue < 0) continue;

    // Don't send twice for the same due date if the job runs more than once,
    // or if it already sent a reminder for this exact cycle.
    if (order.reminderSentFor === order.nextDue) continue;

    if (!account || !account.email) {
      console.log(`Skipping ${order.accountName || order.accountId} / ${order.productName}: no email on file`);
      skippedNoEmail++;
      continue;
    }

    const pauseLink = mailtoLink("Pause", order, account);
    const cancelLink = mailtoLink("Cancel", order, account);

    try {
      await resend.emails.send({
        from: "WHS Reorder Tracker <onboarding@resend.dev>",
        to: account.email,
        subject: `Reminder: ${order.productName} due in ${REMINDER_DAYS_BEFORE} days`,
        text:
          `This is a reminder that ${order.accountName}'s ${order.productName} order ` +
          `(${order.qty} ${order.unit}) is due to go out on ${order.nextDue}.\n\n` +
          `Need to pause or cancel this order? Email ${CUSTOMER_SERVICE_EMAIL} and let us know.\n\n` +
          `— WHS Reorder Tracker`,
        html:
          `<p>This is a reminder that <strong>${order.accountName}</strong>'s <strong>${order.productName}</strong> order ` +
          `(${order.qty} ${order.unit}) is due to go out on <strong>${order.nextDue}</strong>.</p>` +
          `<p>Need to make a change?</p>` +
          `<p>` +
          `<a href="${pauseLink}" style="color:#1B2A41;font-weight:600;">Pause this order</a>` +
          `&nbsp;&nbsp;|&nbsp;&nbsp;` +
          `<a href="${cancelLink}" style="color:#A13D2D;font-weight:600;">Cancel this order</a>` +
          `</p>` +
          `<p style="color:#5B6472;font-size:13px;">Clicking either link opens a pre-filled email to our customer service team — nothing is paused or cancelled automatically.</p>` +
          `<p>— WHS Reorder Tracker</p>`,
      });
      await orderDoc.ref.update({ reminderSentFor: order.nextDue });
      console.log(`Sent reminder to ${account.email} for ${account.name} / ${order.productName}`);
      sentCount++;
    } catch (err) {
      console.error(`Failed to email ${account.email}:`, err.message);
    }
  }

  console.log(`Done. Sent ${sentCount} reminder(s), skipped ${skippedNoEmail} for missing email.`);
}

main().catch((err) => {
  console.error("Reminder job failed:", err);
  process.exit(1);
});
