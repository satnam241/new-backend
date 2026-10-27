"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const razorpay_1 = require("../services/razorpay");
const deviceAuth_1 = require("../middleware/deviceAuth");
const pdfWatermark_1 = require("../services/pdfWatermark");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// 1. Create Razorpay order (Buyer enters their name & clicks Pay)
router.post('/create', async (req, res) => {
    try {
        const { productId, customerName } = req.body;
        if (!productId) {
            res.status(400).json({
                success: false,
                message: 'Product ID is required',
            });
            return;
        }
        const resolvedName = (customerName && customerName.trim()) ? customerName.trim() : 'Customer';
        const product = await prisma_1.prisma.product.findUnique({
            where: { id: productId },
        });
        if (!product || !product.isActive) {
            res.status(404).json({ success: false, message: 'Product not found or inactive' });
            return;
        }
        // Receipt max length 40 chars
        const receipt = `rcpt_${Date.now().toString().slice(-8)}_${Math.floor(Math.random() * 1000)}`;
        let razorpayOrderId;
        let isMockFallback = false;
        // Check if using placeholder keys (dev / test mode)
        if (!config_1.config.razorpayKeyId || config_1.config.razorpayKeyId.includes('placeholder')) {
            razorpayOrderId = `order_mock_${Date.now()}`;
            isMockFallback = true;
        }
        else {
            try {
                const rzpOrder = await (0, razorpay_1.createRazorpayOrder)({
                    amount: product.price,
                    receipt,
                    notes: {
                        productId: product.id,
                        productTitle: product.title,
                        customerName: resolvedName,
                    },
                });
                razorpayOrderId = rzpOrder.id;
            }
            catch (rzpErr) {
                if (rzpErr.message?.includes('Authentication failed')) {
                    console.warn('[Razorpay Notice]: Razorpay API keys in .env failed authentication. Falling back to test mock order so you can test.');
                    razorpayOrderId = `order_test_${Date.now()}`;
                    isMockFallback = true;
                }
                else {
                    throw rzpErr;
                }
            }
        }
        // Record pending order in DB
        const order = await prisma_1.prisma.order.create({
            data: {
                productId: product.id,
                customerName: resolvedName,
                amount: product.price,
                currency: 'INR',
                razorpayOrderId,
                status: 'PENDING',
                ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
                userAgent: req.headers['user-agent'] || '',
            },
        });
        res.json({
            success: true,
            orderId: order.id,
            razorpayOrderId,
            amount: product.price,
            currency: 'INR',
            keyId: config_1.config.razorpayKeyId,
            customerName: order.customerName,
            productTitle: product.title,
            isMock: isMockFallback,
        });
    }
    catch (error) {
        console.error('[Create Order Error]:', error);
        res.status(500).json({ success: false, message: error.message || 'Error creating order' });
    }
});
// 2. Verify Payment & Authorize Device
router.post('/verify', async (req, res) => {
    try {
        const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature, clientFingerprint, } = req.body;
        const order = await prisma_1.prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });
        if (!order) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }
        if (order.status === 'PAID') {
            // Already paid, return current device token
            res.json({
                success: true,
                orderId: order.id,
                deviceToken: order.deviceToken,
                message: 'Order already verified',
            });
            return;
        }
        // Verify signature with Razorpay secret
        const isValid = (0, razorpay_1.verifyRazorpaySignature)(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isValid) {
            await prisma_1.prisma.order.update({
                where: { id: order.id },
                data: { status: 'FAILED' },
            });
            res.status(400).json({ success: false, message: 'Invalid payment signature' });
            return;
        }
        // Payment Verified! Generate Device Authorization
        const fingerprint = (0, deviceAuth_1.generateDeviceFingerprint)(req, clientFingerprint);
        const deviceToken = (0, deviceAuth_1.createDeviceToken)(order.id, fingerprint);
        // Ensure payment is captured on Razorpay
        if (!razorpayOrderId.startsWith('order_mock_') &&
            !razorpayOrderId.startsWith('order_test_') &&
            razorpayPaymentId &&
            !razorpayPaymentId.startsWith('pay_test_')) {
            await (0, razorpay_1.captureRazorpayPaymentIfNeeded)(razorpayPaymentId, Math.round(order.amount * 100));
        }
        // Update order with paid status and lock to this device
        const updatedOrder = await prisma_1.prisma.order.update({
            where: { id: order.id },
            data: {
                status: 'PAID',
                razorpayPaymentId,
                razorpaySignature,
                deviceToken,
                deviceFingerprint: fingerprint,
                paidAt: new Date(),
            },
        });
        res.json({
            success: true,
            orderId: updatedOrder.id,
            deviceToken,
            message: 'Payment verified and device authorized successfully',
        });
    }
    catch (error) {
        console.error('[Verify Order Error]:', error);
        res.status(500).json({ success: false, message: error.message || 'Payment verification failed' });
    }
});
// 2.5 Check Order Payment Status (Auto-verification & recovery for UPI / redirects)
router.get('/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const clientFingerprint = req.headers['x-device-fingerprint'] || '';
        const order = await prisma_1.prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });
        if (!order) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }
        if (order.status === 'PAID') {
            res.json({
                success: true,
                status: 'PAID',
                orderId: order.id,
                deviceToken: order.deviceToken,
            });
            return;
        }
        // If order is still PENDING and has a real Razorpay Order ID, check with Razorpay API
        if (order.status === 'PENDING' &&
            order.razorpayOrderId &&
            !order.razorpayOrderId.startsWith('order_mock_') &&
            !order.razorpayOrderId.startsWith('order_test_')) {
            const payments = await (0, razorpay_1.fetchRazorpayOrderPayments)(order.razorpayOrderId);
            // Look for any successful or authorized payment
            const successfulPayment = payments.find((p) => p.status === 'captured' || p.status === 'authorized');
            if (successfulPayment) {
                if (successfulPayment.status === 'authorized') {
                    await (0, razorpay_1.captureRazorpayPaymentIfNeeded)(successfulPayment.id, Math.round(order.amount * 100));
                }
                const fingerprint = (0, deviceAuth_1.generateDeviceFingerprint)(req, clientFingerprint);
                const deviceToken = order.deviceToken || (0, deviceAuth_1.createDeviceToken)(order.id, fingerprint);
                const updatedOrder = await prisma_1.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: 'PAID',
                        razorpayPaymentId: successfulPayment.id,
                        deviceToken,
                        deviceFingerprint: fingerprint,
                        paidAt: new Date(),
                    },
                });
                res.json({
                    success: true,
                    status: 'PAID',
                    orderId: updatedOrder.id,
                    deviceToken,
                    message: 'Payment verified successfully from Razorpay',
                });
                return;
            }
            // Check if there are any failed payments
            const failedPayment = payments.find((p) => p.status === 'failed');
            if (failedPayment) {
                res.json({
                    success: false,
                    status: 'FAILED',
                    message: failedPayment.error_description || 'Payment was unsuccessful or blocked by Razorpay.',
                    errorReason: failedPayment.error_reason,
                });
                return;
            }
        }
        res.json({
            success: true,
            status: order.status,
            orderId: order.id,
        });
    }
    catch (error) {
        console.error('[Check Order Status Error]:', error);
        res.status(500).json({ success: false, message: error.message || 'Error checking order status' });
    }
});
// 3. Get Access Details (Device Authorized)
router.get('/access/:orderId', deviceAuth_1.deviceAuthMiddleware, async (req, res) => {
    try {
        const order = req.order;
        res.json({
            success: true,
            order: {
                id: order.id,
                customerName: order.customerName,
                amount: order.amount,
                status: order.status,
                downloadCount: order.downloadCount,
                maxDownloads: order.maxDownloads,
                paidAt: order.paidAt,
                product: {
                    id: order.product.id,
                    title: order.product.title,
                    description: order.product.description,
                    coverImage: order.product.coverImage,
                    fileName: order.product.fileName,
                    fileSize: order.product.fileSize,
                    mimeType: order.product.mimeType,
                    driveUrl: order.product.driveUrl,
                    hasDriveAccess: !!order.product.driveUrl,
                    hasFile: !!order.product.filePath,
                },
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 4. View PDF In-App (Layer 3: Stream Watermarked PDF for mobile viewer)
router.get('/view-pdf/:orderId', deviceAuth_1.deviceAuthMiddleware, async (req, res) => {
    try {
        const order = req.order;
        const filePath = order.product.filePath;
        if (!filePath) {
            res.status(404).json({ success: false, message: 'PDF file not available for this item. Please use the Google Drive link.' });
            return;
        }
        // Generate watermarked bytes dynamically with customer name & order
        const watermarkedPdf = await (0, pdfWatermark_1.generateWatermarkedPdf)(filePath, {
            customerName: order.customerName,
            orderId: order.id,
            paymentId: order.razorpayPaymentId || undefined,
            purchaseDate: order.paidAt || undefined,
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.send(Buffer.from(watermarkedPdf));
    }
    catch (error) {
        console.error('[View PDF Error]:', error);
        res.status(500).json({ success: false, message: 'Failed to render PDF view' });
    }
});
// 5. Download Authorized & Watermarked PDF
router.get('/download/:orderId', deviceAuth_1.deviceAuthMiddleware, async (req, res) => {
    try {
        const order = req.order;
        if (order.downloadCount >= order.maxDownloads) {
            res.status(403).json({
                success: false,
                message: `Download limit reached (${order.maxDownloads} downloads allowed). Contact admin if you need a reset.`,
            });
            return;
        }
        const filePath = order.product.filePath;
        if (!filePath) {
            res.status(400).json({
                success: false,
                message: 'No downloadable PDF file associated with this product. Please use the Google Drive link provided.',
            });
            return;
        }
        // Increment download count
        await prisma_1.prisma.order.update({
            where: { id: order.id },
            data: { downloadCount: { increment: 1 } },
        });
        const watermarkedPdf = await (0, pdfWatermark_1.generateWatermarkedPdf)(filePath, {
            customerName: order.customerName,
            orderId: order.id,
            paymentId: order.razorpayPaymentId || undefined,
            purchaseDate: order.paidAt || undefined,
        });
        const rawFileName = order.product.fileName || `${order.product.title.replace(/\s+/g, '_')}.pdf`;
        const safeName = rawFileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.send(Buffer.from(watermarkedPdf));
    }
    catch (error) {
        console.error('[Download Error]:', error);
        res.status(500).json({ success: false, message: 'Failed to process download' });
    }
});
exports.default = router;
