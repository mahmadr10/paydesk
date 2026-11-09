// Records the PayDesk demo video (silent, with on-screen captions).
//
// Needs the backend (http://localhost:4000) and frontend (http://localhost:5173)
// running. Uses Playwright from ../e2e/node_modules.
//
//   cd e2e && npm ci            (once)
//   node ../demo/record-demo.mjs
//
// Output: demo/paydesk-demo.webm (upload to YouTube as is) + demo/thumbnail.png
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../e2e/package.json"));
const { chromium } = require("@playwright/test");

const APP = "http://localhost:5173";
const API = "http://localhost:4000/api/v1";
const PASSWORD = "DemoPass123!";
const run = Date.now().toString(36);
const buyer = { name: "Ali Buyer", email: `ali-${run}@demo.paydesk`, role: "CUSTOMER" };
const seller = { name: "Sara (Pixel & Co.)", email: `sara-${run}@demo.paydesk`, role: "AGENT" };
const W = 1280;
const H = 720;

async function api(p, opts = {}) {
  const res = await fetch(API + p, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${p}: ${JSON.stringify(json)}`);
  return json.data;
}

// Setup (not recorded): accounts + an earlier UI kit purchase, so the
// buyer's later "charged twice" complaint has a matching first charge.
for (const u of [buyer, seller]) {
  await api("/auth/register", { method: "POST", body: JSON.stringify({ ...u, password: PASSWORD }) });
}
{
  const { accessToken } = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: buyer.email, password: PASSWORD }) });
  const h = { Authorization: `Bearer ${accessToken}` };
  for (let i = 0; i < 2; i++) {
    const { order } = await api("/payments/orders", { method: "POST", headers: h, body: JSON.stringify({ items: [{ sku: "UI-KIT", quantity: 1 }] }) });
    await api(`/payments/orders/${order._id}/capture`, { method: "POST", headers: h });
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: path.join(here, "raw"), size: { width: W, height: H } },
});

// Caption bar that survives page reloads (kept in sessionStorage).
await context.addInitScript(() => {
  const draw = () => {
    const text = sessionStorage.getItem("cap");
    if (!text || !document.body) return;
    let el = document.getElementById("demo-cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1100px;z-index:99999;" +
        "background:rgba(15,23,42,.92);color:#fff;font:600 21px/1.35 system-ui,Segoe UI,sans-serif;" +
        "padding:12px 22px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);text-align:center;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = text;
  };
  window.addEventListener("DOMContentLoaded", draw);
  window.__drawCap = draw;
});

const page = await context.newPage();
const sleep = (ms) => page.waitForTimeout(ms);

async function caption(text) {
  await page.evaluate((t) => {
    sessionStorage.setItem("cap", t);
    window.__drawCap?.();
  }, text).catch(() => {});
}

// Each scene shows its caption, does its clicks, then stays on screen long
// enough to read the caption (about 14 characters per second + 2.5 s).
async function scene(text, fn, minMs = 0) {
  const start = Date.now();
  await caption(text);
  await fn();
  await caption(text);
  const readMs = Math.max(minMs, (text.length / 14) * 1000 + 2500);
  const left = readMs - (Date.now() - start);
  if (left > 0) await sleep(left);
}

async function smoothScrollTo(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(900);
}

async function login(u) {
  await page.goto(`${APP}/login`);
  await page.getByPlaceholder("Email").pressSequentially(u.email, { delay: 15 });
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${APP}/`);
  await sleep(800);
}

async function logout() {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/);
}

function card(title, lines, foot) {
  return `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#312e81,#1d4ed8 55%,#0ea5e9);font-family:system-ui,Segoe UI,sans-serif;color:#fff">
    <div style="max-width:980px;padding:40px">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px">
        <div style="background:#fff;color:#1d4ed8;font-weight:800;font-size:34px;border-radius:14px;padding:6px 18px">P</div>
        <div style="font-size:40px;font-weight:800">PayDesk</div>
      </div>
      <div style="font-size:46px;font-weight:800;line-height:1.15;margin-bottom:26px">${title}</div>
      ${lines.map((l) => `<div style="font-size:24px;opacity:.95;margin:10px 0">${l}</div>`).join("")}
      <div style="margin-top:30px;font-size:18px;opacity:.8">${foot}</div>
    </div></body></html>`;
}

// ── Scenes ────────────────────────────────────────────────────────────

await page.setContent(
  card(
    "AI co-pilot for PayPal disputes &amp; refunds",
    [
      "Small sellers lose money on PayPal disputes: late answers, no evidence, refunding when they would have won.",
      "PayDesk's AI agents investigate every case with real PayPal data and prepare the answer.",
      "<b>AI prepares. A human approves.</b> No money moves without a click.",
    ],
    "PayPal Server SDK · Disputes API · Webhooks · Agent Toolkit · LangGraph + Groq"
  )
);
await sleep(9000);

let disputeCaseUrl = "";
let refundCaseUrl = "";

await scene("1. A buyer pays for an online course with PayPal, then downloads it. PayDesk logs the download as delivery proof.", async () => {
  await login(buyer);
  await page.goto(`${APP}/shop`);
  await sleep(1500);
  await page.getByRole("button", { name: /Pay with PayPal/ }).nth(2).click();
  await page.getByText(/Paid \$79\.00/).waitFor();
  await sleep(1200);
  await page.goto(`${APP}/orders`);
  await sleep(1200);
  await page.getByRole("button", { name: /Download/ }).first().click();
  await sleep(1200);
});

