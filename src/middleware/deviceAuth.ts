import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { config } from '../config';

export interface DeviceAuthRequest extends Request {
  order?: any;
  deviceFingerprint?: string;
}

export const generateDeviceFingerprint = (req: Request, clientFingerprint?: string): string => {
  const ua = req.headers['user-agent'] || 'unknown-ua';
  const raw = `${ua}-${clientFingerprint || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
};

export const createDeviceToken = (orderId: string, fingerprint: string): string => {
  return jwt.sign(
    {
      orderId,
      fingerprint,
    },
    config.jwtSecret,
    { expiresIn: '365d' } // 1 year authorized session on that device
  );
};

export const verifyDeviceToken = (token: string): { orderId: string; fingerprint: string } | null => {
  try {
    return jwt.verify(token, config.jwtSecret) as { orderId: string; fingerprint: string };
  } catch {
    return null;
  }
};

export const deviceAuthMiddleware = async (
  req: DeviceAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const orderId = req.params.orderId || req.query.orderId as string;
    const token =
      (req.query.token as string) ||
      (req.headers['x-device-token'] as string) ||
      req.cookies?.deviceToken;
    const clientFingerprint = req.headers['x-device-fingerprint'] as string;

    if (!orderId) {
      res.status(400).json({ success: false, message: 'Order ID is required' });
      return;
    }

    const order = await prisma.order.findUnique({
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

    const decoded = verifyDeviceToken(token);
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
    req.deviceFingerprint = generateDeviceFingerprint(req, clientFingerprint);
    next();
  } catch (error) {
    console.error('[DeviceAuth Error]:', error);
    res.status(500).json({ success: false, message: 'Internal server error verifying authorization' });
  }
};
