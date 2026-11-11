import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app";
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";
import { DEMO_PASSWORD, DEMO_USERS, seedDemoUsers } from "../config/demoUsers";

// The login page's one-click demo buttons depend on these accounts existing
// and accepting the shared demo password.
const app = createApp();

beforeAll(async () => {
  await connectDB();
  await seedDefaults();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Demo accounts", () => {
  it("are created once and can all log in with the demo password", async () => {
    expect(await seedDemoUsers()).toBe(DEMO_USERS.length);
    expect(await seedDemoUsers()).toBe(0); // second run changes nothing

    for (const u of DEMO_USERS) {
      const res = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe(u.role);
    }
  });

  it("do not accept a wrong password", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: DEMO_USERS[0].email, password: "WrongPass123!" });
    expect(res.status).toBe(401);
  });
});
