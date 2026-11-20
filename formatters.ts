import type { StoreProfile } from '../types';

/**
 * Formatters for Indian Currency (₹), Exact Date & Time, and WhatsApp text
 */

export function formatCurrency(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  }).format(rounded);
}

export function formatDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatDateOnly(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatStockDisplay(pieces: number, bundlePieces: number, bundleName: string = 'Bundle'): {
  bundles: number;
  loose: number;
  text: string;
} {
  if (bundlePieces <= 1) {
    return {
      bundles: 0,
      loose: pieces,
      text: `${pieces} Pcs`,
    };
  }

  const sign = pieces < 0 ? '-' : '';
  const absPieces = Math.abs(pieces);
  const absBundles = Math.floor(absPieces / bundlePieces);
  const absLoose = absPieces % bundlePieces;
  const bundles = pieces < 0 ? -absBundles : absBundles;
  const loose = pieces < 0 ? -absLoose : absLoose;

  if (absBundles > 0 && absLoose > 0) {
    return {
      bundles,
      loose,
      text: `${sign}${absBundles} ${bundleName}${absBundles > 1 ? 's' : ''} + ${absLoose} Pcs (${pieces} Total)`,
    };
  }
  if (absBundles > 0) {
    return {
      bundles,
      loose: 0,
      text: `${sign}${absBundles} ${bundleName}${absBundles > 1 ? 's' : ''} (${pieces} Pcs)`,
    };
  }
  return {
    bundles: 0,
    loose,
    text: `${pieces} Pcs`,
  };
}

/**
 * Builds clean WhatsApp text message for receipt sharing
 * STRICT COMPLIANCE:
 * - Shop Name: SQ ENTERPRISES
 * - Current Date & Time
 * - NO owner name
 * - NO GST
 * - Items, Previous Balance, Grand Total, Amount Received, Remaining Balance
 */
export function buildWhatsAppBillText(
  bill: {
    billNumber: string;
    formattedDateTime: string;
    customerName: string;
    customerPhone: string;
    items: Array<{
      productName: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      itemTotal: number;
    }>;
    itemsTotal: number;
    previousBalance: number;
    grandTotal: number;
    amountReceived: number;
    remainingBalance: number;
    isGstBill?: boolean;
    gstRate?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    totalGstAmount?: number;
    gstNumber?: string;
  },
  storeProfile?: Partial<StoreProfile>
): string {
  const storeName = storeProfile?.storeName?.trim() || 'SQ ENTERPRISES';
  const lineSeparator = '------------------------------';
  let text = `*${storeName}*\n`;
  if (storeProfile?.address?.trim()) {
    text += `${storeProfile.address.trim()}\n`;
  }
  const contactParts = [
    storeProfile?.contactNumber?.trim() ? `Ph: ${storeProfile.contactNumber.trim()}` : '',
    storeProfile?.email?.trim() ? storeProfile.email.trim() : '',
  ].filter(Boolean);
  if (contactParts.length > 0) {
    text += `${contactParts.join(' | ')}\n`;
  }
  if (bill.isGstBill) {
    text += `*TAX INVOICE (GST)*\n`;
    const gstNo = bill.gstNumber || storeProfile?.gstin;
    if (gstNo) {
      text += `*GSTIN:* ${gstNo}\n`;
    }
  } else {
    text += `*${storeProfile?.tagline?.trim() || 'Wholesale FMCG Goods (Non-GST)'}*\n`;
  }
  text += `${lineSeparator}\n`;
  text += `*Bill No:* ${bill.billNumber}\n`;
  text += `*Date & Time:* ${bill.formattedDateTime}\n`;
  text += `*Customer:* ${bill.customerName || 'Walk-in'}\n`;
  text += `*Phone:* ${bill.customerPhone || 'N/A'}\n`;
  text += `${lineSeparator}\n`;
  text += `*ITEMS*\n`;

  bill.items.forEach((item, idx) => {
    const unitLabel = item.unit === 'bundle' ? 'Bundle' : 'Pc';
    text += `${idx + 1}. ${item.productName}\n   ${item.quantity} ${unitLabel} @ ₹${item.unitPrice} = *₹${item.itemTotal}*\n`;
  });

  text += `${lineSeparator}\n`;
  if (bill.isGstBill && bill.totalGstAmount) {
    const rate = bill.gstRate || 18;
    const halfRate = (rate / 2).toFixed(1);
    text += `*Subtotal (Taxable):* ₹${bill.itemsTotal.toFixed(2)}\n`;
    text += `*CGST (${halfRate}%):* ₹${(bill.cgstAmount ?? 0).toFixed(2)}\n`;
    text += `*SGST (${halfRate}%):* ₹${(bill.sgstAmount ?? 0).toFixed(2)}\n`;
    text += `*Total GST (${rate}%):* ₹${bill.totalGstAmount.toFixed(2)}\n`;
  } else {
    text += `*Items Total:* ₹${bill.itemsTotal}\n`;
  }

  if (bill.previousBalance > 0) {
    text += `*Previous Balance:* ₹${bill.previousBalance}\n`;
  }
  text += `*Grand Total:* *₹${bill.grandTotal.toFixed(2)}*\n`;
  text += `*Amount Received:* ₹${bill.amountReceived.toFixed(2)}\n`;
  text += `*Remaining Balance:* *₹${bill.remainingBalance.toFixed(2)}*\n`;
  text += `${lineSeparator}\n`;
  text += `_Thank you for your business!_\n`;
  text += `_${storeName}_`;

  return text;
}

/**
 * Builds WhatsApp message for a newly recorded Udhar (credit) transaction
 */
export function buildUdharWhatsAppText(
  data: {
    customerName: string;
    billNumber: string;
    formattedDateTime: string;
    newCreditAdded: number;
    totalRemainingBalance: number;
  },
  storeProfile?: Partial<StoreProfile>
): string {
  const storeName = storeProfile?.storeName?.trim() || 'SQ ENTERPRISES';
  const line = '------------------------------';
  let text = `*${storeName} - UDHAR (CREDIT) ALERT*\n`;
  text += `${line}\n`;
  text += `Dear *${data.customerName || 'Customer'}*,\n`;
  text += `A new *Udhar (Credit)* transaction has been recorded on your Khata account at *${storeName}*:\n\n`;
  text += `• *Bill No:* #${data.billNumber}\n`;
  text += `• *Date & Time:* ${data.formattedDateTime}\n`;
  text += `• *New Credit Added:* *₹${data.newCreditAdded.toFixed(2)}*\n`;
  text += `• *Total Pending Due:* *₹${data.totalRemainingBalance.toFixed(2)}*\n`;
  text += `${line}\n`;
  text += `Please keep this notification for your records.\n`;
  text += `_Thank you for your business!_\n`;
  text += `*${storeName}*`;
  return text;
}

/**
 * Builds standard SMS message for a newly recorded Udhar (credit) transaction
 */
export function buildUdharSMSText(
  data: {
    customerName: string;
    billNumber: string;
    formattedDateTime: string;
    newCreditAdded: number;
    totalRemainingBalance: number;
  },
  storeProfile?: Partial<StoreProfile>
): string {
  const storeName = storeProfile?.storeName?.trim() || 'SQ ENTERPRISES';
  return `${storeName}: Dear ${data.customerName || 'Customer'}, Rs.${data.newCreditAdded.toFixed(2)} Udhar added on Bill #${data.billNumber}. Total Pending Due: Rs.${data.totalRemainingBalance.toFixed(2)}. Date: ${data.formattedDateTime}. Thank you.`;
}

/**
 * Clean phone and launch WhatsApp
 */
export function launchWhatsApp(phone: string, message: string): void {
  if (!phone) return;
  const cleanPhone = phone.replace(/\D/g, '');
  const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const url = `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

/**
 * Clean phone and launch native SMS app
 */
export function launchSMS(phone: string, message: string): void {
  if (!phone) return;
  const cleanPhone = phone.replace(/\D/g, '');
  const targetPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone;
  // Standard SMS URI scheme supported across Android & iOS
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? '&' : '?';
  const url = `sms:${targetPhone}${separator}body=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

