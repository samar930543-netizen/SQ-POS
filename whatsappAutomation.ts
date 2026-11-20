import {
  Bill,
  BillItem,
  Customer,
  Product,
  ReceiptSettings,
  StaffMember,
  UnitType,
  WhatsAppInboundMessage,
  WhatsAppMessageIntent,
  WhatsAppParsedItem,
} from '../types';
import { getEffectiveUnitPrice } from './customerPricing';
import { formatCurrency, formatDateTime, formatStockDisplay } from './formatters';

export function normalizePhoneDigits(phone?: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function findCustomerByPhone(customers: Customer[], phone?: string): Customer | null {
  const target = normalizePhoneDigits(phone);
  if (!target || target.length < 6) return null;
  return (
    customers.find(c => {
      const custDigits = normalizePhoneDigits(c.phone);
      return custDigits === target || custDigits.endsWith(target) || target.endsWith(custDigits);
    }) || null
  );
}

const BUNDLE_KEYWORDS = [
  'bundle',
  'bundles',
  'bdl',
  'bdls',
  'carton',
  'cartons',
  'ctn',
  'ctns',
  'peti',
  'petis',
  'box',
  'boxes',
  'tray',
  'trays',
  'case',
  'cases',
  'dozen',
  'dozens',
  'bora',
];

const PIECE_KEYWORDS = [
  'pc',
  'pcs',
  'piece',
  'pieces',
  'nag',
  'pkt',
  'pkts',
  'packet',
  'packets',
  'single',
  'unit',
  'units',
  'bottle',
  'bottles',
  'can',
  'cans',
  'bar',
  'bars',
  'soap',
  'soaps',
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

const STOP_WORDS = new Set([
  'hi',
  'hello',
  'namaste',
  'bhai',
  'bhaiya',
  'ji',
  'sir',
  'please',
  'pls',
  'plz',
  'send',
  'order',
  'bhej',
  'bhejo',
  'bhejdo',
  'chahiye',
  'dedo',
  'dena',
  'pack',
  'karo',
  'kardo',
  'kar',
  'rate',
  'price',
  'bhav',
  'kitna',
  'kya',
  'hai',
  'stock',
  'available',
  'avail',
  'aur',
  'and',
  'with',
  'for',
  'the',
  'of',
  'me',
  'mere',
  'mera',
  'due',
  'udhar',
  'khata',
  'balance',
  'baki',
  'today',
  'urgent',
  'kal',
  'aaj',
  ...BUNDLE_KEYWORDS,
  ...PIECE_KEYWORDS,
]);

function matchProductForSegment(segment: string, products: Product[]): { product: Product | null; confidence: number } {
  const segLower = segment.toLowerCase();
  const segTokens = tokenize(segLower).filter(t => !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  if (segTokens.length === 0) return { product: null, confidence: 0 };

  let bestProduct: Product | null = null;
  let bestScore = 0;

  for (const prod of products) {
    const prodLower = prod.name.toLowerCase();
    const prodTokens = tokenize(prodLower);

    if (prodLower.includes(segTokens.join(' ')) && segTokens.join(' ').length >= 4) {
      return { product: prod, confidence: 0.96 };
    }

    let score = 0;
    for (const token of segTokens) {
      if (prodLower.includes(token)) {
        score += token.length >= 4 ? 2.2 : 1.3;
      } else if (prodTokens.some(pt => pt.startsWith(token) || token.startsWith(pt))) {
        score += 1.0;
      }
    }

    // Bonus for barcode mention
    if (prod.barcode && segLower.includes(prod.barcode.toLowerCase())) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = prod;
    }
  }

  if (bestProduct && bestScore >= 1.8) {
    return {
      product: bestProduct,
      confidence: Math.min(0.95, 0.55 + bestScore * 0.1),
    };
  }
  return { product: null, confidence: 0 };
}

function detectUnitFromSegment(segment: string, product: Product): UnitType {
  const lower = segment.toLowerCase();
  const hasPieceHint = PIECE_KEYWORDS.some(k => new RegExp(`\\b${k}\\b`, 'i').test(lower));
  const hasBundleHint =
    BUNDLE_KEYWORDS.some(k => new RegExp(`\\b${k}\\b`, 'i').test(lower)) ||
    (product.bundleUnitName && new RegExp(`\\b${product.bundleUnitName.toLowerCase()}s?\\b`, 'i').test(lower));

  if (hasBundleHint && !hasPieceHint && product.bundlePrice > 0) return 'bundle';
  if (hasPieceHint && !hasBundleHint && product.piecePrice > 0) return 'piece';
  if (hasBundleHint && product.bundlePrice > 0) return 'bundle';
  if (hasPieceHint && product.piecePrice > 0) return 'piece';
  return product.bundlePrice > 0 ? 'bundle' : 'piece';
}

function detectQtyFromSegment(segment: string): number {
  const matchLeading = segment.match(/(?:^|\s)(\d{1,4})(?:\s*(?:x|\*)?\s*[a-zA-Z])/i);
  if (matchLeading?.[1]) {
    const qty = parseInt(matchLeading[1], 10);
    if (qty > 0 && qty <= 999) return qty;
  }
  const matchQtyWord = segment.match(/(?:qty|quantity|nos?)[:\s-]*(\d{1,4})/i);
  if (matchQtyWord?.[1]) {
    const qty = parseInt(matchQtyWord[1], 10);
    if (qty > 0 && qty <= 999) return qty;
  }
  const anyNum = segment.match(/\b(\d{1,3})\b/);
  if (anyNum?.[1]) {
    const val = parseInt(anyNum[1], 10);
    // Avoid mistaking 75g / 100g / 250ml pack weights as order quantities
    const isPackSpec = new RegExp(`\\b${val}(?:g|gm|ml|l|ltr|kg)\\b`, 'i').test(segment);
    if (!isPackSpec && val > 0 && val <= 500) {
      return val;
    }
  }
  return 1;
}

export function evaluateWhatsAppItemsAgainstInventory(
  rawItems: WhatsAppParsedItem[],
  products: Product[],
  customer: Customer | null
): WhatsAppParsedItem[] {
  return rawItems.map(item => {
    const product = products.find(p => p.id === item.matchedProductId);
    if (!product) {
      return {
        ...item,
        availablePieces: 0,
        stockSufficient: false,
      };
    }

    const unit: UnitType =
      item.unit === 'bundle' && product.bundlePrice > 0
        ? 'bundle'
        : item.unit === 'piece' && product.piecePrice > 0
        ? 'piece'
        : product.bundlePrice > 0
        ? 'bundle'
        : 'piece';

    const eff = getEffectiveUnitPrice(product, unit, customer);
    const qty = Math.max(1, Math.round(item.quantity || 1));
    const pcsPerUnit = unit === 'bundle' ? Math.max(1, product.bundlePieces) : 1;
    const totalPieces = qty * pcsPerUnit;
    const lineTotal = Math.round(qty * eff.unitPrice * 100) / 100;

    return {
      ...item,
      matchedProductName: product.name,
      unit,
      bundleUnitName: product.bundleUnitName,
      bundlePieces: product.bundlePieces,
      quantity: qty,
      unitPrice: eff.unitPrice,
      totalPieces,
      lineTotal,
      availablePieces: product.stockPieces,
      stockSufficient: product.stockPieces >= totalPieces,
    };
  });
}

export function buildAutoReplyForMessage(params: {
  intent: WhatsAppMessageIntent;
  senderName: string;
  parsedItems: WhatsAppParsedItem[];
  customer: Customer | null;
  products: Product[];
  storeName: string;
  messageText: string;
}): string {
  const { intent, senderName, parsedItems, customer, products, storeName, messageText } = params;
  const greetingName = customer?.name || senderName || 'Valued Customer';
  const lower = messageText.toLowerCase();

  if (intent === 'payment') {
    const dueText = customer
      ? `Your current Khata balance on record is ${formatCurrency(customer.currentBalance)}.`
      : `Our accounts team will verify your payment shortly.`;
    return `Namaste ${greetingName}, thank you for your payment update to ${storeName}. ${dueText}`;
  }

  if (intent === 'inquiry') {
    const asksBalance = /(?:balance|udhar|khata|due|baki|pending)/i.test(lower);
    if (asksBalance && customer) {
      return `Namaste ${greetingName}, your pending Khata balance with ${storeName} is ${formatCurrency(
        customer.currentBalance
      )}${customer.creditLimit ? ` (Credit limit: ${formatCurrency(customer.creditLimit)})` : ''}. Reply anytime to place an order.`;
    }

    if (parsedItems.length > 0) {
      const lines = parsedItems
        .map(item => {
          const prod = products.find(p => p.id === item.matchedProductId);
          if (!prod) return null;
          const stockLabel =
            prod.stockPieces > 0
              ? `In Stock (${formatStockDisplay(prod.stockPieces, prod.bundlePieces, prod.bundleUnitName).text})`
              : 'Currently Out of Stock';
          const rateParts: string[] = [];
          if (prod.bundlePrice > 0) {
            const effB = getEffectiveUnitPrice(prod, 'bundle', customer);
            rateParts.push(`${formatCurrency(effB.unitPrice)}/${prod.bundleUnitName} (${prod.bundlePieces} pcs)`);
          }
          if (prod.piecePrice > 0) {
            const effP = getEffectiveUnitPrice(prod, 'piece', customer);
            rateParts.push(`${formatCurrency(effP.unitPrice)}/Pc`);
          }
          return `• ${prod.name}: ${rateParts.join(' | ')} — ${stockLabel}`;
        })
        .filter(Boolean);

      if (lines.length > 0) {
        return `Namaste ${greetingName}, live rates & stock at ${storeName}:\n${lines.join('\n')}\nReply with quantities to confirm your order!`;
      }
    }

    return `Namaste ${greetingName}, thank you for contacting ${storeName}. Please share item names and quantities (bundles/pieces) for live wholesale rates & stock availability.`;
  }

  if (intent === 'order' && parsedItems.length > 0) {
    const matched = parsedItems.filter(i => i.matchedProductId !== 'UNMATCHED');
    const shortItems = matched.filter(i => !i.stockSufficient);
    const total = matched.reduce((s, i) => s + i.lineTotal, 0);

    if (matched.length === 0) {
      return `Namaste ${greetingName}, we received your message at ${storeName}. Please confirm the exact product names & bundle/piece quantities so we can prepare your bill.`;
    }

    const summaryLines = matched.map(
      i =>
        `• ${i.matchedProductName}: ${i.quantity} ${
          i.unit === 'bundle' ? i.bundleUnitName : 'Pc'
        } (${i.totalPieces} pcs) = ${formatCurrency(i.lineTotal)}${
          i.stockSufficient ? '' : ` [Only ${i.availablePieces} pcs in stock]`
        }`
    );

    if (shortItems.length > 0) {
      return `Namaste ${greetingName}, we checked stock at ${storeName}:\n${summaryLines.join(
        '\n'
      )}\nSome items have limited stock right now. Please confirm if you'd like us to adjust quantities.`;
    }

    return `Namaste ${greetingName}, your order with ${storeName} is received!\n${summaryLines.join(
      '\n'
    )}\nEstimated Total: ${formatCurrency(total)}. Stock is reserved & syncing with POS.`;
  }

  return `Namaste ${greetingName}, thanks for messaging ${storeName}. Send your wholesale item list (e.g. "2 Bundle Gold Flake, 3 Carton Dettol") or ask for rates/stock anytime.`;
}

export function parseWhatsAppMessageLocally(params: {
  senderName: string;
  senderPhone: string;
  messageText: string;
  products: Product[];
  customers: Customer[];
  storeName: string;
  source?: 'webhook' | 'simulator' | 'manual';
  externalMessageId?: string;
}): WhatsAppInboundMessage {
  const {
    senderName,
    senderPhone,
    messageText,
    products,
    customers,
    storeName,
    source = 'manual',
    externalMessageId,
  } = params;

  const customer = findCustomerByPhone(customers, senderPhone);
  const lower = messageText.toLowerCase();

  // Split into segments by newlines, commas, semicolons, or 'and' / 'aur'
  const rawSegments = messageText
    .split(/[\n,;]+|\s+(?:and|aur|&|\+)\s+/i)
    .map(s => s.trim())
    .filter(Boolean);

  const parsedItems: WhatsAppParsedItem[] = [];
  rawSegments.forEach((seg, idx) => {
    const { product, confidence } = matchProductForSegment(seg, products);
    if (!product) return;
    const unit = detectUnitFromSegment(seg, product);
    const quantity = detectQtyFromSegment(seg);
    const eff = getEffectiveUnitPrice(product, unit, customer);
    const pcsPerUnit = unit === 'bundle' ? Math.max(1, product.bundlePieces) : 1;
    const totalPieces = quantity * pcsPerUnit;

    // Avoid duplicate product+unit lines by merging quantities
    const existingIdx = parsedItems.findIndex(
      i => i.matchedProductId === product.id && i.unit === unit
    );
    if (existingIdx > -1) {
      const existing = parsedItems[existingIdx];
      const nextQty = existing.quantity + quantity;
      const nextPieces = nextQty * pcsPerUnit;
      parsedItems[existingIdx] = {
        ...existing,
        rawText: `${existing.rawText}, ${seg}`,
        quantity: nextQty,
        totalPieces: nextPieces,
        lineTotal: Math.round(nextQty * existing.unitPrice * 100) / 100,
        stockSufficient: product.stockPieces >= nextPieces,
      };
      return;
    }

    parsedItems.push({
      id: `wa_item_${Date.now()}_${idx}`,
      rawText: seg,
      matchedProductId: product.id,
      matchedProductName: product.name,
      unit,
      bundleUnitName: product.bundleUnitName,
      bundlePieces: product.bundlePieces,
      quantity,
      unitPrice: eff.unitPrice,
      totalPieces,
      lineTotal: Math.round(quantity * eff.unitPrice * 100) / 100,
      availablePieces: product.stockPieces,
      stockSufficient: product.stockPieces >= totalPieces,
      confidence,
    });
  });

  const hasInquiryWords =
    /(\?|rate|price|bhav|kitna|kitne|kya\s+rate|stock|available|avail|hai\s+kya|balance|udhar|khata|due|baki|quote|estimate)/i.test(
      lower
    );
  const hasOrderVerb =
    /(order|send|bhej|bhejo|bhejdo|chahiye|dedo|dena|pack|dispatch|deliver|bill|nikal)/i.test(
      lower
    );
  const hasPaymentWords =
    /(paid|payment|gpay|phonepe|paytm|upi|utr|transfer|jama|bhej\s+diya)/i.test(lower);
  const hasExplicitQty = parsedItems.some(i => /\b\d{1,3}\b/.test(i.rawText));

  let intent: WhatsAppMessageIntent = 'other';
  if (hasPaymentWords && parsedItems.length === 0) {
    intent = 'payment';
  } else if (hasInquiryWords && (!hasOrderVerb || !hasExplicitQty)) {
    intent = 'inquiry';
  } else if (parsedItems.length > 0 && (hasOrderVerb || hasExplicitQty || !hasInquiryWords)) {
    intent = 'order';
  } else if (hasInquiryWords) {
    intent = 'inquiry';
  }

  const estimatedTotal =
    Math.round(parsedItems.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const now = new Date();

  const suggestedReply = buildAutoReplyForMessage({
    intent,
    senderName,
    parsedItems,
    customer,
    products,
    storeName,
    messageText,
  });

  return {
    id: `wa_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
    externalMessageId,
    senderName: customer?.name || senderName || 'WhatsApp Customer',
    senderPhone: senderPhone.trim(),
    customerId: customer?.id,
    messageText: messageText.trim(),
    receivedAt: now.toISOString(),
    formattedTime: formatDateTime(now),
    intent,
    status: 'pending_review',
    parsedItems,
    estimatedTotal,
    suggestedReply,
    stockUpdated: false,
    source,
  };
}

export function buildBillFromWhatsAppMessage(params: {
  message: WhatsAppInboundMessage;
  items: WhatsAppParsedItem[];
  customer: Customer | null;
  products: Product[];
  receiptSettings: ReceiptSettings;
  paymentMode: 'cash' | 'credit';
  staff?: StaffMember | null;
}): { bill: Bill; updatedCustomer?: Customer } {
  const { message, items, customer, products, receiptSettings, paymentMode, staff } = params;
  const validItems = items.filter(i => i.matchedProductId !== 'UNMATCHED' && i.quantity > 0);
  if (validItems.length === 0) {
    throw new Error('No matched catalog products available to generate a POS bill.');
  }

  const billItems: BillItem[] = validItems.map(item => {
    const product = products.find(p => p.id === item.matchedProductId);
    const unit = item.unit;
    const bundlePieces = product?.bundlePieces || item.bundlePieces || 1;
    const bundleUnitName = product?.bundleUnitName || item.bundleUnitName || 'Bundle';
    const pcsPerUnit = unit === 'bundle' ? Math.max(1, bundlePieces) : 1;
    const totalPieces = item.quantity * pcsPerUnit;
    const unitPrice = item.unitPrice;
    return {
      productId: item.matchedProductId,
      productName: product?.name || item.matchedProductName,
      unit,
      bundleUnitName,
      bundlePieces,
      quantity: item.quantity,
      unitPrice,
      totalPieces,
      itemTotal: Math.round(item.quantity * unitPrice * 100) / 100,
    };
  });

  const itemsTotal =
    Math.round(billItems.reduce((sum, i) => sum + i.itemTotal, 0) * 100) / 100;

  const isGstBill = Boolean(receiptSettings.enableGst);
  const gstRate = isGstBill ? receiptSettings.gstRate || 18 : 0;
  const totalGstAmount = isGstBill ? Math.round(((itemsTotal * gstRate) / 100) * 100) / 100 : 0;
  const cgstAmount = isGstBill ? Math.round((totalGstAmount / 2) * 100) / 100 : 0;
  const sgstAmount = isGstBill ? Math.round((totalGstAmount - cgstAmount) * 100) / 100 : 0;

  const previousBalance = customer?.currentBalance || 0;
  const currentBillTotal = Math.round((itemsTotal + totalGstAmount) * 100) / 100;
  const grandTotal = Math.round((currentBillTotal + previousBalance) * 100) / 100;

  const amountReceived = paymentMode === 'cash' ? currentBillTotal : 0;
  const remainingBalance = Math.max(0, Math.round((grandTotal - amountReceived) * 100) / 100);

  const now = new Date();
  const billId = `bill_wa_${now.getTime()}`;
  const billNumber = `WA-${String(now.getTime()).slice(-6)}`;

  const bill: Bill = {
    id: billId,
    billNumber,
    timestamp: now.toISOString(),
    formattedDateTime: formatDateTime(now),
    customerId: customer?.id,
    customerName: customer?.name || message.senderName || 'WhatsApp Customer',
    customerPhone: customer?.phone || message.senderPhone || '',
    items: billItems,
    itemsTotal,
    isGstBill,
    gstRate: isGstBill ? gstRate : undefined,
    cgstAmount: isGstBill ? cgstAmount : undefined,
    sgstAmount: isGstBill ? sgstAmount : undefined,
    totalGstAmount: isGstBill ? totalGstAmount : undefined,
    gstNumber: isGstBill ? receiptSettings.gstNumber : undefined,
    previousBalance,
    grandTotal,
    amountReceived,
    remainingBalance,
    paymentMode: paymentMode === 'credit' ? 'credit' : 'cash',
    staffId: staff?.id || 'staff_owner',
    staffName: staff?.name || 'WhatsApp Automation',
    staffRole: staff?.role || 'Store Owner / Admin',
    source: 'whatsapp',
    whatsappMessageId: message.id,
    notes: `Auto-generated from WhatsApp order (${message.senderPhone})`,
  };

  const updatedCustomer = customer
    ? {
        ...customer,
        currentBalance: remainingBalance,
        updatedAt: now.toISOString(),
      }
    : undefined;

  return { bill, updatedCustomer };
}

export function buildWhatsAppWebUrl(phone: string, text: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  const cleanPhone = digits.length === 10 ? `91${digits}` : digits;
  const encoded = encodeURIComponent(text);
  return cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
