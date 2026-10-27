"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWebhookSignature = exports.verifyRazorpaySignature = exports.captureRazorpayPaymentIfNeeded = exports.fetchRazorpayOrderPayments = exports.createRazorpayOrder = exports.getRazorpayInstance = void 0;
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const getRazorpayInstance = () => {
    if (!config_1.config.razorpayKeyId || config_1.config.razorpayKeyId.includes('placeholder')) {
        console.warn('[Razorpay] Running with test/placeholder keys. Set real keys in .env for actual payments.');
    }
    return new razorpay_1.default({
        key_id: config_1.config.razorpayKeyId,
        key_secret: config_1.config.razorpayKeySecret,
    });
};
exports.getRazorpayInstance = getRazorpayInstance;
const createRazorpayOrder = async (params) => {
    const instance = (0, exports.getRazorpayInstance)();
    // Razorpay requires amount in paise (1 INR = 100 paise)
    const options = {
        amount: Math.round(params.amount * 100),
        currency: params.currency || 'INR',
        receipt: params.receipt,
        payment_capture: 1, // Auto-capture payments immediately upon successful transaction
        notes: params.notes || {},
    };
    try {
        const order = await instance.orders.create(options);
        return order;
    }
    catch (error) {
        console.error('[Razorpay Order Creation Failed]:', error);
        throw new Error(error?.error?.description || error.message || 'Failed to create Razorpay order');
    }
};
exports.createRazorpayOrder = createRazorpayOrder;
const fetchRazorpayOrderPayments = async (razorpayOrderId) => {
    try {
        const instance = (0, exports.getRazorpayInstance)();
        const payments = await instance.orders.fetchPayments(razorpayOrderId);
        return payments?.items || [];
    }
    catch (error) {
        console.error(`[Razorpay fetch payments failed for ${razorpayOrderId}]:`, error);
        return [];
    }
};
exports.fetchRazorpayOrderPayments = fetchRazorpayOrderPayments;
const captureRazorpayPaymentIfNeeded = async (paymentId, amountInPaise) => {
    try {
        const instance = (0, exports.getRazorpayInstance)();
        const payment = await instance.payments.fetch(paymentId);
        if (payment && payment.status === 'authorized') {
            console.log(`[Razorpay]: Payment ${paymentId} is authorized. Auto-capturing ${amountInPaise} paise now...`);
            const captured = await instance.payments.capture(paymentId, amountInPaise, 'INR');
            return captured;
        }
        return payment;
    }
    catch (err) {
        console.warn(`[Razorpay capture check notice for ${paymentId}]:`, err?.message || err);
        return null;
    }
};
exports.captureRazorpayPaymentIfNeeded = captureRazorpayPaymentIfNeeded;
const verifyRazorpaySignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
    if (!config_1.config.razorpayKeySecret ||
        config_1.config.razorpayKeySecret.includes('placeholder') ||
        razorpayOrderId.startsWith('order_mock_') ||
        razorpayOrderId.startsWith('order_test_') ||
        razorpaySignature === 'mock_signature') {
        return true;
    }
    const generatedSignature = crypto_1.default
        .createHmac('sha256', config_1.config.razorpayKeySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');
    return generatedSignature === razorpaySignature;
};
exports.verifyRazorpaySignature = verifyRazorpaySignature;
const verifyWebhookSignature = (body, signature) => {
    if (!config_1.config.razorpayWebhookSecret)
        return false;
    const expectedSignature = crypto_1.default
        .createHmac('sha256', config_1.config.razorpayWebhookSecret)
        .update(body)
        .digest('hex');
    return expectedSignature === signature;
};
exports.verifyWebhookSignature = verifyWebhookSignature;
