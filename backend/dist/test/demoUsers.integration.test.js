"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const mongoose_1 = __importDefault(require("mongoose"));
const app_1 = require("../app");
const db_1 = require("../config/db");
const seed_1 = require("../config/seed");
const demoUsers_1 = require("../config/demoUsers");
// The login page's one-click demo buttons depend on these accounts existing
// and accepting the shared demo password.
const app = (0, app_1.createApp)();
(0, vitest_1.beforeAll)(async () => {
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
});
(0, vitest_1.afterAll)(async () => {
    await mongoose_1.default.connection.dropDatabase();
    await mongoose_1.default.disconnect();
});
(0, vitest_1.describe)("Demo accounts", () => {
    (0, vitest_1.it)("are created once and can all log in with the demo password", async () => {
        (0, vitest_1.expect)(await (0, demoUsers_1.seedDemoUsers)()).toBe(demoUsers_1.DEMO_USERS.length);
        (0, vitest_1.expect)(await (0, demoUsers_1.seedDemoUsers)()).toBe(0); // second run changes nothing
        for (const u of demoUsers_1.DEMO_USERS) {
            const res = await (0, supertest_1.default)(app).post("/api/v1/auth/login").send({ email: u.email, password: demoUsers_1.DEMO_PASSWORD });
            (0, vitest_1.expect)(res.status).toBe(200);
            (0, vitest_1.expect)(res.body.data.user.role).toBe(u.role);
        }
    });
    (0, vitest_1.it)("do not accept a wrong password", async () => {
        const res = await (0, supertest_1.default)(app).post("/api/v1/auth/login").send({ email: demoUsers_1.DEMO_USERS[0].email, password: "WrongPass123!" });
        (0, vitest_1.expect)(res.status).toBe(401);
    });
});
