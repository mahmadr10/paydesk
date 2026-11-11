import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import * as pd from "../api/paydesk";
import type { Order, Product } from "../api/paydesk";
import { getApiErrorMessage } from "../api/client";

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50";

function useConfig() {
  return useQuery({ queryKey: ["payments-config"], queryFn: pd.getPaymentsConfig, staleTime: Infinity });
}

function ModeBanner() {
  const { data } = useConfig();
  if (!data) return null;
  return data.mode === "sandbox" ? (
    <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Connected to <b>PayPal Sandbox</b> - real PayPal APIs, test money.</p>
  ) : (
    <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <b>Simulated PayPal</b> (no sandbox keys set). Everything works the same; add PAYPAL_CLIENT_ID/SECRET to use the real sandbox.
    </p>
  );
}

// ── PayPal JS SDK buttons ───────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PayPal JS SDK has no bundled types
    paypal?: any;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadPayPalSdk(clientId: string, currency: string) {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load PayPal"));
      document.body.appendChild(s);
    });
  }
  return sdkPromise;
}

function PayPalButtons({ sku, onPaid }: { sku: string; onPaid: (o: Order) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { data: config } = useConfig();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config?.clientId || !ref.current) return;
    let localOrderId = "";
    let cancelled = false;
    loadPayPalSdk(config.clientId, config.currency)
      .then(() => {
        if (cancelled || !ref.current || !window.paypal) return;
        ref.current.innerHTML = "";
        window.paypal
          .Buttons({
            style: { layout: "horizontal", height: 38, tagline: false },
            createOrder: async () => {
              const o = await pd.createOrder(sku);
              localOrderId = o._id;
              return o.paypalOrderId;
            },
            onApprove: async () => onPaid(await pd.captureOrder(localOrderId)),
            onError: (e: unknown) => setError(String(e)),
          })
          .render(ref.current);
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [config, sku, onPaid]);

  return (
    <div>
      <div ref={ref} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SimulatedCheckout({ sku, onPaid }: { sku: string; onPaid: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const o = await pd.createOrder(sku);
          onPaid(await pd.captureOrder(o._id));
        } finally {
          setBusy(false);
        }
      }}
      className={`${btn} w-full bg-[#ffc439] text-slate-900 hover:brightness-95`}
    >
      {busy ? "Paying…" : "Pay with PayPal (simulated)"}
    </button>
  );
}

// ── Buyer: shop ─────────────────────────────────────────────────────────

