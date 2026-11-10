"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const AppError_1 = require("../utils/AppError");
function validate(schema, part = "body") {
    return (req, _res, next) => {
        const result = schema.safeParse(req[part]);
        if (!result.success) {
            const message = result.error.issues
                .map((issue) => `${issue.path.join(".") || part}: ${issue.message}`)
                .join("; ");
            throw new AppError_1.AppError(400, "VALIDATION_ERROR", message);
        }
        // Express 5 made `req.query` a getter-only property (no setter) - you
        // can no longer do `req.query = newObject`, it throws. `req.body` and
        // `req.params` are still plain writable properties, so only `query`
        // needs the "clear and refill the existing object" workaround; for the
        // others, a straight reassignment is simpler and works fine.
        if (part === "query") {
            const target = req.query;
            for (const key of Object.keys(target))
                delete target[key];
            Object.assign(target, result.data);
        }
        else {
            req[part] = result.data;
        }
        next();
    };
}
