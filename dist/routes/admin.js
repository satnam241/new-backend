"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../prisma");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// 1. Admin Login
router.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password || password !== config_1.config.adminPassword) {
        res.status(401).json({ success: false, message: 'Invalid admin password' });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ role: 'admin' }, config_1.config.jwtSecret, { expiresIn: '7d' });
    res.json({ success: true, token, message: 'Admin logged in successfully' });
});
// 2. Admin Stats
router.get('/stats', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const [totalRevenueResult, paidOrdersCount, totalDownloadsResult, totalProducts] = await Promise.all([
            prisma_1.prisma.order.aggregate({
                where: { status: 'PAID' },
                _sum: { amount: true },
            }),
            prisma_1.prisma.order.count({ where: { status: 'PAID' } }),
            prisma_1.prisma.order.aggregate({
                _sum: { downloadCount: true },
            }),
            prisma_1.prisma.product.count(),
        ]);
        const totalRevenue = totalRevenueResult._sum.amount || 0;
        const totalDownloads = totalDownloadsResult._sum.downloadCount || 0;
        res.json({
            success: true,
            stats: {
                totalRevenue,
                paidOrdersCount,
                totalDownloads,
                totalProducts,
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 3. Admin Orders List
router.get('/orders', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const orders = await prisma_1.prisma.order.findMany({
            include: {
                product: {
                    select: {
                        id: true,
                        title: true,
                        price: true,
                        fileName: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 100, // latest 100 orders
        });
        res.json({ success: true, orders });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 4. Toggle Revoke Access for an order
router.patch('/orders/:id/revoke', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma_1.prisma.order.findUnique({ where: { id } });
        if (!order) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }
        const updated = await prisma_1.prisma.order.update({
            where: { id },
            data: { isAccessRevoked: !order.isAccessRevoked },
        });
        res.json({
            success: true,
            isAccessRevoked: updated.isAccessRevoked,
            message: `Access ${updated.isAccessRevoked ? 'revoked' : 'restored'} successfully`,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 5. Reset Downloads
router.patch('/orders/:id/reset-downloads', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.order.update({
            where: { id },
            data: { downloadCount: 0 },
        });
        res.json({ success: true, message: 'Downloads count reset to 0' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
