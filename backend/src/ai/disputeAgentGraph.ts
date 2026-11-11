import { z } from "zod";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import * as paypal from "../services/paypalService";
import type { DisputeSnapshot } from "../services/paypalService";
import { groqModel } from "./groq";

// The dispute agent. A PayPal dispute (inquiry or chargeback) arrives and
// the seller must answer before a deadline: refund, offer a partial refund,
// or fight it with evidence. Small sellers lose disputes mostly because
// they don't answer well or in time. This agent prepares the answer:
//
//   START → gatherEvidence → assess → policyGuard → draftResponse → END
//
//   gatherEvidence  TOOL  Fresh dispute from PayPal (Disputes API) + the
//                         capture (Payments API) + our order: what was sold,
//                         when it was delivered, whether the buyer downloaded
//                         it, what was refunded already, past support cases.
//   assess          LLM   Accept, offer, or contest - with a win estimate.
//   policyGuard     CODE  Only actions PayPal currently allows; no contesting
//                         "not received" without delivery proof; offers below
//                         the disputed amount; nothing on resolved disputes.
//   draftResponse   LLM   The note sent to PayPal. The evidence FILE is built
//                         by code from real records only, never by the LLM,
//                         so the agent can't invent evidence.
//
// Nothing is sent to PayPal here. A person approves first.

export type DisputeAction = "ACCEPT_CLAIM" | "MAKE_OFFER" | "CONTEST" | "NONE";

export interface DisputeAgentInput {
  disputeId: string;
  order: {
    orderNumber: string;
    items: { name: string; quantity: number; unitPrice: number }[];
    total: number;
    currency: string;
    captureId: string;
    paidAt: Date | null;
    payerEmail: string | null;
    refundedTotal: number;
    deliveredAt: Date | null;
    accessCount: number;
    lastAccessAt: Date | null;
  } | null;
  priorCases: { ticketNumber: string; title: string; status: string; createdAt: Date }[];
}

export interface DisputeFacts {
  disputeId: string;
  reason: string;
  status: string;
  stage: string;
  disputedAmount: number;
  currency: string;
  sellerResponseDue: string | null;
  buyerMessages: string[];
  allowedActions: string[];
  captureStatus: string | null;
  orderFound: boolean;
  deliveredAt: string | null;
  downloads: number;
  lastDownloadAt: string | null;
  refundedAlready: number;
  priorCases: number;
}

export interface DisputeAgentOutput {
  facts: DisputeFacts;
  action: DisputeAction;
  amount: number;
  winChance: number;
  reasoning: string;
  policyNotes: string[];
  responseNote: string;
  evidenceText: string;
  snapshot: DisputeSnapshot;
  source: "groq" | "rules";
  steps: { name: string; detail: string }[];
}

