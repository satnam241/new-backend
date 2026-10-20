import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { adminAuthMiddleware } from '../middleware/auth';
import { config } from '../config';

const router = Router();

// 1. Admin Login
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password || password !== config.adminPassword) {
    res.status(401).json({ success: false, message: 'Invalid admin password' });
    return;
  }

  const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
  res.json({ success: true, token, message: 'Admin logged in successfully' });
});

// 2. Admin Stats
router.get('/stats', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const [totalRevenueResult, paidOrdersCount, totalDownloadsResult, totalProducts] =
      await Promise.all([
        prisma.order.aggregate({
          where: { status: 'PAID' },
          _sum: { amount: true },
        }),
        prisma.order.count({ where: { status: 'PAID' } }),
        prisma.order.aggregate({
          _sum: { downloadCount: true },
        }),
        prisma.product.count(),
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
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Admin Orders List
router.get('/orders', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
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
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Toggle Revoke Access for an order
router.patch('/orders/:id/revoke', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { isAccessRevoked: !order.isAccessRevoked },
    });

    res.json({
      success: true,
      isAccessRevoked: updated.isAccessRevoked,
      message: `Access ${updated.isAccessRevoked ? 'revoked' : 'restored'} successfully`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Reset Downloads
router.patch('/orders/:id/reset-downloads', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.order.update({
      where: { id },
      data: { downloadCount: 0 },
    });

    res.json({ success: true, message: 'Downloads count reset to 0' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
