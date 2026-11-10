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
exports.getConfig = getConfig;
exports.getCatalog = getCatalog;
exports.createOrder = createOrder;
exports.captureOrder = captureOrder;
exports.listOrders = listOrders;
exports.getOrder = getOrder;
exports.refundStats = refundStats;
const orderService = __importStar(require("../services/orderService"));
const refundStatsService_1 = require("../services/refundStatsService");
async function getConfig(_req, res) {
    res.json({ success: true, data: orderService.getPaymentsConfig() });
}
async function getCatalog(_req, res) {
    res.json({ success: true, data: { products: orderService.getCatalog() } });
}
async function createOrder(req, res) {
    const order = await orderService.createOrder(req.user.userId, req.body.items);
    res.status(201).json({ success: true, data: { order } });
}
async function captureOrder(req, res) {
    const order = await orderService.captureOrder(req.params.id, req.user);
    res.json({ success: true, data: { order } });
}
async function listOrders(req, res) {
    const orders = await orderService.listOrders(req.user, req.query.paid === "true");
    res.json({ success: true, data: { orders } });
}
async function getOrder(req, res) {
    const order = await orderService.getOrder(req.params.id, req.user);
    res.json({ success: true, data: { order } });
}
async function refundStats(_req, res) {
    res.json({ success: true, data: await (0, refundStatsService_1.getRefundStats)() });
}