const State = Annotation.Root({
  input: Annotation<DisputeAgentInput>(),
  useLlm: Annotation<boolean>(),
  snapshot: Annotation<DisputeSnapshot>(),
  facts: Annotation<DisputeFacts>(),
  action: Annotation<DisputeAction>(),
  amount: Annotation<number>(),
  winChance: Annotation<number>(),
  reasoning: Annotation<string>(),
  policyNotes: Annotation<string[]>(),
  responseNote: Annotation<string>(),
  evidenceText: Annotation<string>(),
  steps: Annotation<{ name: string; detail: string }[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type S = typeof State.State;

const round2 = (n: number) => Math.round(n * 100) / 100;
const human = (s: string) => s.replace(/_/g, " ").toLowerCase();
const model = () => groqModel(0.1);

// ── 1. gatherEvidence ──────────────────────────────────────────────────

async function gatherEvidence(state: S): Promise<Partial<S>> {
  const snapshot = await paypal.getDispute(state.input.disputeId);
  const o = state.input.order;
  let captureStatus: string | null = null;
  if (o) {
    try {
      captureStatus = (await paypal.getCaptureDetails(o.captureId)).status;
    } catch {
      captureStatus = null; // capture lookup is a bonus, not required
    }
  }

  const facts: DisputeFacts = {
    disputeId: snapshot.disputeId,
    reason: snapshot.reason,
    status: snapshot.status,
    stage: snapshot.stage,
    disputedAmount: snapshot.amount,
    currency: snapshot.currency,
    sellerResponseDue: snapshot.sellerResponseDue,
    buyerMessages: snapshot.messages.filter((m) => m.postedBy === "BUYER").map((m) => m.content),
    allowedActions: snapshot.actions,
    captureStatus,
    orderFound: !!o,
    deliveredAt: o?.deliveredAt?.toISOString() ?? null,
    downloads: o?.accessCount ?? 0,
    lastDownloadAt: o?.lastAccessAt?.toISOString() ?? null,
    refundedAlready: o?.refundedTotal ?? 0,
    priorCases: state.input.priorCases.length,
  };

  return {
    snapshot,
    facts,
    steps: [
      {
        name: "Read dispute from PayPal",
        detail: `${snapshot.disputeId}: ${human(snapshot.reason)}, ${snapshot.amount} ${snapshot.currency}, ${human(snapshot.stage)} stage, ${human(snapshot.status)}`,
      },
      {
        name: "Gathered evidence",
        detail: o
          ? `Order ${o.orderNumber} (capture ${captureStatus ?? "unknown"}); delivered ${o.deliveredAt ? "yes" : "no"}; ` +
            `buyer downloaded it ${o.accessCount} time(s); ${o.refundedTotal} already refunded; ${state.input.priorCases.length} earlier support case(s)`
          : "No matching order found in the store for this PayPal transaction.",
      },
    ],
  };
}

// ── 2. assess ──────────────────────────────────────────────────────────

const assessSchema = z.object({
  action: z.enum(["ACCEPT_CLAIM", "MAKE_OFFER", "CONTEST"]),
  amount: z.number().describe("Refund or offer amount. 0 when contesting."),
  winChance: z.number().min(0).max(1).describe("Estimated chance the seller wins if they contest."),
  reasoning: z.string().describe("2-3 plain sentences for the seller explaining the recommendation."),
});

function rulesAssess(f: DisputeFacts): z.infer<typeof assessSchema> {
  const delivered = f.downloads > 0;
  switch (f.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      return delivered
        ? {
            action: "CONTEST",
            amount: 0,
            winChance: 0.8,
            reasoning: `The buyer says they never received it, but our records show the download was used ${f.downloads} time(s). That is strong proof of delivery, so contesting is likely to win.`,
          }
        : {
            action: "ACCEPT_CLAIM",
            amount: f.disputedAmount,
            winChance: 0.15,
            reasoning: "The buyer says they never received it and there is no record of a download. Without delivery proof a contest would probably fail, so refunding is cheaper.",
          };
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      return {
        action: "MAKE_OFFER",
        amount: round2(f.disputedAmount * 0.5),
        winChance: 0.35,
        reasoning: "The buyer received the product but says it isn't as described. A 50% partial refund usually settles this faster than a contest the seller might lose.",
      };
    case "DUPLICATE_TRANSACTION":
      return {
        action: "ACCEPT_CLAIM",
        amount: f.disputedAmount,
        winChance: 0.1,
        reasoning: "The buyer reports a duplicate payment. Duplicates are almost always refunded, so accepting avoids a chargeback fee.",
      };
    case "UNAUTHORISED":
      return delivered
        ? {
            action: "CONTEST",
            amount: 0,
            winChance: 0.45,
            reasoning: "The buyer says the payment wasn't authorised, but the product was downloaded after purchase, which suggests the account holder used it. Contesting with the access record is reasonable.",
          }
        : {
            action: "ACCEPT_CLAIM",
            amount: f.disputedAmount,
            winChance: 0.1,
            reasoning: "Possible unauthorised payment and the product was never used. Refunding protects the buyer and the seller's account health.",
          };
    default:
      return {
        action: "MAKE_OFFER",
        amount: round2(f.disputedAmount * 0.5),
        winChance: 0.4,
        reasoning: "The dispute reason is unclear. A partial refund offer is a low-risk way to settle it.",
      };
  }
}

async function assess(state: S): Promise<Partial<S>> {
  const f = state.facts;
  let r: z.infer<typeof assessSchema>;
  if (state.useLlm) {
    r = await model()
      .structured(assessSchema)
      .invoke([
        {
          role: "system",
          content:
            "You are a PayPal dispute specialist helping a small online seller of DIGITAL products (download links). " +
            "Recommend ONE response:\n" +
            "- ACCEPT_CLAIM: refund the buyer and close the dispute (best when the seller would likely lose, or the amount is small).\n" +
            "- MAKE_OFFER: offer a partial refund to settle (inquiry stage only; good for 'not as described').\n" +
            "- CONTEST: fight it with evidence (only when the records clearly support the seller, e.g. download logs for 'not received').\n" +
            "Estimate the chance the seller wins a contest. Base everything ONLY on the facts given.",
        },
        {
          role: "user",
          content:
            `Dispute ${f.disputeId}: reason ${f.reason}, stage ${f.stage}, status ${f.status}, amount ${f.disputedAmount} ${f.currency}\n` +
            `Buyer said: ${f.buyerMessages.join(" | ") || "(nothing)"}\n` +
            `PayPal currently allows: ${f.allowedActions.join(", ") || "nothing"}\n` +
            `Order found: ${f.orderFound}; capture status: ${f.captureStatus ?? "unknown"}\n` +
            `Delivered at: ${f.deliveredAt ?? "no record"}; buyer downloads: ${f.downloads}; last download: ${f.lastDownloadAt ?? "never"}\n` +
            `Already refunded: ${f.refundedAlready}; earlier support cases from this buyer: ${f.priorCases}`,
        },
      ]);
  } else {
    r = rulesAssess(f);
  }
  return {
    action: r.action,
    amount: round2(r.amount),
    winChance: Math.max(0, Math.min(1, r.winChance)),
    reasoning: r.reasoning,
    steps: [
      {
        name: state.useLlm ? "AI recommended a response" : "Rules recommended a response",
        detail: `${human(r.action)}${r.amount > 0 ? ` (${round2(r.amount)} ${f.currency})` : ""}, ~${Math.round(r.winChance * 100)}% chance to win if contested`,
      },
    ],
  };
}

// ── 3. policyGuard ─────────────────────────────────────────────────────

export function applyDisputePolicy(
  f: DisputeFacts,
  p: { action: DisputeAction; amount: number }
): { action: DisputeAction; amount: number; notes: string[] } {
  let { action, amount } = p;
  const notes: string[] = [];
  const allows = (rel: string) => f.allowedActions.includes(rel);

  if (f.status === "RESOLVED") {
    return { action: "NONE", amount: 0, notes: ["This dispute is already resolved. Nothing to send."] };
  }
  if (action === "CONTEST" && f.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && f.downloads === 0) {
    notes.push("Can't contest a 'not received' claim without proof the buyer downloaded it. Switched to accepting the claim.");
    action = "ACCEPT_CLAIM";
  }
  if (action === "MAKE_OFFER" && !allows("make_offer")) {
    notes.push(`PayPal doesn't allow offers at the ${human(f.stage)} stage. Switched to ${allows("provide_evidence") && f.downloads > 0 ? "contesting" : "accepting the claim"}.`);
    action = allows("provide_evidence") && f.downloads > 0 ? "CONTEST" : "ACCEPT_CLAIM";
  }
  if (action === "CONTEST" && !allows("provide_evidence")) {
    notes.push("PayPal isn't accepting evidence on this dispute right now.");
    action = allows("accept_claim") ? "ACCEPT_CLAIM" : "NONE";
  }
  if (action === "ACCEPT_CLAIM" && !allows("accept_claim")) {
    notes.push("PayPal doesn't allow accepting this claim right now. Nothing to send yet.");
    action = "NONE";
  }

  if (action === "ACCEPT_CLAIM") {
    if (Math.abs(amount - f.disputedAmount) > 0.009) notes.push(`Refund set to the disputed amount (${f.disputedAmount}).`);
    amount = f.disputedAmount;
  } else if (action === "MAKE_OFFER") {
    if (amount <= 0 || amount >= f.disputedAmount) {
      const fixed = round2(f.disputedAmount * 0.5);
      notes.push(`Offer must be between 0 and the disputed amount; set to ${fixed}.`);
      amount = fixed;
    }
  } else {
    amount = 0;
  }
  if (notes.length === 0) notes.push("All policy checks passed.");
  return { action, amount: round2(amount), notes };
}

async function policyGuard(state: S): Promise<Partial<S>> {
  const r = applyDisputePolicy(state.facts, { action: state.action, amount: state.amount });
  const changed = r.action !== state.action || Math.abs(r.amount - state.amount) > 0.009;
  return {
    action: r.action,
    amount: r.amount,
    policyNotes: r.notes,
    steps: [
      {
        name: "Policy check",
        detail: changed ? `Adjusted to ${human(r.action)}: ${r.notes.join(" ")}` : "Passed: the response is allowed and supported by the records.",
      },
    ],
  };
}

// ── 4. draftResponse ───────────────────────────────────────────────────

// Evidence comes from records only. The LLM never writes this part.
function buildEvidenceText(state: S): string {
  const o = state.input.order;
  const f = state.facts;
  const lines = [
    "PAYDESK - DISPUTE EVIDENCE (generated from store records)",
    `Dispute: ${f.disputeId}`,
    `Reason claimed: ${human(f.reason)}`,
    "",
  ];
  if (o) {
    lines.push(
      `Order: ${o.orderNumber}`,
      `Items: ${o.items.map((i) => `${i.quantity} x ${i.name} @ ${i.unitPrice} ${o.currency}`).join("; ")}`,
      `Total paid: ${o.total} ${o.currency} (PayPal capture ${o.captureId})`,
      `Paid at: ${o.paidAt?.toISOString() ?? "unknown"}`,
      `Buyer PayPal email: ${o.payerEmail ?? "unknown"}`,
      "",
      "DIGITAL DELIVERY",
      `Download access unlocked: ${o.deliveredAt?.toISOString() ?? "no record"}`,
      `Download link used: ${o.accessCount} time(s)`,
      `Last download: ${o.lastAccessAt?.toISOString() ?? "never"}`,
      `Amount already refunded: ${o.refundedTotal} ${o.currency}`
    );
  } else {
    lines.push("No matching store order was found for this transaction.");
  }
  if (state.input.priorCases.length) {
    lines.push("", "SUPPORT HISTORY");
    for (const c of state.input.priorCases) {
      lines.push(`${c.createdAt.toISOString().slice(0, 10)} ${c.ticketNumber} [${c.status}] ${c.title}`);
    }
  }
  return lines.join("\n");
}

function templateNote(state: S): string {
  const f = state.facts;
  switch (state.action) {
    case "ACCEPT_CLAIM":
      return `We're sorry for the trouble. We accept this claim and are refunding ${state.amount} ${f.currency}.`;
    case "MAKE_OFFER":
      return `We're sorry the product didn't meet your expectations. We'd like to offer a refund of ${state.amount} ${f.currency} to resolve this.`;
    case "CONTEST":
      return (
        `We respectfully contest this dispute. The product was delivered digitally` +
        (f.deliveredAt ? ` on ${f.deliveredAt.slice(0, 10)}` : "") +
        ` and our records show the buyer's download link was used ${f.downloads} time(s)` +
        (f.lastDownloadAt ? `, most recently on ${f.lastDownloadAt.slice(0, 10)}` : "") +
        ". The attached file contains the full order and access record."
      );
    default:
      return "";
  }
}

async function draftResponse(state: S): Promise<Partial<S>> {
  const evidenceText = state.action === "CONTEST" ? buildEvidenceText(state) : "";
  let note = templateNote(state);
  if (state.useLlm && state.action !== "NONE") {
    const res = await model().invoke([
      {
        role: "system",
        content:
          "Write the seller's note for a PayPal dispute (3-5 sentences, professional, polite, factual). It must match the decision. " +
          "For CONTEST, cite only the facts given (delivery date, number of downloads) and mention the attached evidence file. " +
          "For ACCEPT_CLAIM or MAKE_OFFER, state the amount and currency. Never invent facts, tracking numbers or dates. " +
          "No greeting line with a name, no signature, no placeholders.",
      },
      {
        role: "user",
        content:
          `Decision: ${state.action}; amount ${state.amount} ${state.facts.currency}\n` +
          `Dispute reason: ${state.facts.reason}\nBuyer said: ${state.facts.buyerMessages.join(" | ")}\n` +
          `Facts: delivered ${state.facts.deliveredAt ?? "no record"}, downloads ${state.facts.downloads}, last download ${state.facts.lastDownloadAt ?? "never"}\n` +
          `Reasoning: ${state.reasoning}`,
      },
    ]);
    note = String(res.content).trim();
  }
  return {
    responseNote: note,
    evidenceText,
    steps: [
      {
        name: "Drafted response",
        detail: state.action === "CONTEST" ? "Wrote the note to PayPal and built the evidence file from store records." : state.action === "NONE" ? "Nothing to send." : "Wrote the note to the buyer and PayPal.",
      },
    ],
  };
}

const graph = new StateGraph(State)
  .addNode("gatherEvidence", gatherEvidence)
  .addNode("assess", assess)
  .addNode("policyGuard", policyGuard)
  .addNode("draftResponse", draftResponse)
  .addEdge(START, "gatherEvidence")
  .addEdge("gatherEvidence", "assess")
  .addEdge("assess", "policyGuard")
  .addEdge("policyGuard", "draftResponse")
  .addEdge("draftResponse", END)
  .compile();

export async function runDisputeAgent(input: DisputeAgentInput, useLlm: boolean): Promise<DisputeAgentOutput> {
  const s = await graph.invoke({ input, useLlm });
  return {
    facts: s.facts,
    action: s.action,
    amount: s.amount,
    winChance: s.winChance,
    reasoning: s.reasoning,
    policyNotes: s.policyNotes,
    responseNote: s.responseNote,
    evidenceText: s.evidenceText,
    snapshot: s.snapshot,
    source: useLlm ? "groq" : "rules",
    steps: s.steps,
  };
}
