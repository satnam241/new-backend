"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const prisma_1 = require("../prisma");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// Configure Multer storage
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        if (!fs_1.default.existsSync(config_1.config.uploadsDir)) {
            fs_1.default.mkdirSync(config_1.config.uploadsDir, { recursive: true });
        }
        cb(null, config_1.config.uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
});
// Helper to create URL-safe slug
const slugify = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w\-]+/g, '') // Remove all non-word chars
        .replace(/\-\-+/g, '-'); // Replace multiple - with single -
};
// 1. PUBLIC: Get all active products
router.get('/', async (req, res) => {
    try {
        const products = await prisma_1.prisma.product.findMany({
            where: { isActive: true },
            select: {
                id: true,
                title: true,
                slug: true,
                description: true,
                price: true,
                originalPrice: true,
                coverImage: true,
                fileName: true,
                fileSize: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, products });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 2. PUBLIC: Get product by slug (Used by Instagram Bio Link e.g. /p/:slug)
router.get('/slug/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const product = await prisma_1.prisma.product.findUnique({
            where: { slug },
            select: {
                id: true,
                title: true,
                slug: true,
                description: true,
                price: true,
                originalPrice: true,
                coverImage: true,
                fileName: true,
                fileSize: true,
                driveUrl: true,
                isActive: true,
            },
        });
        if (!product || !product.isActive) {
            res.status(404).json({ success: false, message: 'Product not found or inactive' });
            return;
        }
        res.json({
            success: true,
            product: {
                ...product,
                hasDriveAccess: !!product.driveUrl,
                // Do not leak raw drive URL on public unauthenticated checkout
                driveUrl: undefined,
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 3. ADMIN: Get all products (including inactive) with sales counts
router.get('/admin/all', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const products = await prisma_1.prisma.product.findMany({
            include: {
                _count: {
                    select: { orders: { where: { status: 'PAID' } } },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, products });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 4. ADMIN: Create a new product (eBook, PDF, template, etc.)
router.post('/', auth_1.adminAuthMiddleware, upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
]), async (req, res) => {
    try {
        const files = req.files;
        const digitalFile = files?.file?.[0];
        const coverFile = files?.coverImage?.[0];
        const { title, description, price, originalPrice, customSlug, driveUrl } = req.body;
        if (!digitalFile && !driveUrl) {
            res.status(400).json({ success: false, message: 'Either a PDF file or a Google Drive link is required' });
            return;
        }
        if (!title || !price) {
            res.status(400).json({ success: false, message: 'Title and price are required' });
            return;
        }
        let slug = customSlug ? slugify(customSlug) : slugify(title);
        // Ensure unique slug
        const existingSlug = await prisma_1.prisma.product.findUnique({ where: { slug } });
        if (existingSlug) {
            slug = `${slug}-${Date.now().toString().slice(-4)}`;
        }
        const product = await prisma_1.prisma.product.create({
            data: {
                title,
                slug,
                description: description || '',
                price: parseInt(price, 10),
                originalPrice: originalPrice ? parseInt(originalPrice, 10) : null,
                driveUrl: driveUrl ? driveUrl.trim() : null,
                filePath: digitalFile ? digitalFile.path : null,
                fileName: digitalFile ? digitalFile.originalname : null,
                fileSize: digitalFile ? digitalFile.size : null,
                mimeType: digitalFile ? (digitalFile.mimetype || 'application/pdf') : 'application/octet-stream',
                coverImage: coverFile ? `/uploads/${coverFile.filename}` : null,
                isActive: true,
            },
        });
        res.status(201).json({ success: true, product });
    }
    catch (error) {
        console.error('[Create Product Error]:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
// 5. ADMIN: Update an existing product
router.put('/:id', auth_1.adminAuthMiddleware, upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
]), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, price, originalPrice, isActive, driveUrl } = req.body;
        const files = req.files;
        const digitalFile = files?.file?.[0];
        const coverFile = files?.coverImage?.[0];
        const existingProduct = await prisma_1.prisma.product.findUnique({ where: { id } });
        if (!existingProduct) {
            res.status(404).json({ success: false, message: 'Product not found' });
            return;
        }
        const updateData = {};
        if (title !== undefined)
            updateData.title = title;
        if (description !== undefined)
            updateData.description = description;
        if (price !== undefined)
            updateData.price = parseInt(price, 10);
        if (originalPrice !== undefined) {
            updateData.originalPrice = originalPrice ? parseInt(originalPrice, 10) : null;
        }
        if (isActive !== undefined) {
            updateData.isActive = isActive === 'true' || isActive === true;
        }
        if (driveUrl !== undefined) {
            updateData.driveUrl = driveUrl ? driveUrl.trim() : null;
        }
        if (digitalFile) {
            // remove old file if exists
            if (existingProduct.filePath && fs_1.default.existsSync(existingProduct.filePath)) {
                fs_1.default.unlink(existingProduct.filePath, () => { });
            }
            updateData.filePath = digitalFile.path;
            updateData.fileName = digitalFile.originalname;
            updateData.fileSize = digitalFile.size;
            updateData.mimeType = digitalFile.mimetype || 'application/pdf';
        }
        if (coverFile) {
            updateData.coverImage = `/uploads/${coverFile.filename}`;
        }
        const updated = await prisma_1.prisma.product.update({
            where: { id },
            data: updateData,
        });
        res.json({ success: true, product: updated });
    }
    catch (error) {
        console.error('[Update Product Error]:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
// 6. ADMIN: Delete a product
router.delete('/:id', auth_1.adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const product = await prisma_1.prisma.product.findUnique({ where: { id } });
        if (!product) {
            res.status(404).json({ success: false, message: 'Product not found' });
            return;
        }
        // Delete stored files
        if (product.filePath && fs_1.default.existsSync(product.filePath)) {
            fs_1.default.unlink(product.filePath, () => { });
        }
        await prisma_1.prisma.product.delete({ where: { id } });
        res.json({ success: true, message: 'Product deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
