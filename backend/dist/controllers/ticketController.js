"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTicket = createTicket;
exports.smartIntake = smartIntake;
exports.runRefundAgent = runRefundAgent;
exports.approveRefundProposal = approveRefundProposal;
exports.rejectRefundProposal = rejectRefundProposal;
exports.listTickets = listTickets;
exports.getTicket = getTicket;
exports.updateStatus = updateStatus;
exports.assignToSelf = assignToSelf;
exports.reassign = reassign;
exports.updatePriority = updatePriority;
exports.updateTags = updateTags;
exports.uploadAttachment = uploadAttachment;
exports.analyzeWithAi = analyzeWithAi;
exports.downloadAttachment = downloadAttachment;
const path_1 = __importDefault(require("path"));
const ticketService = __importStar(require("../services/ticketService"));
const refundService = __importStar(require("../services/refundService"));
const intakeService = __importStar(require("../services/intakeService"));
const AppError_1 = require("../utils/AppError");
const upload_1 = require("../middleware/upload");
async function createTicket(req, res) {
    const ticket = await ticketService.createTicket(req.user.userId, req.body);
    // Ticket about a PayPal order: start the refund agent right away.
    if (ticket.order)
        refundService.runAgentInBackground(String(ticket._id));
    res.status(201).json({ success: true, data: { ticket } });
}
async function smartIntake(req, res) {
    const result = await intakeService.smartIntake(req.user.userId, req.body.message);
    res.status(201).json({ success: true, data: result });
}
async function runRefundAgent(req, res) {
    await refundService.runAgent(req.params.id, req.user);
    const ticket = await ticketService.getTicketById(req.params.id, req.user);
    res.json({ success: true, data: { ticket } });
}
async function approveRefundProposal(req, res) {
    const ticket = await refundService.approveProposal(req.params.id, req.user, req.body);
    res.json({ success: true, data: { ticket } });
}
async function rejectRefundProposal(req, res) {
    const ticket = await refundService.rejectProposal(req.params.id, req.user, req.body.note);
    res.json({ success: true, data: { ticket } });
}
async function listTickets(req, res) {
    const result = await ticketService.listTickets(req.user, req.query);
    res.status(200).json({ success: true, data: result });
}
async function getTicket(req, res) {
    const ticket = await ticketService.getTicketById(req.params.id, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function updateStatus(req, res) {
    const ticket = await ticketService.updateTicketStatus(req.params.id, req.body.status, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function assignToSelf(req, res) {
    const ticket = await ticketService.assignTicketToSelf(req.params.id, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function reassign(req, res) {
    const ticket = await ticketService.reassignTicket(req.params.id, req.body.agentId, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function updatePriority(req, res) {
    const ticket = await ticketService.updatePriority(req.params.id, req.body.priority, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function updateTags(req, res) {
    const ticket = await ticketService.updateTags(req.params.id, req.body.tags, req.user);
    res.status(200).json({ success: true, data: { ticket } });
}
async function uploadAttachment(req, res) {
    if (!req.file) {
        throw new AppError_1.AppError(400, "VALIDATION_ERROR", "No file was uploaded.");
    }
    const ticket = await ticketService.addAttachment(req.params.id, req.user, {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
    });
    res.status(201).json({ success: true, data: { ticket } });
}
async function analyzeWithAi(req, res) {
    const analysis = await ticketService.getAiAnalysis(req.params.id, req.user);
    res.status(200).json({ success: true, data: { analysis } });
}
async function downloadAttachment(req, res) {
    const ticket = await ticketService.getTicketDocForDownload(req.params.id, req.user);
    const attachment = ticket.attachments.find((a) => a._id?.toString() === req.params.attachmentId);
    if (!attachment) {
        throw new AppError_1.AppError(404, "NOT_FOUND", "Attachment not found.");
    }
    // We check authorization (assertCanView, above) and look up the ON-DISK
    // filename ourselves from the ticket document - we never let the request
    // supply a raw file path, which is what prevents path-traversal attacks
    // against this endpoint.
    const filePath = path_1.default.join(upload_1.UPLOAD_DIR, attachment.filename);
    res.download(filePath, attachment.originalName);
}
