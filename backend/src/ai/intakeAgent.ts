import { z } from "zod";
import { ChatGroq } from "@langchain/groq";
import { env } from "../config/env";
import { TICKET_PRIORITIES, TicketPriority } from "../models/Ticket";

// Smart intake: the customer writes one free-text message ("I got charged
// twice for the UI kit") and this turns it into a proper ticket: which of
// their PayPal orders it's about, a short title, category and priority.
// Uses Groq when a key is set, otherwise simple matching rules.

export interface IntakeOrder {
  id: string;
  orderNumber: string;
  itemNames: string[];
  total: number;
  currency: string;
  paidAt: Date | null;
}

export interface IntakeResult {
  orderId: string | null;
  title: string;
  category: string;
  priority: TicketPriority;
  matchReason: string;
  source: "groq" | "rules";
}

const intakeSchema = z.object({
  orderNumber: z.string().describe("The order number this is about, copied exactly from the list, or the string NONE."),
  title: z.string().describe("A short ticket title, max 80 characters."),
  category: z.string().describe("One category, copied exactly from the list."),
  priority: z.enum(TICKET_PRIORITIES),
  matchReason: z.string().describe("One short sentence: why this order was picked."),
});

function rulesIntake(message: string, orders: IntakeOrder[], categories: string[]): IntakeResult {
  const text = message.toLowerCase();
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

  // Score each order by how many words of its product names appear in the message.
  let best: IntakeOrder | null = null;
  let bestScore = 0;
  for (const o of orders) {
    const score = o.itemNames.flatMap(words).filter((w) => text.includes(w)).length;
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  const explicit = orders.find((o) => text.includes(o.orderNumber.toLowerCase()));
  const chosen = explicit ?? best ?? orders[0] ?? null;
  const reason = explicit
    ? `The message mentions ${explicit.orderNumber}.`
    : best
      ? `The message mentions "${best.itemNames.join(", ")}".`
      : chosen
        ? "No product was named, so the most recent order was picked."
        : "No paid orders found.";

  const isMoney = /(charge|refund|paid|payment|money|twice|double|billing)/.test(text);
  const category =
    categories.find((c) => c.toLowerCase() === (isMoney ? "payment" : "technical")) ?? categories[0] ?? "Other";
  const priority: TicketPriority = /(twice|double|duplicate|fraud|unauthori[sz]ed)/.test(text)
    ? "HIGH"
    : isMoney
      ? "MEDIUM"
      : "LOW";

  const firstSentence = message.split(/[.!?\n]/)[0].trim();
  const title = firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence || "Payment issue";

  return { orderId: chosen?.id ?? null, title, category, priority, matchReason: reason, source: "rules" };
}

export async function runIntake(message: string, orders: IntakeOrder[], categories: string[]): Promise<IntakeResult> {
  const useLlm = env.AI_ENABLED === "true" && !!env.GROQ_API_KEY;
  if (!useLlm) return rulesIntake(message, orders, categories);

  try {
    const model = new ChatGroq({ apiKey: env.GROQ_API_KEY, model: env.AI_MODEL, temperature: 0 }).withStructuredOutput(
      intakeSchema
    );
    const orderList = orders
      .map(
        (o) =>
          `${o.orderNumber}: ${o.itemNames.join(", ")} — ${o.total} ${o.currency}, paid ${o.paidAt?.toISOString().slice(0, 10) ?? "?"}`
      )
      .join("\n");
    const r = await model.invoke([
      {
        role: "system",
        content:
          "You turn a customer's support message into a ticket for an online store. Pick the ONE order it is about from the " +
          "customer's order list (use product names, amounts, dates; if they say they were charged twice, pick the most recent " +
          "matching order). If none fits, answer NONE. Priority: HIGH for double charges or possible fraud, MEDIUM for other " +
          "payment or delivery problems, LOW for questions.",
      },
      {
        role: "user",
        content: `Categories: ${categories.join(", ")}\n\nCustomer's orders:\n${orderList || "(none)"}\n\nMessage:\n${message}`,
      },
    ]);
    const order = orders.find((o) => o.orderNumber === r.orderNumber.trim()) ?? null;
    return {
      orderId: order?.id ?? null,
      title: r.title.slice(0, 150),
      category: categories.includes(r.category) ? r.category : (categories.find((c) => c === "Payment") ?? categories[0]),
      priority: r.priority,
      matchReason: r.matchReason,
      source: "groq",
    };
  } catch {
    return rulesIntake(message, orders, categories);
  }
}