export function ShopPage() {
  const { data: config } = useConfig();
  const { data: products } = useQuery({ queryKey: ["catalog"], queryFn: pd.getCatalog });
  const [paid, setPaid] = useState<Order | null>(null);
  const qc = useQueryClient();
  const onPaid = (o: Order) => {
    setPaid(o);
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  return (
    <div className="mx-auto mt-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-800">Pixel & Co. - digital store</h1>
      <p className="mb-4 text-sm text-slate-500">Design assets, UI kits and courses. Pay securely with PayPal.</p>
      <ModeBanner />
      {paid && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          ✅ Paid {pd.money(paid.total, paid.currency)} for {paid.orderNumber}. <Link to="/orders" className="font-semibold underline">Go to my orders</Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {products?.map((p: Product) => (
          <div key={p.sku} className={`${card} flex flex-col`}>
            <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-sky-50 text-5xl">{p.emoji}</div>
            <h3 className="font-semibold text-slate-800">{p.name}</h3>
            <p className="mb-3 flex-1 text-xs text-slate-500">{p.description}</p>
            <p className="mb-3 text-xl font-bold text-slate-900">{pd.money(p.price)}</p>
            {config?.mode === "sandbox" ? <PayPalButtons sku={p.sku} onPaid={onPaid} /> : <SimulatedCheckout sku={p.sku} onPaid={onPaid} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Buyer: my orders + smart help ───────────────────────────────────────

const DISPUTE_REASONS = [
  ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "I didn't receive it"],
  ["MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "Not as described"],
  ["UNAUTHORISED", "I didn't authorise this payment"],
  ["DUPLICATE_TRANSACTION", "I was charged twice"],
];

export function MyOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const { data: orders } = useQuery({ queryKey: ["orders", "mine"], queryFn: () => pd.listOrders(true) });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [reason, setReason] = useState(DISPUTE_REASONS[0][0]);
  const [disputeMsg, setDisputeMsg] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function submitHelp() {
    setBusy(true);
    setError(null);
    try {
      const r = await pd.smartIntake(message);
      navigate(`/tickets/${r.ticket._id}`);
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-4xl">
      <ModeBanner />
      <div className={`${card} mb-6 border-indigo-200`}>
        <h2 className="font-semibold text-slate-800">Problem with an order?</h2>
        <p className="mb-3 text-xs text-slate-500">Just describe it. Our AI finds the right PayPal payment and opens a case for you.</p>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. I was charged twice for the UI kit yesterday"
          className="w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          {error ? <p className="text-xs text-red-600">{error}</p> : <span />}
          <button onClick={submitHelp} disabled={busy || message.trim().length < 10} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
            {busy ? "Opening case…" : "Get help"}
          </button>
        </div>
      </div>

      {notice && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}
      <h2 className="mb-2 font-semibold text-slate-800">My orders</h2>
      {orders?.length === 0 && (
        <p className="text-sm text-slate-400">
          No orders yet. <Link to="/shop" className="text-indigo-600 underline">Visit the shop</Link>
        </p>
      )}
      <div className="flex flex-col gap-3">
        {orders?.map((o) => (
          <div key={o._id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-800">{o.items.map((i) => i.name).join(", ")}</p>
                <p className="text-xs text-slate-400">{o.orderNumber} · {o.paidAt && formatDistanceToNow(new Date(o.paidAt), { addSuffix: true })}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{pd.money(o.total, o.currency)}</p>
                <p className="text-xs text-slate-500">{pd.human(o.status)}{o.refundedTotal > 0 && ` · ${pd.money(o.refundedTotal)} refunded`}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.status !== "REFUNDED" && (
                <button
                  onClick={async () => {
                    const r = await pd.downloadOrder(o._id);
                    setNotice(`Download started: ${r.files.join(", ")} (${r.note})`);
                    qc.invalidateQueries({ queryKey: ["orders"] });
                  }}
                  className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}
                >
                  ⬇ Download ({o.fulfillment?.accessCount ?? 0})
                </button>
              )}
              {config?.mode === "simulated" && o.status !== "REFUNDED" && (
                <button onClick={() => setDisputeFor(disputeFor === o._id ? null : o._id)} className={`${btn} bg-rose-50 text-rose-700 hover:bg-rose-100`}>
                  Open PayPal dispute
                </button>
              )}
            </div>
            {disputeFor === o._id && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="mb-2 text-xs text-rose-800">This simulates you (the buyer) opening a dispute in PayPal's Resolution Center. The seller gets it through a webhook.</p>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 w-full rounded border border-rose-200 p-1.5 text-sm">
                  {DISPUTE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <textarea rows={2} value={disputeMsg} onChange={(e) => setDisputeMsg(e.target.value)} placeholder="Tell PayPal what happened" className="w-full rounded border border-rose-200 p-2 text-sm" />
                <button
                  disabled={disputeMsg.trim().length < 5}
                  onClick={async () => {
                    await pd.simulateDispute(o._id, reason, disputeMsg);
                    setDisputeFor(null);
                    setDisputeMsg("");
                    setNotice("Dispute filed with PayPal. The seller has been notified.");
                  }}
                  className={`${btn} mt-2 bg-rose-600 text-white hover:bg-rose-700`}
                >
                  File dispute
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Seller: dashboard ───────────────────────────────────────────────────

export function SellerDashboardPage() {
  const qc = useQueryClient();
  const { data: stats } = useQuery({ queryKey: ["refund-stats"], queryFn: pd.getRefundStats, refetchInterval: 10000 });
  const { data: cases } = useQuery({ queryKey: ["dispute-cases"], queryFn: pd.listDisputeCases, refetchInterval: 5000 });
  const { data: events } = useQuery({ queryKey: ["events"], queryFn: pd.listEvents, refetchInterval: 5000 });
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const open = cases?.filter((c) => c.dispute?.status !== "RESOLVED") ?? [];
  const atRisk = open.reduce((s, c) => s + (c.dispute?.amount ?? 0), 0);
  const tiles = [
    ["Revenue (PayPal)", pd.money(stats?.revenue ?? 0)],
    ["Open disputes", `${open.length} · ${pd.money(atRisk)} at risk`],
    ["Waiting for your approval", `${stats?.pendingCount ?? 0} refund(s)`],
    ["Refunded", pd.money(stats?.refunded ?? 0)],
  ];

  return (
    <div className="mx-auto mt-8 max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Seller co-pilot</h1>
          <p className="text-sm text-slate-500">PayPal disputes and refund requests, investigated by AI, decided by you.</p>
        </div>
        <button
          onClick={async () => {
            try {
              const r = await pd.syncDisputes();
              setSyncMsg(`Checked ${r.checked} dispute(s) in PayPal, ${r.created} new.`);
              qc.invalidateQueries({ queryKey: ["dispute-cases"] });
            } catch (e) {
              setSyncMsg(getApiErrorMessage(e));
            }
          }}
          className={`${btn} bg-slate-800 text-white hover:bg-slate-900`}
        >
          ↻ Sync disputes from PayPal
        </button>
      </div>
      <ModeBanner />
      {syncMsg && <p className="mb-3 text-xs text-slate-500">{syncMsg}</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className={card}>
            <p className="text-xs text-slate-500">{k}</p>
            <p className="text-xl font-bold text-slate-800">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className={card}>
          <h2 className="mb-3 font-semibold text-slate-800">Disputes</h2>
          {cases?.length === 0 && <p className="text-sm text-slate-400">No disputes yet. They appear here the moment PayPal sends them.</p>}
          <div className="flex flex-col divide-y divide-slate-100">
            {cases?.map((c) => {
              const due = c.dispute?.sellerResponseDue ? new Date(c.dispute.sellerResponseDue) : null;
              return (
                <Link key={c._id} to={`/tickets/${c._id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{pd.human(c.dispute!.reason)} · {pd.money(c.dispute!.amount, c.dispute!.currency)}</p>
                    <p className="text-xs text-slate-400">{c.ticketNumber} · {c.dispute!.disputeId}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p className={c.dispute!.status === "RESOLVED" ? "text-emerald-600" : "text-rose-600"}>{pd.human(c.dispute!.status)}</p>
                    {c.disputeProposal?.status === "PENDING" && <p className="font-semibold text-indigo-600">🤖 {pd.human(c.disputeProposal.action)} - needs approval</p>}
                    {due && c.dispute!.status !== "RESOLVED" && <p className="text-slate-400">due {formatDistanceToNow(due, { addSuffix: true })}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
        <div className={card}>
          <h2 className="mb-3 font-semibold text-slate-800">Live PayPal events</h2>
          {events?.length === 0 && <p className="text-sm text-slate-400">Webhook events show up here.</p>}
          <ul className="flex flex-col gap-2">
            {events?.map((e) => (
              <li key={e._id} className="rounded-lg bg-slate-50 p-2 text-xs">
                <p className="font-mono text-[11px] text-slate-700">{e.eventType}</p>
                <p className="text-slate-500">{e.result} · {formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true })}</p>
                <p className="text-slate-400">{e.verified ? "✔ signature verified by PayPal" : "simulated"}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Seller: Ask PayPal (Agent Toolkit) ──────────────────────────────────

const SUGGESTIONS = ["Which disputes need my attention first?", "How much did I sell this week?", "Summarise my recent refunds"];

export function AssistantPage() {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string; tools?: string[] }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: config } = useConfig();

  async function ask(question: string) {
    if (!question.trim()) return;
    const prior = history.map(({ role, content }) => ({ role, content }));
    setHistory((h) => [...h, { role: "user", content: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await pd.askAssistant(question, prior);
      setHistory((h) => [...h, { role: "assistant", content: r.answer, tools: r.toolsUsed }]);
    } catch (e) {
      setHistory((h) => [...h, { role: "assistant", content: `⚠️ ${getApiErrorMessage(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800">Ask PayPal</h1>
      <p className="mb-4 text-sm text-slate-500">
        Chat with your PayPal account. Powered by PayPal's <b>Agent Toolkit</b> {config?.mode === "simulated" && "(simulated data until sandbox keys are set)"} - read-only, so it can't move money.
      </p>
      <div className={`${card} flex min-h-[320px] flex-col gap-3`}>
        {history.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-100">{s}</button>
            ))}
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={m.role === "user" ? "self-end rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white" : "self-start max-w-[90%]"}>
            {m.role === "assistant" ? (
              <>
                <p className="whitespace-pre-wrap rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-800">{m.content}</p>
                {m.tools && m.tools.length > 0 && <p className="mt-1 text-[11px] text-slate-400">PayPal tools used: {[...new Set(m.tools)].join(", ")}</p>}
              </>
            ) : (
              m.content
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400">Checking PayPal…</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="mt-3 flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about disputes, payments, refunds…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy} className={`${btn} bg-indigo-600 text-white`}>Ask</button>
      </form>
    </div>
  );
}
