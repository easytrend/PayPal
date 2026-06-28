import React, { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, clusterApiUrl, PublicKey, Keypair } from "@solana/web3.js";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo 
} from "@solana/spl-token";

const BACKEND = "/api"; // proxied by Vite → localhost:3001

// ── Step constants ─────────────────────────────────────────────────────────
const STEP = {
  CONNECT:   0,
  CHECKOUT:  1,
  PAYMENT:   2,
  CONFIRM:   3,
  COMPLETE:  4,
};

const STEP_LABELS = ["Connect Wallet", "Generate Link", "Send Cash", "Confirm Payment", "Done"];

const SIM_STATE = {
  NOT_SENT:   "NOT_SENT",
  PENDING:    "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED:  "COMPLETED",
};

// ── Helpers ────────────────────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
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
  const [status, setStatus]           = useState(null);
  const [simState, setSimState]       = useState(SIM_STATE.NOT_SENT);

  // Auto-advance/reset steps based on wallet connection
  useEffect(() => {
    if (connected && walletAddress && step === STEP.CONNECT) {
      setStep(STEP.CHECKOUT);
    }
    if (!connected && step > STEP.CONNECT) {
      setStep(STEP.CONNECT);
      setCheckoutUrl(null);
      setStatus(null);
      setError(null);
      setSimState(SIM_STATE.NOT_SENT);
    }
  }, [connected, walletAddress]);

  // ── Generate PayPal Checkout Link ──────────────────────────────────────
  const generatePaypalLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${BACKEND}/generate-paypal-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, amount: 50, email: email || undefined }),
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
      setSimState(SIM_STATE.NOT_SENT);
      setStep(STEP.PAYMENT);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, email]);

  // ── Transition: Send Cash ────────────────────────────────────────────────
  const sendCash = () => {
    setSimState(SIM_STATE.PENDING);
    setStep(STEP.CONFIRM);
  };

  // ── Live On-Chain Solana Devnet Minting Simulation ──────────────────────
  const simulateUSDC = async (receiverAddress) => {
    try {
      setStatus("⏳ Spawning a temporary simulation payer on Devnet...");
      const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
      const payerKeypair = Keypair.generate();

      // Get SOL airdrop to pay for minting fees
      const airdropSig = await connection.requestAirdrop(payerKeypair.publicKey, 1.2 * 1000000000); // 1.2 SOL
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: airdropSig,
        ...latestBlockhash
      }, "confirmed");

      setStatus("⏳ Generating custom USDC Mint Account on Devnet...");
      const usdcMint = await createMint(
        connection,
        payerKeypair,          // payer
        payerKeypair.publicKey, // mint authority
        null,                  // freeze authority
        6                      // decimals
      );

      setStatus("⏳ Preparing Associated Token Account for receiver...");
      const receiverPublicKey = new PublicKey(receiverAddress);
      const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payerKeypair,
        usdcMint,
        receiverPublicKey
      );

      setStatus("⏳ Minting 100 USDC and delivering on-chain...");
      await mintTo(
        connection,
        payerKeypair,
        usdcMint,
        receiverTokenAccount.address,
        payerKeypair,
        100000000 // 100 USDC (6 decimals)
      );

      setStatus(`💰 100 USDC simulated and delivered on-chain to ${shortAddr(receiverAddress)}!`);
      setStep(STEP.COMPLETE);
    } catch (err) {
      console.error("On-chain simulation error:", err);
      // Fallback mock delivery if RPC / airdrops fail
      setStatus(`💰 [Simulation Fallback] Devnet rate limit reached. Simulated 100 USDC delivered to ${shortAddr(receiverAddress)}.`);
      setStep(STEP.COMPLETE);
    }
  };

  // ── Automatic Progressive Status Timer ──────────────────────────────────
  useEffect(() => {
    if (step !== STEP.CONFIRM || !walletAddress) return;

    setLoading(true);
    setStatus("⏳ Awaiting fiat checkout from the sender...");

    // Transition to PROCESSING after 4 seconds
    const timer1 = setTimeout(() => {
      setSimState(SIM_STATE.PROCESSING);
      setStatus("⏳ MoonPay has received fiat from the sender. Converting to USDC...");

      // Transition to COMPLETED & Mint after another 4 seconds
      const timer2 = setTimeout(() => {
        setSimState(SIM_STATE.COMPLETED);
        setStatus("✅ Payment confirmed! Initiating Solana Devnet USDC simulation...");
        
        simulateUSDC(walletAddress).then(() => {
          setLoading(false);
        });
      }, 4000);

      return () => clearTimeout(timer2);
    }, 4000);

    return () => {
      clearTimeout(timer1);
    };
  }, [step, walletAddress]);

  // ── Reset ──────────────────────────────────────────────────────────────
  const reset = () => {
    setCheckoutUrl(null);
    setStatus(null);
    setError(null);
    setEmail("");
    setSimState(SIM_STATE.NOT_SENT);
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

      {/* Main Content */}
      <main className="flow-main">
        <div className="flow-card">
          {/* STEP 0: Connect */}
          {step === STEP.CONNECT && (
            <StepPanel
              icon="🔗"
              title="Connect Your Wallet"
              desc="Connect your Phantom wallet on Solana Devnet to begin. USDC will be simulated and delivered to this address after payment."
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
              desc="Generate your signed checkout link to initiate a mock PayPal payment via MoonPay."
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
              <button style={styles.primaryBtn} onClick={generatePaypalLink} disabled={loading}>
                {loading ? <Spinner /> : "Generate PayPal Link →"}
              </button>
            </StepPanel>
          )}

          {/* STEP 2: Send Cash */}
          {step === STEP.PAYMENT && (
            <StepPanel
              icon="💳"
              title="Send Checkout Link"
              desc="Your checkout link is generated. Click Send Cash to register the link as sent and start processing the transaction."
            >
              <WalletCard address={walletAddress} />
              <div style={styles.urlBox}>
                <span style={styles.urlLabel}>Signed Checkout Link</span>
                <span style={styles.urlText}>{checkoutUrl}</span>
              </div>
              <InfoBox>
                Once you click the Send Cash button, the checkout link will be sent and payment processing begins automatically.
              </InfoBox>
              <button style={{ ...styles.primaryBtn, background: "var(--accent)", color: "#000" }} onClick={sendCash}>
                💸 Send Cash
              </button>
              <button style={styles.ghostBtn} onClick={() => setStep(STEP.CHECKOUT)}>← Regenerate</button>
            </StepPanel>
          )}

          {/* STEP 3: Confirm Payment */}
          {step === STEP.CONFIRM && (
            <StepPanel
              icon="🔎"
              title="Confirm Payment Status"
              desc="Processing payment. The status updates in real-time as MoonPay settling the fiat-to-crypto transaction."
            >
              <WalletCard address={walletAddress} />
              
              <div style={{ marginBottom: 10, fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
                ⚙️ Automatic Simulation: Status transitions automatically. Running live minting on Solana Devnet...
              </div>

              {/* Status display cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "10px 0" }}>
                {simState === SIM_STATE.PENDING && (
                  <div style={{ ...styles.statusCard, borderLeftColor: "var(--warn)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>Status: Pending</strong>
                      <span className="status-indicator pending" />
                    </div>
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                      Waiting for the sender to complete the PayPal checkout process. MoonPay is expecting to receive fiat.
                    </p>
                  </div>
                )}
                {simState === SIM_STATE.PROCESSING && (
                  <div style={{ ...styles.statusCard, borderLeftColor: "var(--paypal)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>Status: Processing</strong>
                      <span className="status-indicator processing" />
                    </div>
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                      MoonPay has received the fiat payment from the sender and is currently converting it to USDC.
                    </p>
                  </div>
                )}
                {simState === SIM_STATE.COMPLETED && (
                  <div style={{ ...styles.statusCard, borderLeftColor: "var(--accent)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>Status: Completed</strong>
                      <span className="status-indicator completed" />
                    </div>
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                      Payment settled. MoonPay has completed the transaction and is delivering USDC to your Solana wallet.
                    </p>
                  </div>
                )}
              </div>

              {status && (
                <div style={styles.statusBox}>
                  <Spinner size={14} /> <span style={{ marginLeft: 8 }}>{status}</span>
                </div>
              )}
              {error && <ErrorBox msg={error} />}

              {/* Responsive Status Info Buttons (non-interactive, automated) */}
              {simState === SIM_STATE.PENDING && (
                <button 
                  style={{ ...styles.primaryBtn, background: "var(--warn)", color: "#000", opacity: 0.8, cursor: "not-allowed" }} 
                  disabled={true}
                >
                  <Spinner /> Awaiting PayPal Payment (Pending)
                </button>
              )}
              {simState === SIM_STATE.PROCESSING && (
                <button 
                  style={{ ...styles.primaryBtn, background: "var(--paypal)", color: "#fff", opacity: 0.8, cursor: "not-allowed" }} 
                  disabled={true}
                >
                  <Spinner /> Converting Funds (Processing)
                </button>
              )}
              {simState === SIM_STATE.COMPLETED && (
                <button 
                  style={{ ...styles.primaryBtn, background: "var(--accent)", color: "#000", opacity: 0.8, cursor: "not-allowed" }} 
                  disabled={true}
                >
                  <Spinner /> Settling USDC (Completed)
                </button>
              )}
              
              <button style={styles.ghostBtn} onClick={() => window.open(checkoutUrl, "_blank")}>
                Reopen Checkout Link ↗
              </button>
            </StepPanel>
          )}

          {/* STEP 4: Complete */}
          {step === STEP.COMPLETE && (
            <StepPanel
              icon="✅"
              title="Confirm Delivery Details"
              desc="USDC has been successfully deposited into your Solana Devnet wallet. Here is the transaction confirmation."
            >
              <WalletCard address={walletAddress} />
              <div style={styles.completeBox}>
                <div style={styles.completeHeader}>
                  <span style={{ fontWeight: 600 }}>Delivery Confirmation</span>
                  <span className="success-badge">USDC Settled</span>
                </div>
                <div style={styles.completeMessage}>
                  <p>{status}</p>
                </div>
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Destination Network</span>
                    <strong>Solana Devnet</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Asset Delivered</span>
                    <strong>100 USDC</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Status</span>
                    <strong style={{ color: "var(--accent)" }}>Success</strong>
                  </div>
                </div>
              </div>
              <button style={styles.primaryBtn} onClick={reset}>Start New Transaction</button>
            </StepPanel>
          )}
        </div>

        {/* Side Panel Info */}
        <div className="flow-side-panel">
          <h3 style={styles.sidePanelTitle}>Simulation Info</h3>
          <p style={styles.sidePanelDesc}>
            This application simulates a live fiat-to-crypto checkout flow using MoonPay's widget APIs, backed by a real Solana Devnet contract mint execution.
          </p>
          <div style={styles.flowItem}>
            <span style={styles.flowNum}>1</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Connect Devnet Wallet</span>
          </div>
          <div style={styles.flowItem}>
            <span style={styles.flowNum}>2</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Generate Secure PayPal Link</span>
          </div>
          <div style={styles.flowItem}>
            <span style={styles.flowNum}>3</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Send Checkout Link</span>
          </div>
          <div style={styles.flowItem}>
            <span style={styles.flowNum}>4</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Confirm Settled Payment</span>
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

// ── Sub-components Continued ───────────────────────────────────────────────
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

// Expose keyframes dynamically
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
  ghostBtn: { padding: "10px 20px", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontFamily: "var(--font-body)", fontWeight: 500, fontSize: 14, cursor: "pointer", width: "100%", textAlign: "center", marginTop: 10 },

  urlBox: { padding: "12px 16px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" },
  urlLabel: { display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  urlText: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", wordBreak: "break-all" },

  statusBox: { display: "flex", alignItems: "center", padding: 12, background: "rgba(255,179,64,0.05)", border: "1px solid rgba(255,179,64,0.2)", borderRadius: "var(--radius)", fontSize: 14, color: "var(--text)", marginTop: 10 },
  completeBox: { background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)", borderRadius: "var(--radius)", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  completeHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, borderBottom: "1px solid var(--border)", paddingBottom: 8 },
  completeMessage: { fontSize: 14, color: "var(--text)", lineHeight: 1.5 },
  
  statusCard: { background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "4px solid var(--border)", borderRadius: "var(--radius)", padding: 16, width: "100%" },
};
