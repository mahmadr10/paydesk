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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = listUsers;
exports.updateUser = updateUser;
exports.runSlaBreachCheck = runSlaBreachCheck;
exports.askDevAssistant = askDevAssistant;
exports.applyDevAssistantFix = applyDevAssistantFix;
exports.listCategories = listCategories;
exports.createCategory = createCategory;
exports.setCategoryActive = setCategoryActive;
exports.listSlaPolicies = listSlaPolicies;
exports.upsertSlaPolicy = upsertSlaPolicy;
const adminService = __importStar(require("../services/adminService"));
const devAssistantService = __importStar(require("../services/devAssistantService"));
const slaBreachJob_1 = require("../jobs/slaBreachJob");
async function listUsers(req, res) {
    const { role, page, limit } = req.query;
    const result = await adminService.listUsers(role, page, limit);
    res.status(200).json({ success: true, data: result });
}
async function updateUser(req, res) {
    const user = await adminService.updateUser(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: { user } });
}
// Manual trigger for the SLA breach background job - the job itself runs
// on a 1-minute cron in production (see jobs/slaBreachJob.ts), but nobody
// demoing this should have to sit and wait for the clock; this runs the
// EXACT same function the cron calls, on demand.
async function runSlaBreachCheck(_req, res) {
    const result = await (0, slaBreachJob_1.checkSlaBreaches)();
    res.status(200).json({ success: true, data: result });
}
async function askDevAssistant(req, res) {
    const result = await devAssistantService.askDevAssistant(req.body.question, req.user);
    res.status(200).json({ success: true, data: result });
}
async function applyDevAssistantFix(req, res) {
    const result = await devAssistantService.applyDevAssistantFix(req.body, req.user);
    res.status(200).json({ success: true, data: result });
}
async function listCategories(_req, res) {
    const categories = await adminService.listCategories();
    res.status(200).json({ success: true, data: { categories } });
}
async function createCategory(req, res) {
    const category = await adminService.createCategory(req.body.name, req.body.description, req.user);
    res.status(201).json({ success: true, data: { category } });
}
async function setCategoryActive(req, res) {
    const category = await adminService.setCategoryActive(req.params.id, req.body.isActive, req.user);
    res.status(200).json({ success: true, data: { category } });
}
async function listSlaPolicies(_req, res) {
    const policies = await adminService.listSlaPolicies();
    res.status(200).json({ success: true, data: { policies } });
}
async function upsertSlaPolicy(req, res) {
    const policy = await adminService.upsertSlaPolicy(req.params.priority, req.body.responseMinutes, req.body.resolutionMinutes, req.user);
    res.status(200).json({ success: true, data: { policy } });
}
