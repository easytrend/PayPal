# MoonPay × PayPal Sandbox — Solana Devnet Integration

A standalone sandbox integration connecting Phantom wallet (Solana Devnet) to MoonPay's PayPal checkout flow, with a Node.js/Express backend handling URL signing, transaction status queries, and webhook verification.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (Vite + React)         Backend (Node.js/Express)   │
│                                                               │
│  Phantom Wallet (Devnet)  ──►  POST /moonpay-checkout        │
│       ↓                         └─ Signs URL (HMAC-SHA256)   │
│  MoonPay Widget (PayPal)        GET  /moonpay-status         │
│       ↓                         └─ Queries sandbox API       │
│  Confirm Button           ──►  POST /moonpay-webhook         │
│                                  └─ Verifies + logs events   │
└──────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Node.js 18+
- Phantom browser extension (set to **Devnet**)
- MoonPay sandbox account → https://dashboard.moonpay.com (toggle sandbox mode)

---

## Quick Start

### 1. Get MoonPay Sandbox Keys

1. Log into https://dashboard.moonpay.com
2. Toggle **Sandbox** mode (top-right)
3. Go to **Developers → API Keys**
4. Copy your `pk_test_…` (public) and `sk_test_…` (secret) keys

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env and paste your MoonPay sandbox keys
npm install
node server.js
# → Running on http://localhost:3001
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
# → Running on http://localhost:5173
```

### 4. Expose Webhook (for local dev)

MoonPay needs a public URL to deliver webhooks. Use ngrok or similar:

```bash
# Install ngrok: https://ngrok.com
ngrok http 3001

# Copy the HTTPS URL e.g. https://abc123.ngrok.io
# In MoonPay Dashboard → Developers → Webhooks:
#   Add endpoint: https://abc123.ngrok.io/moonpay-webhook
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOONPAY_PUBLIC_KEY` | `pk_test_…` from MoonPay sandbox dashboard |
| `MOONPAY_SECRET_KEY` | `sk_test_…` — never expose client-side |
| `MOONPAY_SANDBOX_API` | `https://api.sandbox.moonpay.com` (default) |
| `PORT` | Backend port (default: 3001) |

---

## API Endpoints

### `POST /moonpay-checkout`
Generates a signed MoonPay sandbox checkout URL.

**Request body:**
```json
{
  "walletAddress": "So1ana...devnet_address",
  "email": "optional@email.com"
}
```

**Response:**
```json
{
  "checkoutUrl": "https://buy-sandbox.moonpay.com?apiKey=...&signature=..."
}
```

---

### `GET /moonpay-status?walletAddress=<addr>`
Queries MoonPay sandbox API for transactions associated with the wallet.

**Response:**
```json
{
  "status": "completed",
  "transactionId": "uuid",
  "cryptoAmount": 10.5,
  "currency": "USDC",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

---

### `POST /moonpay-webhook`
Receives status-change callbacks from MoonPay. Verifies `MoonPay-Signature` header using HMAC-SHA256.

Handles events:
- `transaction_created`
- `transaction_updated` → `completed` triggers crypto delivery log

---

## Flow

```
1. User opens app → connects Phantom (Devnet)
2. Clicks "Generate Checkout Link"
   → Backend signs MoonPay URL with PayPal + USDC
3. User opens checkout in new tab
   → Completes PayPal payment (sandbox test funds)
4. Frontend auto-polls /moonpay-status every 8s
   AND MoonPay fires POST /moonpay-webhook
5. On "completed": USDC delivered to Solana Devnet wallet
```

---

## Notes

- `currencyCode` is set to `usdc_sol` (USDC on Solana) — check MoonPay docs for exact supported sandbox codes
- Sandbox PayPal uses test credentials MoonPay provides — no real money moves
- Webhook signature uses timing-safe comparison to prevent timing attacks
- The frontend Vite dev server proxies `/api/*` to `localhost:3001` — no CORS issues in dev
