"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createComment = createComment;
exports.findCommentsForTicket = findCommentsForTicket;
exports.findFirstAgentComment = findFirstAgentComment;
const Comment_1 = require("../models/Comment");
function createComment(data) {
    return Comment_1.Comment.create(data);
}
// includeInternal is false for a customer's view - internal notes never
// even reach the query result, rather than being filtered out afterwards.
function findCommentsForTicket(ticketId, includeInternal) {
    const query = { ticket: ticketId };
    if (!includeInternal)
        query.isInternal = false;
    return Comment_1.Comment.find(query).sort({ createdAt: 1 }).populate("author", "name email");
}
function findFirstAgentComment(ticketId) {
    return Comment_1.Comment.findOne({ ticket: ticketId, authorRole: { $in: ["AGENT", "ADMIN"] } }).sort({ createdAt: 1 });
}
