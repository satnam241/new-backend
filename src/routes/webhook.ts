import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { verifyWebhookSignature } from '../services/razorpay';
import { createDeviceToken } from '../middleware/deviceAuth';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  if (signature && !verifyWebhookSignature(rawBody, signature)) {
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
      const order = await prisma.order.findUnique({
        where: { razorpayOrderId },
      });

      if (order && order.status !== 'PAID') {
        const deviceToken = createDeviceToken(order.id, 'webhook-session');
        await prisma.order.update({
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

export default router;
