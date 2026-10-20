"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const products_1 = __importDefault(require("./routes/products"));
const orders_1 = __importDefault(require("./routes/orders"));
const admin_1 = __importDefault(require("./routes/admin"));
const webhook_1 = __importDefault(require("./routes/webhook"));
const app = (0, express_1.default)();
// Middlewares
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
}));
app.use((0, cookie_parser_1.default)());
// Capture raw body for webhook verification
app.use(express_1.default.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    },
}));
app.use(express_1.default.urlencoded({ extended: true }));
// Serve static uploaded covers / assets safely
app.use('/uploads', express_1.default.static(config_1.config.uploadsDir));
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
app.use('/api/products', products_1.default);
app.use('/api/orders', orders_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/webhook', webhook_1.default);
// Serve production client build if available
const clientDistCandidates = [
    path_1.default.join(__dirname, '../../client/dist'),
    path_1.default.join(__dirname, '../client/dist'),
    path_1.default.resolve(process.cwd(), 'client/dist'),
    path_1.default.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = clientDistCandidates.find((p) => fs_1.default.existsSync(p));
if (clientDistPath) {
    console.log(`📦 Serving production client from: ${clientDistPath}`);
    app.use(express_1.default.static(clientDistPath));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
            return next();
        }
        res.sendFile(path_1.default.join(clientDistPath, 'index.html'));
    });
}
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Global Error]:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
    });
});
const seed_1 = require("./seed");
if (process.env.VERCEL !== '1' && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    app.listen(config_1.config.port, async () => {
        console.log(`🚀 Razorpay Selling Server running on http://localhost:${config_1.config.port}`);
        await (0, seed_1.seedInitialProduct)();
    });
}
exports.default = app;
