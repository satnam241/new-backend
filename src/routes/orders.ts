import { Router, Response } from 'express';
import { prisma } from '../prisma';
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
} from '../services/razorpay';
import {
  deviceAuthMiddleware,
  DeviceAuthRequest,
  generateDeviceFingerprint,
  createDeviceToken,
} from '../middleware/deviceAuth';
import { generateWatermarkedPdf } from '../services/pdfWatermark';
import { config } from '../config';

const router = Router();

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

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || !product.isActive) {
      res.status(404).json({ success: false, message: 'Product not found or inactive' });
      return;
    }

    // Receipt max length 40 chars
    const receipt = `rcpt_${Date.now().toString().slice(-8)}_${Math.floor(Math.random() * 1000)}`;

    let razorpayOrderId: string;
    let isMockFallback = false;

    // Check if using placeholder keys (dev / test mode)
    if (!config.razorpayKeyId || config.razorpayKeyId.includes('placeholder')) {
      razorpayOrderId = `order_mock_${Date.now()}`;
      isMockFallback = true;
    } else {
      try {
        const rzpOrder = await createRazorpayOrder({
          amount: product.price,
          receipt,
          notes: {
            productId: product.id,
            productTitle: product.title,
            customerName: resolvedName,
          },
        });
        razorpayOrderId = rzpOrder.id;
      } catch (rzpErr: any) {
        if (rzpErr.message?.includes('Authentication failed')) {
          console.warn('[Razorpay Notice]: Razorpay API keys in .env failed authentication. Falling back to test mock order so you can test.');
          razorpayOrderId = `order_test_${Date.now()}`;
          isMockFallback = true;
        } else {
          throw rzpErr;
        }
      }
    }

    // Record pending order in DB
    const order = await prisma.order.create({
      data: {
        productId: product.id,
        customerName: resolvedName,
        amount: product.price,
        currency: 'INR',
        razorpayOrderId,
        status: 'PENDING',
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
      },
    });

    res.json({
      success: true,
      orderId: order.id,
      razorpayOrderId,
      amount: product.price,
      currency: 'INR',
      keyId: config.razorpayKeyId,
      customerName: order.customerName,
      productTitle: product.title,
      isMock: isMockFallback,
    });
  } catch (error: any) {
    console.error('[Create Order Error]:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating order' });
  }
});

// 2. Verify Payment & Authorize Device
router.post('/verify', async (req, res) => {
  try {
    const {
      orderId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      clientFingerprint,
    } = req.body;

    const order = await prisma.order.findUnique({
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
    const isValid = verifyRazorpaySignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (!isValid) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });
      res.status(400).json({ success: false, message: 'Invalid payment signature' });
      return;
    }

    // Payment Verified! Generate Device Authorization
    const fingerprint = generateDeviceFingerprint(req, clientFingerprint);
    const deviceToken = createDeviceToken(order.id, fingerprint);

    // Update order with paid status and lock to this device
    const updatedOrder = await prisma.order.update({
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
  } catch (error: any) {
    console.error('[Verify Order Error]:', error);
    res.status(500).json({ success: false, message: error.message || 'Payment verification failed' });
  }
});

// 3. Get Access Details (Device Authorized)
router.get('/access/:orderId', deviceAuthMiddleware, async (req: DeviceAuthRequest, res: Response) => {
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
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. View PDF In-App (Layer 3: Stream Watermarked PDF for mobile viewer)
router.get('/view-pdf/:orderId', deviceAuthMiddleware, async (req: DeviceAuthRequest, res: Response) => {
  try {
    const order = req.order;
    const filePath = order.product.filePath;

    if (!filePath) {
      res.status(404).json({ success: false, message: 'PDF file not available for this item. Please use the Google Drive link.' });
      return;
    }

    // Generate watermarked bytes dynamically with customer name & order
    const watermarkedPdf = await generateWatermarkedPdf(filePath, {
      customerName: order.customerName,
      orderId: order.id,
      paymentId: order.razorpayPaymentId || undefined,
      purchaseDate: order.paidAt || undefined,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.send(Buffer.from(watermarkedPdf));
  } catch (error: any) {
    console.error('[View PDF Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to render PDF view' });
  }
});

// 5. Download Authorized & Watermarked PDF
router.get('/download/:orderId', deviceAuthMiddleware, async (req: DeviceAuthRequest, res: Response) => {
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
    await prisma.order.update({
      where: { id: order.id },
      data: { downloadCount: { increment: 1 } },
    });

    const watermarkedPdf = await generateWatermarkedPdf(filePath, {
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
  } catch (error: any) {
    console.error('[Download Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to process download' });
  }
});

export default router;
