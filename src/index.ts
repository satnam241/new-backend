import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import productsRouter from './routes/products';
import ordersRouter from './routes/orders';
import adminRouter from './routes/admin';
import webhookRouter from './routes/webhook';

const app = express();

// Middlewares
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());

// Capture raw body for webhook verification
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Serve static uploaded covers / assets safely
app.use('/uploads', express.static(config.uploadsDir));

// Health & root check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Razorpay Selling Backend API is running',
    version: '1.0.0',
    time: new Date(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Mount Routes
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhook', webhookRouter);

// Serve production client build if available
const clientDistCandidates = [
  path.join(__dirname, '../../client/dist'),
  path.join(__dirname, '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = clientDistCandidates.find((p) => fs.existsSync(p));

if (clientDistPath) {
  console.log(`📦 Serving production client from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Global Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

import { seedInitialProduct } from './seed';

if (process.env.VERCEL !== '1' && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(config.port, async () => {
    console.log(`🚀 Razorpay Selling Server running on http://localhost:${config.port}`);
    await seedInitialProduct();
  });
}

export default app;
