"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = void 0;
exports.nextSequence = nextSequence;
const mongoose_1 = require("mongoose");
const counterSchema = new mongoose_1.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
});
exports.Counter = (0, mongoose_1.model)("Counter", counterSchema);
async function nextSequence(name) {
    const counter = await exports.Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    return counter.seq;
}