await scene("2. Later, the buyer opens a PayPal dispute: \"I never received the course.\"", async () => {
  await page.getByRole("button", { name: "Open PayPal dispute" }).first().click();
  await sleep(600);
  await page.getByPlaceholder("Tell PayPal what happened").pressSequentially("I paid for the AI agents course but never received access to it.", { delay: 22 });
  await sleep(500);
  await page.getByRole("button", { name: "File dispute" }).click();
  await page.getByText(/Dispute filed/).waitFor();
});

await scene("3. Seller side: a PayPal webhook opened a case with PayPal's real deadline, and the dispute agent already has a recommendation.", async () => {
  await logout();
  await login(seller);
  await page.getByText(/needs approval/).first().waitFor({ timeout: 60000 });
  await sleep(1500);
});

await scene("4. The agent read the dispute (Disputes API), checked the payment (PayPal Server SDK) and found the buyer downloaded the course.", async () => {
  await page.getByRole("link", { name: /not received/ }).first().click();
  await page.getByRole("heading", { name: /Dispute agent/ }).waitFor();
  disputeCaseUrl = page.url();
  await smoothScrollTo(page.getByRole("heading", { name: /Dispute agent/ }));
  await sleep(1500);
}, 9000);

await scene("Recommendation: contest, with a win estimate, a drafted note, and an evidence file built from records by code (never written by AI).", async () => {
  await page.getByRole("button", { name: /evidence file/ }).click();
  await sleep(600);
  await smoothScrollTo(page.locator("pre").first());
  await sleep(2500);
});

await scene("5. The seller approves. PayDesk sends the evidence to PayPal and the dispute moves to review. In the sandbox, PayPal rules for the seller.", async () => {
  await smoothScrollTo(page.getByRole("button", { name: /^Approve:/ }));
  await page.getByRole("button", { name: /^Approve:/ }).click();
  await page.getByText(/Sent to PayPal/).waitFor({ timeout: 30000 });
  await smoothScrollTo(page.getByText(/under review/).first());
  await sleep(1500);
  await page.getByRole("button", { name: "Seller wins" }).click();
  await page.getByText(/Outcome:/).waitFor();
  await sleep(1000);
});

await scene("6. A refund request in plain words. The AI finds the right PayPal payment and opens a linked case.", async () => {
  await logout();
  await login(buyer);
  const box = page.getByPlaceholder(/charged twice/);
  await box.pressSequentially("Hi, PayPal charged me twice for the Dashboard UI Kit. Please refund the extra one.", { delay: 22 });
  await page.getByRole("button", { name: "Get help" }).click();
  await page.waitForURL(/\/tickets\/[a-f0-9]{24}/, { timeout: 60000 });
  refundCaseUrl = page.url();
  await sleep(2000);
});

await scene("7. The refund agent checks the payment live, finds the duplicate charge, and proposes a full refund. Policy rules in code check window, amount and abuse.", async () => {
  await logout();
  await login(seller);
  await page.goto(refundCaseUrl);
  await page.getByRole("button", { name: /Approve & refund/ }).waitFor({ timeout: 60000 });
  await smoothScrollTo(page.getByRole("heading", { name: /Refund agent/ }));
  await sleep(2500);
}, 9000);

await scene("One click: PayPal issues the refund, and the reply goes to the buyer.", async () => {
  await page.getByRole("button", { name: /Approve & refund/ }).click();
  await page.getByText(/Refunded \$49\.00 through PayPal/).waitFor({ timeout: 30000 });
  await sleep(1500);
});

await scene("8. \"Ask PayPal\": a chat over the seller's PayPal account, built on PayPal's Agent Toolkit. Read-only, so it can never move money.", async () => {
  await page.goto(`${APP}/assistant`);
  await page.getByRole("button", { name: /Which disputes need my attention/ }).click();
  await page.getByText(/PayPal tools used/).waitFor({ timeout: 60000 });
  await sleep(2000);
});

await scene("Seller co-pilot: revenue, disputes, approvals and the live PayPal event feed.", async () => {
  await page.goto(`${APP}/`);
  await sleep(2500);
});

await page.evaluate(() => sessionStorage.removeItem("cap")).catch(() => {});
await page.setContent(
  card(
    "AI prepares. A human approves.",
    [
      "PayPal: JS SDK checkout · Server SDK (orders, captures, refunds) · Disputes API · verified webhooks · Agent Toolkit",
      "AI: LangGraph agents on Groq + a policy guard in code + atomic approval (no double refunds)",
      "Built with APIMatic's Context Plugin for PayPal · 70 automated tests · MIT licensed",
    ],
    "github.com/mahmadr10/paydesk"
  )
);
await sleep(8000);

const video = page.video();
await context.close();
const out = path.join(here, "paydesk-demo.webm");
await video.saveAs(out);
await video.delete();

// Thumbnail (3:2) for Devpost.
const tctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const tp = await tctx.newPage();
await tp.setContent(
  card(
    "AI co-pilot for PayPal disputes &amp; refunds",
    ["AI agents investigate with real PayPal data.", "<b>AI prepares. A human approves.</b>"],
    "PayPal Server SDK · Disputes API · Webhooks · Agent Toolkit"
  )
);
await tp.screenshot({ path: path.join(here, "thumbnail.png") });
await browser.close();
fs.rmSync(path.join(here, "raw"), { recursive: true, force: true });
console.log("Saved", out, "| dispute case", disputeCaseUrl);
