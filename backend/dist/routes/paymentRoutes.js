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
const express_1 = require("express");
const paymentController = __importStar(require("../controllers/paymentController"));
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const ticketValidators_1 = require("../validators/ticketValidators");
const paymentValidators_1 = require("../validators/paymentValidators");
const router = (0, express_1.Router)();
// Public: the PayPal client id is meant to be public (it's in the SDK script tag).
router.get("/config", paymentController.getConfig);
router.get("/catalog", paymentController.getCatalog);
router.use(auth_1.requireAuth);
router.get("/stats", (0, auth_1.requireRole)("AGENT", "ADMIN"), paymentController.refundStats);
router.get("/orders", (0, validate_1.validate)(paymentValidators_1.listOrdersQuerySchema, "query"), paymentController.listOrders);
router.post("/orders", (0, auth_1.requireRole)("CUSTOMER"), (0, validate_1.validate)(paymentValidators_1.createOrderSchema), paymentController.createOrder);
router.get("/orders/:id", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), paymentController.getOrder);
router.post("/orders/:id/capture", (0, auth_1.requireRole)("CUSTOMER"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), paymentController.captureOrder);
exports.default = router;
