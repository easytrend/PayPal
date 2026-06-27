const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Strip /api prefix if present (e.g. when hosted on Vercel)
app.use((req, res, next) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.replace(/^\/api/, "");
  }
  next();
});

// Raw body for webhook signature verification
app.use("/moonpay-webhook", express.raw({ type: "application/json" }));

const {
  MOONPAY_PUBLIC_KEY,
  MOONPAY_SECRET_KEY,
  MOONPAY_SANDBOX_API = "https://api.sandbox.moonpay.com",
} = process.env;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

app.post("/moonpay-checkout", (req, res) => {
  const { walletAddress, email } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  // Verify key configuration
  const isKeyUnconfigured = 
    !MOONPAY_PUBLIC_KEY || 
    !MOONPAY_SECRET_KEY || 
    MOONPAY_PUBLIC_KEY.includes("YOUR_PUBLIC_KEY_HERE") || 
    MOONPAY_SECRET_KEY.includes("YOUR_SECRET_KEY_HERE");

  if (isKeyUnconfigured) {
    console.warn("[checkout] MoonPay keys not configured correctly");
    return res.status(400).json({ 
      error: "MoonPay keys are not configured. Please add your actual MoonPay keys in your environment variables (.env)." 
    });
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

app.get("/moonpay-status", async (req, res) => {
  const { walletAddress } = req.query;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  // Verify key configuration
  const isKeyUnconfigured = 
    !MOONPAY_PUBLIC_KEY || 
    !MOONPAY_SECRET_KEY || 
    MOONPAY_PUBLIC_KEY.includes("YOUR_PUBLIC_KEY_HERE") || 
    MOONPAY_SECRET_KEY.includes("YOUR_SECRET_KEY_HERE");

  if (isKeyUnconfigured) {
    return res.status(400).json({ 
      error: "MoonPay keys are not configured." 
    });
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
    }

    if (tx.status === "failed") {
      console.warn(`[webhook] ❌ FAILED — ${tx.id}: ${tx.failureReason}`);
    }
  }

  return res.sendStatus(200);
});

app.get("/health", (_, res) => res.json({ ok: true, env: "sandbox" }));

module.exports = app;
