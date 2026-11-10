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
exports.listCategories = listCategories;
exports.createCategory = createCategory;
exports.setCategoryActive = setCategoryActive;
exports.listSlaPolicies = listSlaPolicies;
exports.upsertSlaPolicy = upsertSlaPolicy;
const userRepo = __importStar(require("../repositories/userRepository"));
const categoryRepo = __importStar(require("../repositories/categoryRepository"));
const slaRepo = __importStar(require("../repositories/slaPolicyRepository"));
const AppError_1 = require("../utils/AppError");
const auditLogService_1 = require("./auditLogService");
async function listUsers(role, page, limit) {
    const filter = role ? { role } : {};
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
        userRepo.findUsers(filter, skip, limit),
        userRepo.countUsers(filter),
    ]);
    return { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}
async function updateUser(targetId, updates, actor) {
    if (targetId === actor.userId && updates.isActive === false) {
        throw new AppError_1.AppError(400, "CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account.");
    }
    const before = await userRepo.findUserById(targetId);
    if (!before)
        throw new AppError_1.AppError(404, "NOT_FOUND", "User not found.");
    const updated = await userRepo.updateUser(targetId, updates);
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "USER_UPDATED",
        entity: "User",
        entityId: targetId,
        oldValue: { role: before.role, isActive: before.isActive },
        newValue: updates,
    });
    return updated;
}
async function listCategories() {
    return categoryRepo.listAllCategories();
}
async function createCategory(name, description, actor) {
    const category = await categoryRepo.createCategory({ name, description });
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "CATEGORY_CREATED",
        entity: "Category",
        entityId: category._id.toString(),
        newValue: { name, description },
    });
    return category;
}
async function setCategoryActive(id, isActive, actor) {
    const category = await categoryRepo.setCategoryActive(id, isActive);
    if (!category)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Category not found.");
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: isActive ? "CATEGORY_ACTIVATED" : "CATEGORY_DEACTIVATED",
        entity: "Category",
        entityId: id,
    });
    return category;
}
async function listSlaPolicies() {
    return slaRepo.listPolicies();
}
async function upsertSlaPolicy(priority, responseMinutes, resolutionMinutes, actor) {
    const before = await slaRepo.findPolicyForPriority(priority);
    const policy = await slaRepo.upsertPolicy(priority, responseMinutes, resolutionMinutes);
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "SLA_POLICY_UPDATED",
        entity: "SLAPolicy",
        entityId: policy._id.toString(),
        oldValue: before ? { responseMinutes: before.responseMinutes, resolutionMinutes: before.resolutionMinutes } : null,
        newValue: { responseMinutes, resolutionMinutes },
    });
    return policy;
}
