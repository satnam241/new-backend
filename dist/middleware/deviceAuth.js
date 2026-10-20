"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceAuthMiddleware = exports.verifyDeviceToken = exports.createDeviceToken = exports.generateDeviceFingerprint = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../prisma");
const config_1 = require("../config");
const generateDeviceFingerprint = (req, clientFingerprint) => {
    const ua = req.headers['user-agent'] || 'unknown-ua';
    const raw = `${ua}-${clientFingerprint || ''}`;
    return crypto_1.default.createHash('sha256').update(raw).digest('hex').substring(0, 32);
};
exports.generateDeviceFingerprint = generateDeviceFingerprint;
const createDeviceToken = (orderId, fingerprint) => {
    return jsonwebtoken_1.default.sign({
        orderId,
        fingerprint,
    }, config_1.config.jwtSecret, { expiresIn: '365d' } // 1 year authorized session on that device
    );
};
exports.createDeviceToken = createDeviceToken;
const verifyDeviceToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
    }
    catch {
        return null;
    }
};
exports.verifyDeviceToken = verifyDeviceToken;
const deviceAuthMiddleware = async (req, res, next) => {
    try {
        const orderId = req.params.orderId || req.query.orderId;
        const token = req.query.token ||
            req.headers['x-device-token'] ||
            req.cookies?.deviceToken;
        const clientFingerprint = req.headers['x-device-fingerprint'];
        if (!orderId) {
            res.status(400).json({ success: false, message: 'Order ID is required' });
            return;
        }
        const order = await prisma_1.prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });
        if (!order) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }
        if (order.status !== 'PAID') {
            res.status(403).json({ success: false, message: 'Payment not completed or verified' });
            return;
        }
        if (order.isAccessRevoked) {
            res.status(403).json({
                success: false,
                message: 'Access to this content has been revoked by admin',
            });
            return;
        }
        // Verify token
        if (!token) {
            res.status(401).json({
                success: false,
                isDeviceLocked: true,
                message: 'Device Authorization Token missing. Access is restricted to the device used during purchase.',
            });
            return;
        }
        const decoded = (0, exports.verifyDeviceToken)(token);
        if (!decoded || decoded.orderId !== order.id) {
            res.status(403).json({
                success: false,
                isDeviceLocked: true,
                message: 'Invalid authorization token. Access is locked to the original device.',
            });
            return;
        }
        // Check device token in database
        if (order.deviceToken && order.deviceToken !== token) {
            res.status(403).json({
                success: false,
                isDeviceLocked: true,
                message: 'Device mismatch. This link has already been locked to another phone/device.',
            });
            return;
        }
        req.order = order;
        req.deviceFingerprint = (0, exports.generateDeviceFingerprint)(req, clientFingerprint);
        next();
    }
    catch (error) {
        console.error('[DeviceAuth Error]:', error);
        res.status(500).json({ success: false, message: 'Internal server error verifying authorization' });
    }
};
exports.deviceAuthMiddleware = deviceAuthMiddleware;
