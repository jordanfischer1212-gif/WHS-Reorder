// Runs once a day via GitHub Actions (see .github/workflows/reminder-check.yml).
// Checks every tracked order in Firestore; if it's due in exactly 3 days,
// emails the account's reminder address via Resend.
//
// Required environment variables (set as GitHub Actions secrets):
//   FIREBASE_SERVICE_ACCOUNT   the full JSON key for a Firebase service account
//   RESEND_API_KEY             API key from resend.com

const admin = require("firebase-admin");
const { Resend } = require("resend");

const REMINDER_DAYS_BEFORE = 3;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
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

    try {
      await resend.emails.send({
        from: "WHS Reorder Tracker <onboarding@resend.dev>",
        to: account.email,
        subject: `Reminder: ${order.productName} due in ${REMINDER_DAYS_BEFORE} days`,
        text:
          `This is a reminder that ${order.accountName}'s ${order.productName} order ` +
          `(${order.qty} ${order.unit}) is due to go out on ${order.nextDue}.\n\n` +
          `— WHS Reorder Tracker`,
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
