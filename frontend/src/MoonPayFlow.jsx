import React, { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const BACKEND = "/api"; // proxied by Vite → localhost:3001

// ── Step constants ─────────────────────────────────────────────────────────
const STEP = {
  CONNECT:   0,
  CHECKOUT:  1,
  PAYMENT:   2,
  CONFIRM:   3,
  COMPLETE:  4,
};

const STEP_LABELS = ["Connect Wallet", "Generate Checkout", "Complete Payment", "Confirm", "Done"];

// ── Helpers ────────────────────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function StatusBadge({ status }) {
  const map = {
    completed:   { color: "#00ffa3", bg: "rgba(0,255,163,0.1)", label: "Completed" },
    pending:     { color: "#ffb340", bg: "rgba(255,179,64,0.1)", label: "Pending" },
    failed:      { color: "#ff5c5c", bg: "rgba(255,92,92,0.1)",  label: "Failed" },
    waitingPayment: { color: "#7b8cde", bg: "rgba(123,140,222,0.1)", label: "Awaiting Payment" },
    no_transactions:{ color: "#6b7a99", bg: "rgba(107,122,153,0.1)", label: "No Transactions" },
  };
  const s = map[status] || { color: "#6b7a99", bg: "rgba(107,122,153,0.1)", label: status };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 20,
      background: s.bg, color: s.color,
      fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {s.label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function MoonPayFlow() {
  const { publicKey, connected, disconnect } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;

  const [step, setStep]               = useState(STEP.CONNECT);
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [email, setEmail]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [txStatus, setTxStatus]       = useState(null);
  const [txDetail, setTxDetail]       = useState(null);
  const [pollActive, setPollActive]   = useState(false);

  // Advance to CHECKOUT once wallet connects
  useEffect(() => {
    if (connected && walletAddress && step === STEP.CONNECT) {
      setStep(STEP.CHECKOUT);
    }
    if (!connected && step > STEP.CONNECT) {
      setStep(STEP.CONNECT);
      setCheckoutUrl(null);
      setTxStatus(null);
    }
  }, [connected, walletAddress]);

  // ── Generate checkout URL ──────────────────────────────────────────────
  const generateCheckout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND}/moonpay-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, email: email || undefined }),
      });
      
      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server returned error ${res.status}`);
      }

      if (!res.ok) throw new Error(data.error || "Backend error");
      setCheckoutUrl(data.checkoutUrl);
      setStep(STEP.PAYMENT);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, email]);

  // ── Open MoonPay checkout ──────────────────────────────────────────────
  const openCheckout = () => {
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    setStep(STEP.CONFIRM);
  };

  // ── Poll / check status ────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND}/moonpay-status?walletAddress=${walletAddress}`);
      
      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server returned error ${res.status}`);
      }

      if (!res.ok) throw new Error(data.error || "Status error");
      setTxStatus(data.status);
      setTxDetail(data);
      if (data.status === "completed") {
        setStep(STEP.COMPLETE);
        setPollActive(false);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  // Auto-poll every 8s while on CONFIRM step
  useEffect(() => {
    if (step !== STEP.CONFIRM) { setPollActive(false); return; }
    setPollActive(true);
    const id = setInterval(checkStatus, 8000);
    return () => clearInterval(id);
  }, [step, checkStatus]);

  // ── Reset ──────────────────────────────────────────────────────────────
  const reset = () => {
    setCheckoutUrl(null);
    setTxStatus(null);
    setTxDetail(null);
    setError(null);
    setEmail("");
    setStep(connected ? STEP.CHECKOUT : STEP.CONNECT);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flow-page">
      {/* Header */}
      <header style={styles.header}>
        <div className="flow-header-inner">
          <div style={styles.logo}>
            <MoonIcon />
            <span>MoonPay</span>
            <span style={styles.logoDivider}>×</span>
            <PayPalIcon />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Sandbox</span>
          </div>
          <div style={styles.headerRight}>
            <span style={styles.networkBadge}>Solana Devnet</span>
            {connected && (
              <button style={styles.disconnectBtn} onClick={disconnect}>
                {shortAddr(walletAddress)} · Disconnect
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Progress */}
      <div className="progress-wrap">
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={i}>
            <div className="progress-item">
              <div style={{
                ...styles.progressDot,
                background: i < step ? "var(--accent)" : i === step ? "var(--accent)" : "var(--border)",
                boxShadow: i === step ? "0 0 0 4px rgba(0,255,163,0.2)" : "none",
              }}>
                {i < step ? "✓" : i + 1}
              </div>
              <span className="progress-label" style={{
                color: i === step ? "var(--text)" : i < step ? "var(--accent)" : "var(--muted)",
              }}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className="progress-line" style={{ background: i < step ? "var(--accent)" : "var(--border)" }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main Card */}
      <main className="flow-main">
        <div className="flow-card">
          {/* STEP 0: Connect */}
          {step === STEP.CONNECT && (
            <StepPanel
              icon="🔗"
              title="Connect Your Wallet"
              desc="Connect your Phantom wallet on Solana Devnet to begin. USDC will be delivered to this address after payment."
            >
              <WalletMultiButton style={{ width: "100%" }} />
              <Note>Make sure Phantom is set to <strong>Devnet</strong> in Settings → Developer Settings → Change Network.</Note>
            </StepPanel>
          )}

          {/* STEP 1: Generate Checkout */}
          {step === STEP.CHECKOUT && (
            <StepPanel
              icon="⚡"
              title="Generate PayPal Checkout"
              desc="Your wallet is connected. Optionally enter an email for MoonPay receipts, then generate your signed checkout link."
            >
              <WalletCard address={walletAddress} />
              <label style={styles.label}>Email (optional)</label>
              <input
                style={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <ErrorBox msg={error} />}
              <button style={styles.primaryBtn} onClick={generateCheckout} disabled={loading}>
                {loading ? <Spinner /> : "Generate Checkout Link →"}
              </button>
            </StepPanel>
          )}

          {/* STEP 2: Payment */}
          {step === STEP.PAYMENT && (
            <StepPanel
              icon="💳"
              title="Complete PayPal Payment"
              desc="Your signed MoonPay checkout link is ready. Click below to open the payment page and complete your PayPal purchase."
            >
              <WalletCard address={walletAddress} />
              <div style={styles.urlBox}>
                <span style={styles.urlLabel}>Signed Checkout URL</span>
                <span style={styles.urlText}>{checkoutUrl?.slice(0, 80)}…</span>
              </div>
              <InfoBox>
                You will be purchasing <strong>USDC on Solana</strong> via PayPal.
                MoonPay sandbox uses test funds — no real money is charged.
              </InfoBox>
              <button style={{ ...styles.primaryBtn, background: "var(--paypal)" }} onClick={openCheckout}>
                <PayPalIcon size={18} /> Open PayPal Checkout
              </button>
              <button style={styles.ghostBtn} onClick={() => setStep(STEP.CHECKOUT)}>← Regenerate</button>
            </StepPanel>
          )}

          {/* STEP 3: Confirm */}
          {step === STEP.CONFIRM && (
            <StepPanel
              icon="🔎"
              title="Confirm Transaction"
              desc="Complete the PayPal payment in the MoonPay window, then click Confirm to check the status — or wait for the webhook to auto-update."
            >
              <WalletCard address={walletAddress} />
              {txStatus && (
                <div style={styles.statusRow}>
                  <span style={styles.statusLabel}>Transaction Status</span>
                  <StatusBadge status={txStatus} />
                </div>
              )}
              {txDetail?.transactionId && (
                <div style={styles.metaRow}>
                  <span style={{ color: "var(--muted)" }}>Tx ID</span>
                  <span style={styles.mono}>{txDetail.transactionId}</span>
                </div>
              )}
              {txDetail?.cryptoAmount && (
                <div style={styles.metaRow}>
                  <span style={{ color: "var(--muted)" }}>Amount</span>
                  <span style={styles.mono}>{txDetail.cryptoAmount} {txDetail.currency}</span>
                </div>
              )}
              {pollActive && (
                <div style={styles.pollNotice}>
                  <Spinner size={14} /> Auto-checking every 8 seconds…
                </div>
              )}
              {error && <ErrorBox msg={error} />}
              <button style={styles.primaryBtn} onClick={checkStatus} disabled={loading}>
                {loading ? <Spinner /> : "Check Status"}
              </button>
              <button style={styles.ghostBtn} onClick={openCheckout}>
                Reopen Checkout ↗
              </button>
            </StepPanel>
          )}

          {/* STEP 4: Complete */}
          {step === STEP.COMPLETE && (
            <StepPanel
              icon="✅"
              title="Payment Complete!"
              desc="MoonPay has processed your payment and USDC should be arriving at your Solana Devnet wallet."
            >
              <WalletCard address={walletAddress} />
              {txDetail && (
                <div style={styles.completeBox}>
                  <div style={styles.completeStat}>
                    <span>Status</span>
                    <StatusBadge status={txDetail.status} />
                  </div>
                  {txDetail.cryptoAmount && (
                    <div style={styles.completeStat}>
                      <span>Amount Received</span>
                      <strong style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                        {txDetail.cryptoAmount} {txDetail.currency}
                      </strong>
                    </div>
                  )}
                  {txDetail.transactionId && (
                    <div style={styles.completeStat}>
                      <span>Transaction ID</span>
                      <span style={styles.mono}>{txDetail.transactionId}</span>
                    </div>
                  )}
                </div>
              )}
              <button style={styles.primaryBtn} onClick={reset}>Start New Transaction</button>
            </StepPanel>
          )}
        </div>

        {/* Webhook panel */}
        <div className="flow-side-panel">
          <h3 style={styles.sidePanelTitle}>Webhook Listener</h3>
          <p style={styles.sidePanelDesc}>
            Your backend at <code style={styles.code}>/moonpay-webhook</code> is listening for real-time callbacks from MoonPay.
          </p>
          <div style={styles.webhookItem}>
            <span style={styles.webhookDot} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>transaction_updated</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Signature verified via HMAC-SHA256</div>
            </div>
          </div>
          <div style={styles.webhookItem}>
            <span style={styles.webhookDot} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>completed → crypto delivered</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Triggers conversion hook</div>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h3 style={styles.sidePanelTitle}>Flow Summary</h3>
            {[
              ["1", "Phantom connects on Devnet"],
              ["2", "Backend signs MoonPay URL"],
              ["3", "User pays via PayPal sandbox"],
              ["4", "Status polled + webhook fires"],
              ["5", "USDC delivered to wallet"],
            ].map(([n, t]) => (
              <div key={n} style={styles.flowItem}>
                <span style={styles.flowNum}>{n}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StepPanel({ icon, title, desc, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={styles.stepHeader}>
        <span style={styles.stepIcon}>{icon}</span>
        <div>
          <h2 style={styles.stepTitle}>{title}</h2>
          <p style={styles.stepDesc}>{desc}</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function WalletCard({ address }) {
  return (
    <div style={styles.walletCard}>
      <div style={styles.walletDot} />
      <div>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Connected Wallet</div>
        <div style={styles.walletAddr}>{address}</div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return (
    <div style={{ padding: "10px 14px", background: "rgba(255,92,92,0.08)", border: "1px solid rgba(255,92,92,0.25)", borderRadius: "var(--radius)", color: "var(--err)", fontSize: 13 }}>
      ⚠ {msg}
    </div>
  );
}

function InfoBox({ children }) {
  return (
    <div style={{ padding: "10px 14px", background: "rgba(0,255,163,0.05)", border: "1px solid rgba(0,255,163,0.2)", borderRadius: "var(--radius)", color: "var(--muted)", fontSize: 13 }}>
      ℹ {children}
    </div>
  );
}

function Note({ children }) {
  return <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{children}</p>;
}

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: `2px solid rgba(255,255,255,0.2)`,
      borderTop: `2px solid currentColor`,
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

// Inline keyframes via style tag
if (!document.getElementById("spin-style")) {
  const s = document.createElement("style");
  s.id = "spin-style";
  s.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(s);
}

function MoonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="var(--accent)" />
    </svg>
  );
}

function PayPalIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7.5 21H3L6 3h7c3.5 0 5.5 1.5 5 4.5-.5 3-3 4.5-6 4.5H9.5L8.5 16H12l-1.5 5H7.5z" fill="#0070ba"/>
      <path d="M10 16.5H13.5c3.5 0 5.5-1.5 5-4.5-.5-3-3-4-5.5-4H10L8.5 16.5" fill="#003087" opacity=".6"/>
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = {
  header: { borderBottom: "1px solid var(--border)", padding: "14px 24px" },
  logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 18 },
  logoDivider: { color: "var(--muted)", fontWeight: 300 },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  networkBadge: { fontSize: 12, padding: "3px 10px", borderRadius: 20, background: "rgba(0,255,163,0.1)", color: "var(--accent)", fontFamily: "var(--font-mono)", fontWeight: 600 },
  disconnectBtn: { fontSize: 12, padding: "5px 12px", borderRadius: "var(--radius)", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer", fontFamily: "var(--font-mono)" },

  progressItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 80 },
  progressDot: { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#000", transition: "all 0.3s" },
  progressLabel: { fontSize: 11, fontWeight: 500, textAlign: "center", transition: "color 0.3s", whiteSpace: "nowrap" },
  progressLine: { flex: 1, height: 1, margin: "0 4px", marginBottom: 22, transition: "background 0.3s" },

  sidePanelTitle: { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", marginBottom: 10 },
  sidePanelDesc: { fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 },
  code: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" },
  webhookItem: { display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)" },
  webhookDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", marginTop: 4, flexShrink: 0 },
  flowItem: { display: "flex", gap: 10, alignItems: "center", padding: "6px 0" },
  flowNum: { width: 20, height: 20, borderRadius: "50%", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, color: "var(--muted)" },

  stepHeader: { display: "flex", gap: 16, alignItems: "flex-start" },
  stepIcon: { fontSize: 28, flexShrink: 0 },
  stepTitle: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  stepDesc: { fontSize: 14, color: "var(--muted)", lineHeight: 1.6 },

  walletCard: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)", borderRadius: "var(--radius)" },
  walletDot: { width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, boxShadow: "0 0 8px var(--accent)" },
  walletAddr: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", wordBreak: "break-all" },

  label: { fontSize: 13, fontWeight: 600, color: "var(--muted)" },
  input: { padding: "10px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-body)", outline: "none", width: "100%" },

  primaryBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 20px", background: "var(--accent)", color: "#000", border: "none", borderRadius: "var(--radius)", fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%", transition: "opacity 0.2s" },
  ghostBtn: { padding: "10px 20px", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontFamily: "var(--font-body)", fontWeight: 500, fontSize: 14, cursor: "pointer", width: "100%", textAlign: "center" },

  urlBox: { padding: "12px 16px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" },
  urlLabel: { display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  urlText: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", wordBreak: "break-all" },

  statusRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" },
  statusLabel: { fontWeight: 600, fontSize: 14 },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 },
  mono: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" },
  pollNotice: { display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 },

  completeBox: { background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)", borderRadius: "var(--radius)", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  completeStat: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 },
};
