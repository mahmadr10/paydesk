"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookEvent = void 0;
const mongoose_1 = require("mongoose");
const webhookEventSchema = new mongoose_1.Schema({
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    resourceId: { type: String, default: null },
    verified: { type: Boolean, default: false },
    source: { type: String, enum: ["paypal", "simulated"], required: true },
    result: { type: String, default: "" },
    receivedAt: { type: Date, default: Date.now, index: true },
});
exports.WebhookEvent = (0, mongoose_1.model)("WebhookEvent", webhookEventSchema);
