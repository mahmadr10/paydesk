"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listActiveCategories = listActiveCategories;
exports.listAllCategories = listAllCategories;
exports.findCategoryByName = findCategoryByName;
exports.createCategory = createCategory;
exports.setCategoryActive = setCategoryActive;
const Category_1 = require("../models/Category");
function listActiveCategories() {
    return Category_1.Category.find({ isActive: true }).sort({ name: 1 });
}
function listAllCategories() {
    return Category_1.Category.find().sort({ name: 1 });
}
function findCategoryByName(name) {
    return Category_1.Category.findOne({ name, isActive: true });
}
function createCategory(data) {
    return Category_1.Category.create(data);
}
function setCategoryActive(id, isActive) {
    return Category_1.Category.findByIdAndUpdate(id, { isActive }, { returnDocument: "after" });
}
