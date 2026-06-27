require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Raw body for webhook signature verification
app.use("/moonpay-webhook", express.raw({ type: "application/json" }));

const {
  MOONPAY_PUBLIC_KEY,
  MOONPAY_SECRET_KEY,
  MOONPAY_SANDBOX_API = "https://api.sandbox.moonpay.com",
  PORT = 3001,
} = process.env;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Signs a MoonPay URL: appends ?signature=<HMAC-SHA256> of the query string.
 * MoonPay signs only the query portion (including the `?`).
 */
function signMoonPayUrl(url) {
  const parsed = new URL(url);
  const queryString = parsed.search; // includes the leading "?"
  const signature = crypto
    .createHmac("sha256", MOONPAY_SECRET_KEY)
    .update(queryString)
    .digest("base64");
  parsed.searchParams.set("signature", signature);
  return parsed.toString();
}

/**
 * Verifies an incoming MoonPay webhook signature.
 * MoonPay sends: "MoonPay-Signature: t=<timestamp>,s=<sig>"
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const { t: timestamp, s: receivedSig } = parts;
  if (!timestamp || !receivedSig) return false;

  const payload = `${timestamp}.${rawBody.toString()}`;
  const expectedSig = crypto
    .createHmac("sha256", MOONPAY_SECRET_KEY)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expectedSig, "hex"),
    Buffer.from(receivedSig, "hex")
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /moonpay-checkout
 * Body: { walletAddress: string, email?: string }
 * Returns a signed MoonPay sandbox checkout URL with PayPal + USDC on Solana Devnet.
 */
app.post("/moonpay-checkout", (req, res) => {
  const { walletAddress, email } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  if (!MOONPAY_PUBLIC_KEY || !MOONPAY_SECRET_KEY) {
    return res.status(500).json({ error: "MoonPay keys not configured" });
  }

  // Build unsigned widget URL
  const baseUrl = "https://buy-sandbox.moonpay.com";
  const params = new URLSearchParams({
    apiKey: MOONPAY_PUBLIC_KEY,
    currencyCode: "usdc_sol",      // USDC on Solana
    walletAddress,
    paymentMethod: "paypal",
    colorCode: "%2300FFA3",        // MoonPay accent (URL-encoded #)
    redirectURL: "http://localhost:5173/complete",
    ...(email && { email }),
  });

  const unsignedUrl = `${baseUrl}?${params.toString()}`;
  const signedUrl = signMoonPayUrl(unsignedUrl);

  console.log(`[checkout] Generated checkout URL for wallet ${walletAddress}`);
  return res.json({ checkoutUrl: signedUrl });
});

/**
 * GET /moonpay-status?walletAddress=<addr>
 * Queries the MoonPay sandbox API for transactions belonging to this wallet.
 */
app.get("/moonpay-status", async (req, res) => {
  const { walletAddress } = req.query;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const response = await axios.get(
      `${MOONPAY_SANDBOX_API}/v1/transactions`,
      {
        params: { walletAddress },
        auth: {
          username: MOONPAY_PUBLIC_KEY,
          password: MOONPAY_SECRET_KEY,
        },
      }
    );

    const transactions = response.data;

    if (!transactions || transactions.length === 0) {
      return res.json({ status: "no_transactions", transactions: [] });
    }

    // Return the most recent transaction's status
    const latest = transactions[0];
    return res.json({
      status: latest.status,
      transactionId: latest.id,
      cryptoAmount: latest.cryptoTransactionId ? latest.quoteCurrencyAmount : null,
      currency: latest.quoteCurrency?.code,
      updatedAt: latest.updatedAt,
      transactions,
    });
  } catch (err) {
    console.error("[status] MoonPay API error:", err.response?.data || err.message);
    return res.status(502).json({
      error: "Failed to query MoonPay",
      detail: err.response?.data || err.message,
    });
  }
});

/**
 * POST /moonpay-webhook
 * Receives MoonPay status change callbacks.
 * Verifies HMAC signature before processing.
 */
app.post("/moonpay-webhook", (req, res) => {
  const signatureHeader = req.headers["moonpay-signature"];

  if (!verifyWebhookSignature(req.body, signatureHeader)) {
    console.warn("[webhook] Invalid signature — rejecting");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { type, data } = event;
  console.log(`[webhook] Event received: ${type}`);

  if (type === "transaction_updated" || type === "transaction_created") {
    const tx = data;
    console.log(`[webhook] Transaction ${tx.id} → status: ${tx.status}`);

    if (tx.status === "completed") {
      console.log(
        `[webhook] ✅ COMPLETED — wallet: ${tx.walletAddress}, ` +
        `amount: ${tx.quoteCurrencyAmount} ${tx.quoteCurrency?.code}, ` +
        `txHash: ${tx.cryptoTransactionId}`
      );
      // TODO: trigger your post-conversion flow here
      // e.g. record to DB, notify user, call Solana program, etc.
    }

    if (tx.status === "failed") {
      console.warn(`[webhook] ❌ FAILED — ${tx.id}: ${tx.failureReason}`);
    }
  }

  // MoonPay expects a 200 quickly
  return res.sendStatus(200);
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true, env: "sandbox" }));

app.listen(PORT, () => {
  console.log(`MoonPay sandbox backend running on http://localhost:${PORT}`);
  console.log(`  Public key configured: ${!!MOONPAY_PUBLIC_KEY}`);
  console.log(`  Secret key configured: ${!!MOONPAY_SECRET_KEY}`);
});
