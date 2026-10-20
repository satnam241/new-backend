"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const razorpay_1 = require("../services/razorpay");
const deviceAuth_1 = require("../middleware/deviceAuth");
const router = (0, express_1.Router)();
router.post('/', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    if (signature && !(0, razorpay_1.verifyWebhookSignature)(rawBody, signature)) {
        res.status(400).json({ success: false, message: 'Invalid webhook signature' });
        return;
    }
    const event = req.body.event;
    const payload = req.body.payload;
    if (event === 'payment.captured' || event === 'order.paid') {
        const payment = payload?.payment?.entity;
        const razorpayOrderId = payment?.order_id;
        const razorpayPaymentId = payment?.id;
        if (razorpayOrderId) {
            const order = await prisma_1.prisma.order.findUnique({
                where: { razorpayOrderId },
            });
            if (order && order.status !== 'PAID') {
                const deviceToken = (0, deviceAuth_1.createDeviceToken)(order.id, 'webhook-session');
                await prisma_1.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: 'PAID',
                        razorpayPaymentId,
                        deviceToken: order.deviceToken || deviceToken,
                        paidAt: new Date(),
                    },
                });
                console.log(`[Webhook]: Order ${order.id} marked as PAID via Razorpay webhook`);
            }
        }
    }
    res.json({ status: 'ok' });
});
exports.default = router;
