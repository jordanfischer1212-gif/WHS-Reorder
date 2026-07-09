/*
  ANTERA ADAPTER
  --------------
  This is the one file that needs real work once you have API
  credentials and endpoint docs from Antera (ask support@anterasoftware.com
  or your account rep — this is account-scoped, not publicly documented).

  Everything else in the app calls sendOrderToAntera(order) and doesn't
  care how it's implemented. Swap the body of that function below and
  nothing else in the codebase needs to change.

  Config comes from environment variables so real credentials never
  get committed to source control:
    ANTERA_BASE_URL   e.g. https://api.anterasaas.com/v1
    ANTERA_API_KEY    from Antera once they set up API access for your account
*/

const ANTERA_BASE_URL = process.env.ANTERA_BASE_URL;
const ANTERA_API_KEY = process.env.ANTERA_API_KEY;

// Questions to bring to Antera before filling this in for real:
//  - What's the auth scheme? (API key header, OAuth, Basic auth?)
//  - What's the actual endpoint path for creating a sales order?
//  - What fields identify an existing customer account and a product/SKU?
//  - Does the endpoint accept payment terms (net30) or is that implicit
//    from the account record already in Antera?
//  - Sync or async response? Do they send a webhook on status change?
async function sendOrderToAntera(order) {
  if (!ANTERA_BASE_URL || !ANTERA_API_KEY) {
    // No credentials configured yet — simulate success so the rest of
    // the app (approve flow, order history) can still be exercised.
    return { ok: true, anteraOrderId: `SIMULATED-${order.id}`, simulated: true };
  }

  // Once you have real docs, this becomes something like:
  //
  // const res = await fetch(`${ANTERA_BASE_URL}/orders`, {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${ANTERA_API_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     customerAccountId: order.antera_account_id,   // Antera's ID for this account, not ParLevel's local id
  //     terms: "net30",
  //     lineItems: [
  //       { sku: order.antera_product_sku, quantity: order.qty },
  //     ],
  //   }),
  // });
  // if (!res.ok) throw new Error(`Antera order creation failed: ${res.status}`);
  // const data = await res.json();
  // return { ok: true, anteraOrderId: data.orderId };

  throw new Error("Antera credentials are set but sendOrderToAntera() has not been implemented yet — see comments above.");
}

module.exports = { sendOrderToAntera };
