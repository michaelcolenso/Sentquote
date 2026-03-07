const PDFDocument = require('pdfkit');

function generateQuotePDF(quote, businessInfo) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      // Helper functions
      const formatCurrency = (cents) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
      };

      const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', { 
          year: 'numeric', month: 'long', day: 'numeric' 
        });
      };

      // Colors
      const primaryColor = '#22c55e';
      const darkColor = '#1a1a1a';
      const grayColor = '#666666';
      const lightGray = '#f5f5f5';

      // Header
      doc.fontSize(28).font('Helvetica-Bold').text(businessInfo.businessName || 'SentQuote', 50, 50);
      doc.fontSize(12).font('Helvetica').fillColor(grayColor).text('QUOTE', 50, 85);
      
      // Quote number and date
      doc.fontSize(10).fillColor(darkColor);
      doc.text(`Quote #: ${quote.slug.toUpperCase()}`, 400, 50, { align: 'right' });
      doc.text(`Date: ${formatDate(quote.created_at)}`, 400, 65, { align: 'right' });
      if (quote.valid_until) {
        doc.text(`Valid until: ${formatDate(quote.valid_until)}`, 400, 80, { align: 'right' });
      }

      // Horizontal line
      doc.moveTo(50, 110).lineTo(550, 110).stroke('#e0e0e0');

      // Client info
      doc.fontSize(10).fillColor(grayColor).text('TO:', 50, 130);
      doc.fontSize(12).fillColor(darkColor).font('Helvetica-Bold').text(quote.client_name, 50, 145);
      doc.fontSize(10).font('Helvetica').fillColor(grayColor).text(quote.client_email, 50, 160);

      // Title
      doc.moveDown(3);
      doc.fontSize(18).font('Helvetica-Bold').fillColor(darkColor).text(quote.title);
      
      if (quote.description) {
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').fillColor(grayColor).text(quote.description, { width: 500 });
      }

      doc.moveDown(2);

      // Line items table
      const tableTop = doc.y;
      const itemX = 50;
      const qtyX = 350;
      const priceX = 420;
      const totalX = 490;

      // Table header
      doc.fillColor(lightGray).rect(50, tableTop - 5, 500, 25).fill();
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(9);
      doc.text('DESCRIPTION', itemX, tableTop + 3);
      doc.text('QTY', qtyX, tableTop + 3, { width: 50, align: 'center' });
      doc.text('PRICE', priceX, tableTop + 3, { width: 60, align: 'right' });
      doc.text('TOTAL', totalX, tableTop + 3, { width: 60, align: 'right' });

      let y = tableTop + 25;
      doc.font('Helvetica').fontSize(10);

      quote.lineItems.forEach((item, index) => {
        const itemTotal = item.quantity * item.unitPrice;
        const rowHeight = 20;
        
        // Alternate row background
        if (index % 2 === 1) {
          doc.fillColor('#fafafa').rect(50, y - 3, 500, rowHeight).fill();
        }

        doc.fillColor(darkColor);
        doc.text(item.description, itemX, y, { width: 280 });
        doc.text(item.quantity.toString(), qtyX, y, { width: 50, align: 'center' });
        doc.text(formatCurrency(item.unitPrice * 100), priceX, y, { width: 60, align: 'right' });
        doc.text(formatCurrency(itemTotal * 100), totalX, y, { width: 60, align: 'right' });
        
        y += rowHeight;
      });

      // Bottom line
      doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke('#e0e0e0');
      y += 20;

      // Totals section
      const totalsX = 350;
      
      doc.fontSize(10).font('Helvetica').fillColor(grayColor);
      doc.text('Subtotal:', totalsX, y, { width: 100, align: 'right' });
      doc.text(formatCurrency(quote.subtotal), totalX, y, { width: 60, align: 'right' });
      y += 18;

      if (quote.tax_amount > 0) {
        doc.text(`Tax (${quote.tax_rate}%):`, totalsX, y, { width: 100, align: 'right' });
        doc.text(formatCurrency(quote.tax_amount), totalX, y, { width: 60, align: 'right' });
        y += 18;
      }

      // Total
      doc.moveTo(totalsX, y).lineTo(550, y).stroke('#e0e0e0');
      y += 10;
      doc.fontSize(14).font('Helvetica-Bold').fillColor(darkColor);
      doc.text('TOTAL:', totalsX, y, { width: 90, align: 'right' });
      doc.text(formatCurrency(quote.total), totalX - 10, y, { width: 70, align: 'right' });

      if (quote.deposit_amount > 0) {
        y += 25;
        doc.fontSize(11).fillColor(primaryColor);
        doc.text(`Deposit due (${quote.deposit_percent}%):`, totalsX, y, { width: 130, align: 'right' });
        doc.text(formatCurrency(quote.deposit_amount), totalX, y, { width: 60, align: 'right' });
      }

      // Notes
      if (quote.notes) {
        y += 40;
        doc.fontSize(10).font('Helvetica-Bold').fillColor(darkColor).text('Notes:', 50, y);
        y += 15;
        doc.font('Helvetica').fillColor(grayColor);
        doc.text(quote.notes, 50, y, { width: 500 });
      }

      // Status box
      y = doc.page.height - 150;
      const statusColors = {
        draft: '#999999',
        sent: '#3b82f6',
        accepted: '#22c55e',
        paid: '#22c55e',
        expired: '#ef4444'
      };
      const statusColor = statusColors[quote.status] || '#999999';
      
      doc.rect(50, y, 200, 60).stroke(statusColor);
      doc.fontSize(10).font('Helvetica').fillColor(grayColor).text('STATUS', 60, y + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(statusColor).text(quote.status.toUpperCase(), 60, y + 28);

      // Footer
      doc.fontSize(9).font('Helvetica').fillColor(grayColor);
      doc.text(
        `Generated by SentQuote • ${new Date().toLocaleDateString()}`,
        50,
        doc.page.height - 50,
        { align: 'center', width: 500 }
      );

      // Acceptance section for sent quotes
      if (['sent', 'accepted', 'paid'].includes(quote.status)) {
        doc.addPage();
        
        doc.fontSize(20).font('Helvetica-Bold').fillColor(darkColor).text('Quote Acceptance', 50, 50);
        doc.moveDown();
        
        let acceptY = doc.y;
        doc.fontSize(11).font('Helvetica').fillColor(grayColor);
        doc.text(`Quote: ${quote.title}`, 50, acceptY);
        acceptY += 18;
        doc.text(`Total Amount: ${formatCurrency(quote.total)}`, 50, acceptY);
        acceptY += 25;
        
        doc.fillColor(darkColor).text('By signing below, I acknowledge that I have reviewed and accept this quote:', 50, acceptY);
        acceptY += 50;
        
        // Signature lines
        doc.moveTo(50, acceptY).lineTo(280, acceptY).stroke('#000000');
        doc.fontSize(10).fillColor(grayColor).text('Signature', 50, acceptY + 5);
        
        doc.moveTo(320, acceptY).lineTo(500, acceptY).stroke('#000000');
        doc.text('Date', 320, acceptY + 5);
        
        acceptY += 60;
        doc.moveTo(150, acceptY).lineTo(400, acceptY).stroke('#000000');
        doc.fontSize(11).fillColor(darkColor).text('Name (print):', 50, acceptY - 5);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateQuotePDF
};
