"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SLA_POLICIES = exports.SLAPolicy = void 0;
const mongoose_1 = require("mongoose");
const slaPolicySchema = new mongoose_1.Schema({
    priority: { type: String, required: true, unique: true },
    responseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
});
exports.SLAPolicy = (0, mongoose_1.model)("SLAPolicy", slaPolicySchema);
// Seeded defaults (minutes) if the collection is empty - see config/seed.ts.
// CRITICAL: 15 min response / 4h resolution · HIGH: 1h / 8h ·
// MEDIUM: 4h / 24h · LOW: 8h / 72h.
exports.DEFAULT_SLA_POLICIES = {
    CRITICAL: { responseMinutes: 15, resolutionMinutes: 4 * 60 },
    HIGH: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
    MEDIUM: { responseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
    LOW: { responseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
};
