// Vercel serverless function: POST /api/verify-bribe
// Requires a STRIPE_SECRET_KEY environment variable set in your Vercel project settings.
// This is your Stripe SECRET key (starts with sk_live_ or sk_test_), not the Payment
// Link URL — find it at dashboard.stripe.com/apikeys. Never expose this key to the
// browser; it's only ever read here, server-side.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sessionId } = req.body || {};

  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
    return res.status(400).json({ error: "Invalid session id." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Server is missing STRIPE_SECRET_KEY." });
  }

  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { "Authorization": `Bearer ${secretKey}` } }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Stripe verify error (session=${sessionId}, mode=${sessionId.startsWith("cs_live_") ? "live" : "test"}):`, errText);
      return res.status(502).json({ error: "Could not verify payment with Stripe." });
    }

    const session = await response.json();
    const paid = session.payment_status === "paid";
    console.log(`Bribe verification: session=${sessionId} mode=${sessionId.startsWith("cs_live_") ? "live" : "test"} payment_status=${session.payment_status} paid=${paid}`);
    return res.status(200).json({ paid });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong verifying payment." });
  }
}
