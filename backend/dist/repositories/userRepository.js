"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.findUserById = findUserById;
exports.createUser = createUser;
exports.findUsers = findUsers;
exports.countUsers = countUsers;
exports.updateUser = updateUser;
exports.findActiveAdminIds = findActiveAdminIds;
const User_1 = require("../models/User");
// A repository's ONLY job is talking to the database for one collection -
// no business rules, no auth checks, no HTTP knowledge. Why add this layer
// on top of Mongoose (which is already a nice API)? Two reasons: (1) it's
// the seam a unit test can mock out to test a service's LOGIC without a
// real database, and (2) if we ever swapped MongoDB for something else,
// only this file would need to change - services wouldn't know the
// difference.
function findUserByEmail(email) {
    return User_1.User.findOne({ email });
}
function findUserById(id) {
    return User_1.User.findById(id);
}
function createUser(data) {
    return User_1.User.create(data);
}
function findUsers(filter, skip, limit) {
    return User_1.User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
}
function countUsers(filter) {
    return User_1.User.countDocuments(filter);
}
function updateUser(id, updates) {
    return User_1.User.findByIdAndUpdate(id, updates, { returnDocument: "after" });
}
// Used by jobs/slaBreachJob.ts: an UNASSIGNED ticket breaching its SLA has
// no specific agent to notify, so every active admin gets it instead - an
// unassigned-and-overdue ticket is a triage/staffing problem, not one
// agent's problem.
function findActiveAdminIds() {
    return User_1.User.find({ role: "ADMIN", isActive: true }).select("_id").then((users) => users.map((u) => u._id.toString()));
}
