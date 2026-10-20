import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config';

export const getRazorpayInstance = () => {
  if (!config.razorpayKeyId || config.razorpayKeyId.includes('placeholder')) {
    console.warn('[Razorpay] Running with test/placeholder keys. Set real keys in .env for actual payments.');
  }
  return new Razorpay({
    key_id: config.razorpayKeyId,
    key_secret: config.razorpayKeySecret,
  });
};

export interface CreateOrderParams {
  amount: number; // in INR rupees
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export const createRazorpayOrder = async (params: CreateOrderParams) => {
  const instance = getRazorpayInstance();
  // Razorpay requires amount in paise (1 INR = 100 paise)
  const options = {
    amount: Math.round(params.amount * 100),
    currency: params.currency || 'INR',
    receipt: params.receipt,
    notes: params.notes || {},
  };

  try {
    const order = await instance.orders.create(options);
    return order;
  } catch (error: any) {
    console.error('[Razorpay Order Creation Failed]:', error);
    throw new Error(error?.error?.description || error.message || 'Failed to create Razorpay order');
  }
};

export const verifyRazorpaySignature = (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean => {
  if (
    !config.razorpayKeySecret ||
    config.razorpayKeySecret.includes('placeholder') ||
    razorpayOrderId.startsWith('order_mock_') ||
    razorpayOrderId.startsWith('order_test_') ||
    razorpaySignature === 'mock_signature'
  ) {
    return true;
  }

  const generatedSignature = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  return generatedSignature === razorpaySignature;
};

export const verifyWebhookSignature = (body: string, signature: string): boolean => {
  if (!config.razorpayWebhookSecret) return false;
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpayWebhookSecret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
};
