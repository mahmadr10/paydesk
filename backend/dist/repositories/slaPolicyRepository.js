"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPolicyForPriority = findPolicyForPriority;
exports.listPolicies = listPolicies;
exports.upsertPolicy = upsertPolicy;
const SLAPolicy_1 = require("../models/SLAPolicy");
function findPolicyForPriority(priority) {
    return SLAPolicy_1.SLAPolicy.findOne({ priority });
}
function listPolicies() {
    return SLAPolicy_1.SLAPolicy.find().sort({ priority: 1 });
}
function upsertPolicy(priority, responseMinutes, resolutionMinutes) {
    return SLAPolicy_1.SLAPolicy.findOneAndUpdate({ priority }, { responseMinutes, resolutionMinutes }, { upsert: true, returnDocument: "after" });
}
