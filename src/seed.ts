import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { prisma } from './prisma';
import { config } from './config';

async function createSamplePdf(): Promise<string> {
  const filePath = path.join(config.uploadsDir, 'sample-instagram-guide.pdf');
  try {
    if (fs.existsSync(filePath)) return filePath;

    if (!fs.existsSync(config.uploadsDir)) {
      fs.mkdirSync(config.uploadsDir, { recursive: true });
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Page 1
    const page1 = pdfDoc.addPage([600, 800]);
    page1.drawText('Instagram Growth & Monetization Blueprint', {
      x: 50,
      y: 720,
      size: 22,
      font,
      color: rgb(0.1, 0.2, 0.6),
    });

    page1.drawText('Chapter 1: The Bio-Link Funnel Strategy', {
      x: 50,
      y: 670,
      size: 15,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    const lines = [
      'Welcome to your premium eBook guide.',
      'This file has been purchased and personalized with dynamic watermarking.',
      '',
      'Key Takeaways:',
      '1. High-Converting Hook: Focus your Reel intro on the pain point.',
      '2. Simple Bio Call-To-Action: Send traffic to a single, focused product page.',
      '3. Instant Fulfillment: Deliver the value instantly inside the browser.',
      '4. Protection: Keep your digital assets protected with device authorization.',
      '',
      'Congratulations on taking your digital business to the next level!',
    ];

    let currentY = 620;
    for (const line of lines) {
      page1.drawText(line, {
        x: 50,
        y: currentY,
        size: 12,
        font: line.startsWith('Key Takeaways') ? font : regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      currentY -= 25;
    }

    const pdfBytes = await pdfDoc.save();
    await fs.promises.writeFile(filePath, pdfBytes);
    console.log('✅ Created sample PDF eBook at:', filePath);
  } catch (err) {
    console.warn('Could not write sample PDF file:', err);
  }
  return filePath;
}

export async function seedInitialProduct() {
  try {
    const existing = await prisma.product.count();
    if (existing > 0) return;

    const samplePdfPath = await createSamplePdf();

    await prisma.product.create({
      data: {
        title: 'Instagram Growth & Monetization Blueprint',
        slug: 'instagram-blueprint',
        description:
          'Learn the exact step-by-step strategy to turn Instagram followers into paying customers using a friction-free bio checkout funnel. Includes in-app secure reader and watermarked PDF download.',
        price: 199,
        originalPrice: 999,
        driveUrl: 'https://drive.google.com/drive/folders/1B9XkqD-8LLzhkhD2mE_OVaDMptVbgOHt',
        filePath: samplePdfPath,
        fileName: 'Instagram-Growth-Blueprint.pdf',
        fileSize: 45000,
        mimeType: 'application/pdf',
        isActive: true,
      },
    });

    console.log('🎉 Seeded sample product with Google Drive access: /p/instagram-blueprint');
  } catch (error) {
    console.error('Seed notice:', error);
  }
}
