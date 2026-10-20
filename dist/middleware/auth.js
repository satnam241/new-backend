"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const adminAuthMiddleware = (req, res, next) => {
    // Allow direct admin password in header for convenience, or JWT token
    const authHeader = req.headers.authorization;
    const adminSecretHeader = req.headers['x-admin-key'];
    if (adminSecretHeader && adminSecretHeader === config_1.config.adminPassword) {
        req.isAdmin = true;
        return next();
    }
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
            if (decoded.role === 'admin') {
                req.isAdmin = true;
                return next();
            }
        }
        catch (err) {
            // Invalid token
        }
    }
    res.status(401).json({
        success: false,
        message: 'Unauthorized: Admin access required',
    });
};
exports.adminAuthMiddleware = adminAuthMiddleware;
