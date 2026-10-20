import fs from 'fs/promises';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';

export interface WatermarkOptions {
  customerName: string;
  orderId: string;
  paymentId?: string;
  purchaseDate?: Date;
}

export const generateWatermarkedPdf = async (
  originalFilePath: string,
  options: WatermarkOptions
): Promise<Uint8Array> => {
  const existingPdfBytes = await fs.readFile(originalFilePath);

  try {
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    const dateStr = (options.purchaseDate || new Date()).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const paymentRef = options.paymentId ? `• Ref: ${options.paymentId}` : '';
    const watermarkText = `LICENSED TO: ${options.customerName.toUpperCase()} ${paymentRef} • ${dateStr}`;
    const footerText = `Personal Authorized Copy for ${options.customerName} (${dateStr}). Unauthorized sharing is prohibited.`;

    for (const page of pages) {
      const { width, height } = page.getSize();

      // 1. Diagonal Watermark in Center
      const textSize = Math.min(width, height) / 32;
      page.drawText(watermarkText, {
        x: width * 0.12,
        y: height * 0.45,
        size: textSize,
        font: helveticaFont,
        color: rgb(0.75, 0.75, 0.75),
        opacity: 0.28,
        rotate: degrees(35),
      });

      // 2. Subtle Secure Footer on every page
      page.drawText(footerText, {
        x: 20,
        y: 12,
        size: 8,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.5,
      });
    }

    return await pdfDoc.save();
  } catch (error) {
    console.error('[Watermark Error]: Failed to watermark PDF, falling back to original bytes', error);
    return existingPdfBytes;
  }
};
