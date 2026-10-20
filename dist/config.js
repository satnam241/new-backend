"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '5000', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    jwtSecret: process.env.JWT_SECRET || 'dev_secret_key_change_in_production',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
    uploadsDir: process.env.UPLOADS_DIR ||
        (process.env.VERCEL ? '/tmp/uploads' : path_1.default.join(__dirname, '..', 'uploads')),
};
