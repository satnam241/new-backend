import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AdminAuthRequest extends Request {
  isAdmin?: boolean;
}

export const adminAuthMiddleware = (
  req: AdminAuthRequest,
  res: Response,
  next: NextFunction
): void => {
  // Allow direct admin password in header for convenience, or JWT token
  const authHeader = req.headers.authorization;
  const adminSecretHeader = req.headers['x-admin-key'];

  if (adminSecretHeader && adminSecretHeader === config.adminPassword) {
    req.isAdmin = true;
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      if (decoded.role === 'admin') {
        req.isAdmin = true;
        return next();
      }
    } catch (err) {
      // Invalid token
    }
  }

  res.status(401).json({
    success: false,
    message: 'Unauthorized: Admin access required',
  });
};
