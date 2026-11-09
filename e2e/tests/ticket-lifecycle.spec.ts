import { test, expect, type Page } from "@playwright/test";

// One end-to-end run through the whole point of the app:
//
//   Customer logs in (registers) → creates a ticket
//     → Agent logs in (registers) → triages → assigns to self
//     → moves it through IN_PROGRESS → RESOLVED
//     → Customer closes the resolved ticket
//
// Each step happens in a REAL browser tab, against the REAL running
// frontend + backend - this is what actually proves the pieces work
// together (routing, forms, API calls, the state machine's role checks),
// not just that each piece works in isolation.
const stamp = Date.now();
const customerEmail = `e2e-customer-${stamp}@test.local`;
const agentEmail = `e2e-agent-${stamp}@test.local`;
const password = "TestPass123!";
const ticketTitle = `E2E payment API failure ${stamp}`;

async function register(page: Page, name: string, email: string, role: "CUSTOMER" | "AGENT") {
  await page.goto("/register");
  await page.getByPlaceholder("Name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill(password);
  await page.locator("select").selectOption(role);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL("/");
}

test.describe.serial("Full ticket lifecycle", () => {
  test("customer registers and creates a ticket", async ({ page }) => {
    await register(page, "E2E Customer", customerEmail, "CUSTOMER");

    // PayDesk: buyers mostly use smart intake; the manual form is still at /tickets/new.
    await page.goto("/tickets/new");

    await page.getByPlaceholder("Title").fill(ticketTitle);
    await page.getByPlaceholder("Describe the issue…").fill("Our payment API is returning HTTP 500 errors.");
    // Category options are seeded server-side (config/seed.ts) - "Payment" is one of the defaults.
    await page.locator("select").first().selectOption("Payment");
    await page.getByRole("button", { name: "Create ticket" }).click();

    // Successful creation navigates to the new ticket's detail page.
    await expect(page).toHaveURL(/\/tickets\/[a-f0-9]{24}/);
    await expect(page.getByRole("heading", { name: ticketTitle })).toBeVisible();
    await expect(page.getByText("OPEN")).toBeVisible();
  });

  test("agent triages, assigns, progresses, and resolves the ticket", async ({ page }) => {
    await register(page, "E2E Agent", agentEmail, "AGENT");
    // Sellers land on the co-pilot; the full case list is at /queue.
    await expect(page.getByRole("heading", { name: "Seller co-pilot" })).toBeVisible();
    await page.getByRole("link", { name: "All cases" }).click();
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();

    // Find the ticket the customer just created by its unique title.
    await page.getByPlaceholder("Search title…").fill(ticketTitle);
    await page.getByRole("link", { name: ticketTitle }).click();
    await expect(page).toHaveURL(/\/tickets\/[a-f0-9]{24}/);

    // OPEN -> TRIAGED (the only legal next step - the button text comes
    // straight from the server's allowedNextStatuses, proving the state
    // machine and the UI agree on what's legal).
    await page.getByRole("button", { name: /Move to TRIAGED/i }).click();
    await expect(page.getByText("TRIAGED")).toBeVisible();

    // TRIAGED -> ASSIGNED, via "Assign to me".
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByText("ASSIGNED")).toBeVisible();

    // ASSIGNED -> IN_PROGRESS -> RESOLVED.
    await page.getByRole("button", { name: /Move to IN PROGRESS/i }).click();
    await expect(page.getByText("IN PROGRESS")).toBeVisible();

    await page.getByRole("button", { name: /Move to RESOLVED/i }).click();
    await expect(page.getByText("RESOLVED")).toBeVisible();
  });

  test("customer sees the resolution and closes the ticket", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(customerEmail);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("link", { name: "My cases" }).click();
    await page.getByRole("link", { name: ticketTitle }).click();
    await expect(page.getByText("RESOLVED")).toBeVisible();

    // This is the customer-only transition (RESOLVED -> CLOSED) - proving
    // the role rule the other direction: a customer CAN do this one.
    await page.getByRole("button", { name: "Close ticket" }).click();
    await expect(page.getByText("CLOSED")).toBeVisible();
  });

  test("an illegal transition is rejected with a clear error, not silently allowed", async ({ page, request }) => {
    // Log in as the agent via the API directly (faster than the UI for a
    // setup step that isn't the thing being tested) to get a fresh ticket,
    // then attempt to skip straight from OPEN to RESOLVED.
    const loginRes = await request.post("http://localhost:4001/api/v1/auth/login", {
      data: { email: agentEmail, password },
    });
    const { accessToken } = (await loginRes.json()).data;

    const createRes = await request.post("http://localhost:4001/api/v1/auth/register", {
      data: { name: "Skip Test Customer", email: `e2e-skip-${stamp}@test.local`, password, role: "CUSTOMER" },
    });
    const customerToken = (await createRes.json()).data.accessToken;

    const ticketRes = await request.post("http://localhost:4001/api/v1/tickets", {
      headers: { Authorization: `Bearer ${customerToken}` },
      data: { title: "Skip test ticket", description: "Should not allow skipping to RESOLVED", category: "Other", priority: "LOW", tags: [] },
    });
    const ticketId = (await ticketRes.json()).data.ticket._id;

    const skipRes = await request.patch(`http://localhost:4001/api/v1/tickets/${ticketId}/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { status: "RESOLVED" },
    });
    expect(skipRes.status()).toBe(400);
    const body = await skipRes.json();
    expect(body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});
