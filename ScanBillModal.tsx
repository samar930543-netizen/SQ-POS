import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Product,
  Customer,
  Bill,
  CartItem,
  ReceiptSettings,
  OcrDetectedItem,
  OcrBillScanResult,
  OcrScanMode,
} from '../types';
import { soundManager } from '../utils/soundEffects';
import { getStoredStoreProfile } from '../utils/storage';
import {
  getConfiguredUnits,
  getPreferredUnit,
  hasConfiguredBundleTier,
  isUnitConfigured,
} from '../utils/unitSpecs';
import {
  formatCurrency,
  formatDateTime,
  buildUdharWhatsAppText,
  buildUdharSMSText,
  buildWhatsAppBillText,
  launchWhatsApp,
  launchSMS,
} from '../utils/formatters';
import { EditableQuantityBadge } from './EditableQuantityBadge';
import { CustomerSelectorModal } from './CustomerSelectorModal';
import {
  Camera,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  PackageCheck,
  FileText,
  Boxes,
  Plus,
  Minus,
  CheckSquare,
  Square,
  RotateCcw,
  Receipt,
  Languages,
  PenLine,
  User,
  UserPlus,
  ShoppingCart,
  Trash2,
  ChevronDown,
} from 'lucide-react';

interface ScanBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  customers: Customer[];
  receiptSettings: ReceiptSettings;
  initialMode?: OcrScanMode;
  onApplyStockUpdate: (
    updates: Array<{ productId: string; addedPieces: number; productName: string }>
  ) => void;
  onGenerateDigitalInvoice: (
    bill: Bill,
    updatedCustomer?: Customer,
    deductStockItems?: Array<{ productId: string; totalPieces: number }>
  ) => void;
  onLoadItemsToCart: (items: CartItem[]) => void;
  onAddNewCustomer: (name: string, phone: string) => Customer;
}

// Hindi / Hinglish keyword normalization map for fuzzy catalog matching
const HINDI_SYNONYMS: Record<string, string[]> = {
  'तेल': ['oil', 'mustard', 'fortune'],
  'सरसों': ['mustard', 'fortune', 'oil'],
  'साबुन': ['soap', 'dettol', 'lifebuoy'],
  'बिस्कुट': ['biscuit', 'parle', 'good', 'day'],
  'चाय': ['tea', 'tata'],
  'पत्ती': ['tea', 'tata'],
  'डिटर्जेंट': ['detergent', 'surf', 'rin'],
  'सर्फ': ['surf', 'excel'],
  'रिन': ['rin', 'detergent'],
  'सिगरेट': ['gold', 'flake', 'classic'],
  'कोक': ['coca', 'cola'],
  'कोल्ड': ['coca', 'cola'],
  'चीनी': ['sugar'],
  'आटा': ['atta', 'flour'],
  'नमक': ['salt'],
  'दाल': ['dal', 'lentil'],
};

// Generate a realistic printed wholesale FMCG purchase invoice PNG
function generateSampleBillPng(): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1100;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 800, 1100);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 780, 1080);

  ctx.fillStyle = '#0f172a';
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(25, 25, 750, 110, 8);
    ctx.fill();
  } else {
    ctx.fillRect(25, 25, 750, 110);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('METRO FMCG WHOLESALE DISTRIBUTORS', 400, 68);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillText('SUPPLIER TAX INVOICE / DELIVERY CHALLAN • GSTIN: 07AAAFM1234K1Z2', 400, 96);
  ctx.fillText('MAIN WHOLESALE MARKET, SECTOR-4, NEW DELHI | TEL: +91 98765 43210', 400, 116);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('INVOICE NO: #INV-2026-8841', 40, 175);
  ctx.fillText('DATE: 11-NOV-2026', 560, 175);

  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.fillText('CONSIGNEE / BUYER: SQ ENTERPRISES', 40, 205);
  ctx.font = '14px Arial, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('DELIVERY: WHOLESALE STORE / SHOP COUNTER', 40, 230);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(35, 250);
  ctx.lineTo(765, 250);
  ctx.stroke();

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(35, 265, 730, 36);

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillText('#', 50, 288);
  ctx.fillText('PRODUCT DESCRIPTION', 90, 288);
  ctx.fillText('UNIT TYPE', 430, 288);
  ctx.fillText('QTY', 540, 288);
  ctx.fillText('RATE (₹)', 610, 288);
  ctx.fillText('AMOUNT (₹)', 690, 288);

  const items = [
    { num: '1', name: 'Gold Flake King (50 pcs/bundle)', unit: 'Bundle (50 pcs)', qty: '4', rate: '4,350.00', amt: '17,400.00' },
    { num: '2', name: 'Dettol Original Soap 75g (48 pcs/carton)', unit: 'Carton (48 pcs)', qty: '2', rate: '1,820.00', amt: '3,640.00' },
    { num: '3', name: 'Classic Regular Cigarettes', unit: 'Bundle (50 pcs)', qty: '3', rate: '4,600.00', amt: '13,800.00' },
    { num: '4', name: 'Parle-G Gold Pack (96 pcs/carton)', unit: 'Carton (96 pcs)', qty: '5', rate: '860.00', amt: '4,300.00' },
    { num: '5', name: 'Tata Tea Gold 250g', unit: 'Carton (20 pcs)', qty: '2', rate: '2,800.00', amt: '5,600.00' },
  ];

  let y = 330;
  items.forEach((item, idx) => {
    ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(35, y - 22, 730, 40);

    ctx.fillStyle = '#0f172a';
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText(item.num, 50, y + 2);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText(item.name, 90, y + 2);
    ctx.font = '14px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(item.unit, 430, y + 2);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(item.qty, 545, y + 2);
    ctx.font = '14px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(item.rate, 610, y + 2);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(item.amt, 690, y + 2);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(35, y + 18);
    ctx.lineTo(765, y + 18);
    ctx.stroke();

    y += 45;
  });

  y = 590;
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(35, y);
  ctx.lineTo(765, y);
  ctx.stroke();

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SUBTOTAL:', 630, y + 35);
  ctx.fillText('₹44,740.00', 760, y + 35);

  ctx.fillStyle = '#0f172a';
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(420, y + 70, 350, 46, 6);
    ctx.fill();
  } else {
    ctx.fillRect(420, y + 70, 350, 46);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL PAYABLE:', 440, y + 99);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('₹44,740.00', 750, y + 99);

  return canvas.toDataURL('image/png');
}

// Generate a realistic handwritten-style bilingual English + Hindi (Devanagari) paper slip PNG
function generateSampleHandwrittenBilingualPng(): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 820;
  canvas.height = 980;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Warm cream ruled paper background
  ctx.fillStyle = '#fdf8ec';
  ctx.fillRect(0, 0, 820, 980);

  // Notebook horizontal ruled lines
  ctx.strokeStyle = '#d6e4f0';
  ctx.lineWidth = 1.5;
  for (let ly = 130; ly < 940; ly += 48) {
    ctx.beginPath();
    ctx.moveTo(30, ly);
    ctx.lineTo(790, ly);
    ctx.stroke();
  }

  // Notebook red left margin line
  ctx.strokeStyle = '#e89999';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(85, 25);
  ctx.lineTo(85, 955);
  ctx.stroke();

  // Blue ballpoint ink style
  const ink = '#1e3a8a';
  const darkInk = '#172554';

  ctx.fillStyle = darkInk;
  ctx.font = 'italic bold 26px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('कच्चा बिल / Manual Paper Slip', 430, 62);

  ctx.fillStyle = ink;
  ctx.font = 'italic 18px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('नाम (Party): Ramesh Kirana Store', 105, 114);
  ctx.fillText('Date: 12/11/2026', 590, 114);
  ctx.fillText('Mob: 9876543210     Slip No: #M-204', 105, 162);

  // Column headers underlined
  ctx.font = 'italic bold 19px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.fillText('सामान / Item Description', 105, 224);
  ctx.fillText('Qty', 450, 224);
  ctx.fillText('Rate', 555, 224);
  ctx.fillText('Total ₹', 675, 224);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, 234);
  ctx.lineTo(770, 234);
  ctx.stroke();

  const slipRows = [
    { desc: '1. चीनी (Sugar) Loose', qty: '10 Kg', rate: '45', total: '450' },
    { desc: '2. Fortune सरसों तेल 1L', qty: '2 Peti', rate: '2240', total: '4480' },
    { desc: '3. Dettol साबुन 75g', qty: '5 नग', rate: '42', total: '210' },
    { desc: '4. Parle-G बिस्कुट', qty: '3 Box', rate: '860', total: '2580' },
    { desc: '5. चाय पत्ती (Tata Tea 250g)', qty: '4 Pkt', rate: '150', total: '600' },
    { desc: '6. आटा (Chakki Atta 10kg)', qty: '2 बोरा', rate: '380', total: '760' },
  ];

  let ry = 290;
  ctx.font = 'italic 21px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  slipRows.forEach((row, idx) => {
    const jitter = idx % 2 === 0 ? -1 : 1.5;
    ctx.fillStyle = ink;
    ctx.fillText(row.desc, 105, ry + jitter);
    ctx.fillText(row.qty, 445, ry + jitter);
    ctx.fillText(row.rate, 560, ry + jitter);
    ctx.fillText(row.total, 680, ry + jitter);
    ry += 68;
  });

  // Totals handwritten at bottom
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(390, 720);
  ctx.lineTo(770, 720);
  ctx.stroke();

  ctx.font = 'italic bold 23px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.fillStyle = darkInk;
  ctx.fillText('कुल (Total):', 440, 760);
  ctx.fillText('₹ 9,080/-', 655, 760);

  ctx.font = 'italic 20px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.fillStyle = '#0f5132';
  ctx.fillText('जमा (Cash Paid): ₹ 6,000/-', 410, 815);

  ctx.fillStyle = '#9f1239';
  ctx.font = 'italic bold 20px "Comic Sans MS", "Segoe Print", Arial, sans-serif';
  ctx.fillText('बाकी (Balance Udhar): ₹ 3,080/-', 385, 865);

  return canvas.toDataURL('image/png');
}

export const ScanBillModal: React.FC<ScanBillModalProps> = ({
  isOpen,
  onClose,
  products,
  customers,
  receiptSettings,
  initialMode = 'invoice',
  onApplyStockUpdate,
  onGenerateDigitalInvoice,
  onLoadItemsToCart,
  onAddNewCustomer,
}) => {
  const [scanMode, setScanMode] = useState<OcrScanMode>(initialMode);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanElapsedSec, setScanElapsedSec] = useState(0);
  const [scanDurationMs, setScanDurationMs] = useState<number | null>(null);
  const [scanResult, setScanResult] = useState<OcrBillScanResult | null>(null);
  const [detectedItems, setDetectedItems] = useState<OcrDetectedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Digital Invoice Mode state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [slipCustomerName, setSlipCustomerName] = useState<string>('');
  const [slipCustomerPhone, setSlipCustomerPhone] = useState<string>('');
  const [isGstEnabled, setIsGstEnabled] = useState<boolean>(receiptSettings.enableGst ?? false);
  const [deductCatalogStock, setDeductCatalogStock] = useState<boolean>(true);
  const [amountPaidInput, setAmountPaidInput] = useState<string>('');
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeScanIdRef = useRef<number>(0);
  const lastPayloadRef = useRef<{ base64: string; mime: string } | null>(null);

  // Sync mode & GST toggle when modal opens
  useEffect(() => {
    if (isOpen) {
      setScanMode(initialMode);
      setIsGstEnabled(receiptSettings.enableGst ?? false);
    }
  }, [isOpen, initialMode, receiptSettings.enableGst]);

  // Elapsed timer while scanning
  useEffect(() => {
    if (!isScanning) {
      setScanElapsedSec(0);
      return;
    }
    const interval = setInterval(() => {
      setScanElapsedSec(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isScanning]);

  // Abort in-flight OCR call if modal closes or unmounts
  useEffect(() => {
    if (!isOpen && abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsScanning(false);
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [isOpen]);

  // Selected customer object
  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Digital invoice monetary calculations
  const enabledItems = useMemo(
    () =>
      detectedItems.filter(i =>
        scanMode === 'restock'
          ? i.enabled && i.selectedProductId && i.selectedProductId !== 'SKIP'
          : i.enabled && i.productName.trim().length > 0
      ),
    [detectedItems, scanMode]
  );

  const invoiceSubtotal = useMemo(() => {
    return enabledItems.reduce((sum, i) => {
      const lineTotal =
        typeof i.totalPrice === 'number' && Number.isFinite(i.totalPrice)
          ? i.totalPrice
          : (i.quantity || 1) * (i.unitPrice || 0);
      return sum + lineTotal;
    }, 0);
  }, [enabledItems]);

  const gstRate = receiptSettings.gstRate || 18;
  const totalGstAmount = isGstEnabled ? (invoiceSubtotal * gstRate) / 100 : 0;
  const previousBalance = selectedCustomer ? selectedCustomer.currentBalance : 0;
  const invoiceGrandTotal = Math.round((invoiceSubtotal + totalGstAmount + previousBalance) * 100) / 100;

  const parsedAmountPaid =
    amountPaidInput.trim() === '' ? invoiceGrandTotal : Math.max(0, parseFloat(amountPaidInput) || 0);
  const remainingBalance = Math.max(0, Math.round((invoiceGrandTotal - parsedAmountPaid) * 100) / 100);

  if (!isOpen) return null;

  // Client-side image pre-compression & orientation optimization
  const compressImageForOcr = (file: File): Promise<{ dataUrl: string; mime: string }> => {
    return new Promise((resolve, reject) => {
      if (file.size === 0) {
        reject(new Error('Selected file is empty.'));
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        reject(new Error('File exceeds 20 MB limit. Please select a smaller bill image or PDF.'));
        return;
      }

      if (!file.type.startsWith('image/') || file.type.includes('svg')) {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            dataUrl: typeof reader.result === 'string' ? reader.result : '',
            mime: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          });
        };
        reader.onerror = () => reject(new Error('Unable to read the selected file.'));
        reader.readAsDataURL(file);
        return;
      }

      let settled = false;
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      const fallbackReadRaw = () => {
        const reader = new FileReader();
        reader.onload = () => {
          if (settled) return;
          settled = true;
          resolve({
            dataUrl: typeof reader.result === 'string' ? reader.result : '',
            mime: file.type || 'image/jpeg',
          });
        };
        reader.onerror = () => {
          if (settled) return;
          settled = true;
          reject(new Error('Could not read image file.'));
        };
        reader.readAsDataURL(file);
      };

      const guardTimer = setTimeout(() => {
        if (!settled) {
          URL.revokeObjectURL(objectUrl);
          fallbackReadRaw();
        }
      }, 5000);

      img.onload = () => {
        clearTimeout(guardTimer);
        URL.revokeObjectURL(objectUrl);
        if (settled) return;

        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIM = 1280;

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            fallbackReadRaw();
            return;
          }

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressedUrl = canvas.toDataURL('image/jpeg', 0.78);
          settled = true;
          resolve({ dataUrl: compressedUrl, mime: 'image/jpeg' });
        } catch {
          fallbackReadRaw();
        }
      };

      img.onerror = () => {
        clearTimeout(guardTimer);
        URL.revokeObjectURL(objectUrl);
        if (!settled) {
          fallbackReadRaw();
        }
      };

      img.src = objectUrl;
    });
  };

  // Bilingual fuzzy match OCR title (supports English + Hindi Devanagari synonyms)
  const findBestMatchedProduct = (ocrName: string, originalText?: string): Product | null => {
    const combinedRaw = `${ocrName || ''} ${originalText || ''}`.trim();
    if (!combinedRaw) return null;

    // Expand Hindi tokens to English equivalents for catalog search
    let expanded = combinedRaw.toLowerCase();
    for (const [hindiWord, engWords] of Object.entries(HINDI_SYNONYMS)) {
      if (combinedRaw.includes(hindiWord)) {
        expanded += ' ' + engWords.join(' ');
      }
    }

    const cleanOcr = expanded.replace(/[^a-z0-9 ]/g, ' ').trim();
    if (!cleanOcr) return null;

    const exact = products.find(p => p.name.toLowerCase().trim() === cleanOcr);
    if (exact) return exact;

    const sub = products.find(p => {
      const pLower = p.name.toLowerCase().trim();
      return cleanOcr.includes(pLower) || pLower.includes(cleanOcr);
    });
    if (sub) return sub;

    const stopWords = new Set([
      'bundle', 'carton', 'peti', 'case', 'box', 'boxes', 'pcs', 'piece', 'pieces',
      'pkt', 'packet', 'packets', 'doz', 'dozen', 'nos', 'kg', 'g', 'gm', 'gms',
      'ml', 'ltr', 'of', 'and', 'the', 'for', 'regular', 'original', 'gold', 'classic', 'loose'
    ]);

    const getKeywords = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1);

    const ocrKeywords = getKeywords(cleanOcr);
    const ocrCoreTokens = ocrKeywords.filter(t => !stopWords.has(t) || t.length > 4);

    let bestProduct: Product | null = null;
    let highestScore = 0;

    for (const p of products) {
      const pKeywords = getKeywords(p.name);
      const pCoreTokens = pKeywords.filter(t => !stopWords.has(t) || t.length > 4);

      let coreMatches = 0;
      for (const token of ocrCoreTokens) {
        if (
          pCoreTokens.some(
            pt =>
              pt === token ||
              (token.length > 3 && pt.startsWith(token)) ||
              (pt.length > 3 && token.startsWith(pt))
          )
        ) {
          coreMatches += 2;
        }
      }

      let generalMatches = 0;
      for (const token of ocrKeywords) {
        if (pKeywords.includes(token)) {
          generalMatches += 1;
        }
      }

      const totalScore = coreMatches * 2 + generalMatches;
      if (totalScore > highestScore) {
        highestScore = totalScore;
        bestProduct = p;
      }
    }

    return highestScore >= 2 ? bestProduct : null;
  };

  // Match extracted customer name/phone with Khata customers
  const matchCustomerFromSlip = (name?: string, phone?: string): Customer | null => {
    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 8) {
      const byPhone = customers.find(c => c.phone.replace(/\D/g, '').endsWith(cleanPhone));
      if (byPhone) return byPhone;
    }
    if (name && name.trim().length > 2) {
      const q = name.trim().toLowerCase();
      const byName = customers.find(
        c => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase())
      );
      if (byName) return byName;
    }
    return null;
  };

  // Cancel active scan cleanly
  const handleCancelScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeScanIdRef.current += 1;
    setIsScanning(false);
    setErrorMsg('OCR scan was cancelled. Tap Retry or choose another bill photo.');
    setCanRetry(!!lastPayloadRef.current);
  };

  // Send image/PDF to /api/ocr/scan-bill
  const handleProcessImage = async (
    base64Data: string,
    mime: string,
    overrideMode?: OcrScanMode
  ) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const activeMode = overrideMode || scanMode;
    const scanId = ++activeScanIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    lastPayloadRef.current = { base64: base64Data, mime };

    const clientTimeoutMs = 58_000;
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, clientTimeoutMs);

    const clientStart = performance.now();
    setImagePreview(base64Data);
    setIsScanning(true);
    setScanElapsedSec(0);
    setScanDurationMs(null);
    setErrorMsg(null);
    setCanRetry(false);
    setScanResult(null);
    soundManager.playScannerBeep();

    try {
      const response = await fetch('/api/ocr/scan-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: mime,
          mode: activeMode,
          existingProducts: products.map(p => ({
            id: p.id,
            name: p.name,
            bundleUnitName: p.bundleUnitName,
            bundlePieces: p.bundlePieces,
          })),
        }),
      });

      const rawText = await response.text();
      let resJson: any = null;
      try {
        resJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        throw new Error(
          response.ok
            ? 'Received unexpected response format from OCR server.'
            : `OCR server returned HTTP ${response.status}. Please retry shortly.`
        );
      }

      if (activeScanIdRef.current !== scanId) return;

      if (!response.ok || !resJson?.success) {
        const err = new Error(resJson?.error || `Failed to scan bill (HTTP ${response.status})`);
        (err as any).retryable = resJson?.retryable ?? response.status >= 500;
        throw err;
      }

      const ocrData = resJson.data;

      // Smart map extracted items (supports both catalog items & custom handwritten items)
      const mappedItems: OcrDetectedItem[] = (ocrData.items || []).map(
        (item: any, idx: number) => {
          const matched = findBestMatchedProduct(item.productName, item.originalText);
          let resolvedUnitType: 'bundle' | 'piece' =
            item.unitType === 'bundle' ? 'bundle' : 'piece';
          if (matched && !isUnitConfigured(matched, resolvedUnitType)) {
            resolvedUnitType = getPreferredUnit(matched);
          }
          const isBundle = resolvedUnitType === 'bundle';
          const qty = Math.max(1, Number(item.quantity) || 1);
          const bundleMultiplier =
            matched?.bundlePieces || item.bundlePieces || (isBundle ? 50 : 1);
          const piecesToAdd = isBundle ? qty * bundleMultiplier : qty;

          // Fallback to catalog price if OCR rate wasn't written on slip
          let unitPrice = Number(item.unitPrice) || 0;
          if (unitPrice === 0 && matched) {
            unitPrice = isBundle ? matched.bundlePrice : matched.piecePrice;
          }
          let totalPrice = Number(item.totalPrice) || 0;
          if (totalPrice === 0 && unitPrice > 0) {
            totalPrice = Math.round(qty * unitPrice * 100) / 100;
          }

          return {
            id: `ocr_item_${idx}_${Date.now()}`,
            productName: item.productName || 'Item',
            originalText: item.originalText,
            quantity: qty,
            unitType: resolvedUnitType,
            unitName:
              item.unitName ||
              (isBundle ? matched?.bundleUnitName || 'Bundle' : 'Piece'),
            bundlePieces: bundleMultiplier,
            unitPrice,
            totalPrice,
            confidence: item.confidence || 0.9,
            selectedProductId: matched ? matched.id : 'CUSTOM',
            piecesToAdd,
            enabled: true, // Always enable extracted items in Digital Invoice mode; restock filter checks selectedProductId
          };
        }
      );

      // Match or populate customer details extracted from manual slip
      const matchedCust = matchCustomerFromSlip(ocrData.customerName, ocrData.customerPhone);
      if (matchedCust) {
        setSelectedCustomerId(matchedCust.id);
        setSlipCustomerName(matchedCust.name);
        setSlipCustomerPhone(matchedCust.phone);
      } else {
        setSelectedCustomerId('');
        setSlipCustomerName(ocrData.customerName || '');
        setSlipCustomerPhone(ocrData.customerPhone || '');
      }

      if (typeof ocrData.amountPaid === 'number' && ocrData.amountPaid >= 0) {
        setAmountPaidInput(String(ocrData.amountPaid));
      } else {
        setAmountPaidInput('');
      }

      setScanDurationMs(resJson.processingTimeMs || Math.round(performance.now() - clientStart));
      setScanResult({
        vendorName: ocrData.vendorName || 'Manual Paper Slip',
        customerName: ocrData.customerName,
        customerPhone: ocrData.customerPhone,
        invoiceNumber: ocrData.invoiceNumber || `SLIP-${Date.now().toString().slice(-4)}`,
        invoiceDate: ocrData.invoiceDate || new Date().toLocaleDateString(),
        totalAmount: ocrData.totalAmount,
        amountPaid: ocrData.amountPaid,
        detectedLanguage: ocrData.detectedLanguage || 'english',
        isHandwritten: Boolean(ocrData.isHandwritten),
        items: mappedItems,
      });
      setDetectedItems(mappedItems);
      soundManager.playCheckoutSuccess();
    } catch (err: any) {
      if (activeScanIdRef.current !== scanId) return;
      console.error('OCR Processing error:', err);

      if (err?.name === 'AbortError') {
        if (didTimeout) {
          setErrorMsg(
            'Scan timed out after 58 seconds to prevent hanging. Please tap Retry or try a sharper, cropped photo.'
          );
          setCanRetry(true);
        }
        return;
      }

      setErrorMsg(
        err.message ||
          'Could not extract text from this bill photo. Please try again with a clearer, well-lit image.'
      );
      setCanRetry(err?.retryable !== false);
    } finally {
      clearTimeout(timeoutId);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (activeScanIdRef.current === scanId) {
        setIsScanning(false);
      }
    }
  };

  const handleRetryScan = () => {
    if (!lastPayloadRef.current) return;
    soundManager.playMechanicalClick();
    handleProcessImage(lastPayloadRef.current.base64, lastPayloadRef.current.mime);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const { dataUrl, mime } = await compressImageForOcr(file);
      if (dataUrl) {
        handleProcessImage(dataUrl, mime);
      }
    } catch (err: any) {
      console.error('Image preparation error:', err);
      setErrorMsg(err?.message || 'Unable to process the selected file. Please try a JPG or PNG bill photo.');
      setCanRetry(false);
    }
  };

  const handleLoadSampleBill = () => {
    soundManager.playMechanicalClick();
    const samplePng = generateSampleBillPng();
    if (samplePng) {
      handleProcessImage(samplePng, 'image/png');
    }
  };

  const handleLoadHandwrittenBilingualSample = () => {
    soundManager.playMechanicalClick();
    setScanMode('invoice');
    const samplePng = generateSampleHandwrittenBilingualPng();
    if (samplePng) {
      handleProcessImage(samplePng, 'image/png', 'invoice');
    }
  };

  const handleToggleAll = (enable: boolean) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev => prev.map(i => ({ ...i, enabled: enable })));
  };

  const handleToggleItem = (itemId: string) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev =>
      prev.map(i => (i.id === itemId ? { ...i, enabled: !i.enabled } : i))
    );
  };

  const handleAdjustQty = (itemId: string, delta: number) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;
        const newQty = Math.max(1, item.quantity + delta);
        const matched = products.find(p => p.id === item.selectedProductId);
        const multiplier = matched?.bundlePieces || item.bundlePieces || 1;
        const pieces = item.unitType === 'bundle' ? newQty * multiplier : newQty;
        const rate = item.unitPrice || 0;
        return {
          ...item,
          quantity: newQty,
          piecesToAdd: pieces,
          totalPrice: rate > 0 ? Math.round(newQty * rate * 100) / 100 : item.totalPrice,
        };
      })
    );
  };

  const handleSetQty = (itemId: string, newQtyInput: number) => {
    setDetectedItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;
        const newQty = Math.max(1, Math.floor(newQtyInput));
        const matched = products.find(p => p.id === item.selectedProductId);
        const multiplier = matched?.bundlePieces || item.bundlePieces || 1;
        const pieces = item.unitType === 'bundle' ? newQty * multiplier : newQty;
        const rate = item.unitPrice || 0;
        return {
          ...item,
          quantity: newQty,
          piecesToAdd: pieces,
          totalPrice: rate > 0 ? Math.round(newQty * rate * 100) / 100 : item.totalPrice,
        };
      })
    );
  };

  const handleUpdateItemField = (
    itemId: string,
    patch: Partial<Pick<OcrDetectedItem, 'productName' | 'unitName' | 'unitPrice' | 'totalPrice'>>
  ) => {
    setDetectedItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;
        const next = { ...item, ...patch };
        if (patch.unitPrice !== undefined) {
          next.totalPrice = Math.round((next.quantity || 1) * (patch.unitPrice || 0) * 100) / 100;
        } else if (patch.totalPrice !== undefined && next.quantity > 0) {
          next.unitPrice = Math.round(((patch.totalPrice || 0) / next.quantity) * 100) / 100;
        }
        return next;
      })
    );
  };

  const handleToggleUnitType = (itemId: string) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;
        const matched = products.find(p => p.id === item.selectedProductId);
        if (matched && getConfiguredUnits(matched).length <= 1) {
          return item;
        }
        const multiplier = matched?.bundlePieces || item.bundlePieces || 1;
        const newUnit: 'bundle' | 'piece' = item.unitType === 'bundle' ? 'piece' : 'bundle';
        const newName =
          newUnit === 'bundle' ? matched?.bundleUnitName || 'Bundle' : 'Piece';
        const pieces = newUnit === 'bundle' ? item.quantity * multiplier : item.quantity;
        return {
          ...item,
          unitType: newUnit,
          unitName: newName,
          piecesToAdd: pieces,
        };
      })
    );
  };

  const handleChangeMappedProduct = (itemId: string, newProductId: string) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;

        const matched = products.find(p => p.id === newProductId);
        if (!matched) {
          return {
            ...item,
            selectedProductId: newProductId,
            enabled: newProductId !== 'SKIP',
          };
        }

        const resolvedUnit: 'bundle' | 'piece' = isUnitConfigured(matched, item.unitType)
          ? item.unitType
          : getPreferredUnit(matched);
        const isBundle = resolvedUnit === 'bundle';
        const bundleMultiplier = matched.bundlePieces || item.bundlePieces || 1;
        const pieces = isBundle ? item.quantity * bundleMultiplier : item.quantity;
        const fallbackRate = item.unitPrice || (isBundle ? matched.bundlePrice : matched.piecePrice);

        return {
          ...item,
          selectedProductId: newProductId,
          unitType: resolvedUnit,
          unitName: isBundle ? matched.bundleUnitName || 'Bundle' : 'Piece',
          bundlePieces: bundleMultiplier,
          piecesToAdd: pieces,
          unitPrice: fallbackRate,
          totalPrice: Math.round(item.quantity * fallbackRate * 100) / 100,
          enabled: true,
        };
      })
    );
  };

  const handleAddBlankItem = () => {
    soundManager.playMechanicalClick();
    const newItem: OcrDetectedItem = {
      id: `ocr_manual_${Date.now()}`,
      productName: '',
      quantity: 1,
      unitType: 'piece',
      unitName: 'Piece',
      bundlePieces: 1,
      unitPrice: 0,
      totalPrice: 0,
      confidence: 1,
      selectedProductId: 'CUSTOM',
      piecesToAdd: 1,
      enabled: true,
    };
    setDetectedItems(prev => [...prev, newItem]);
  };

  const handleRemoveItem = (itemId: string) => {
    soundManager.playMechanicalClick();
    setDetectedItems(prev => prev.filter(i => i.id !== itemId));
  };

  // Save typed slip customer into Khata
  const handleSaveSlipCustomerToKhata = () => {
    if (!slipCustomerName.trim()) return;
    soundManager.playScannerBeep();
    const created = onAddNewCustomer(slipCustomerName.trim(), slipCustomerPhone.trim());
    setSelectedCustomerId(created.id);
    setSuccessToast(`Saved "${created.name}" to Khata!`);
    setTimeout(() => setSuccessToast(null), 1800);
  };

  // Restock calculations
  const activeItemsToRestock = detectedItems.filter(
    i => i.enabled && i.selectedProductId && i.selectedProductId !== 'SKIP' && i.selectedProductId !== 'CUSTOM'
  );
  const totalPiecesRestocked = activeItemsToRestock.reduce((sum, i) => sum + i.piecesToAdd, 0);

  // Confirm Inventory Restock
  const handleConfirmStockUpdate = () => {
    if (activeItemsToRestock.length === 0) return;
    soundManager.playCheckoutSuccess();

    const updates = activeItemsToRestock.map(item => {
      const p = products.find(prod => prod.id === item.selectedProductId);
      return {
        productId: item.selectedProductId,
        addedPieces: item.piecesToAdd,
        productName: p ? p.name : item.productName,
      };
    });

    onApplyStockUpdate(updates);
    setSuccessToast(`Stock updated! +${totalPiecesRestocked} pieces added.`);
    setTimeout(() => {
      setSuccessToast(null);
      onClose();
    }, 1000);
  };

  // Convert scanned items to POS CartItems and load into Cart
  const handleImportToCart = () => {
    const validItems = detectedItems.filter(i => i.enabled && i.productName.trim());
    if (validItems.length === 0) return;

    soundManager.playCheckoutSuccess();
    const cartItems: CartItem[] = validItems.map((item, idx) => {
      const matched = products.find(p => p.id === item.selectedProductId);
      const unitPrice =
        Number(item.unitPrice) ||
        (matched ? (item.unitType === 'bundle' ? matched.bundlePrice : matched.piecePrice) : 0);
      const itemTotal =
        typeof item.totalPrice === 'number' && item.totalPrice > 0
          ? item.totalPrice
          : Math.round(item.quantity * unitPrice * 100) / 100;
      const bundlePieces = matched?.bundlePieces || item.bundlePieces || 1;
      const totalPieces = item.unitType === 'bundle' ? item.quantity * bundlePieces : item.quantity;

      return {
        productId: matched ? matched.id : `ocr_custom_${Date.now()}_${idx}`,
        productName: item.productName.trim(),
        unit: item.unitType,
        bundleUnitName: item.unitName || matched?.bundleUnitName || 'Bundle',
        bundlePieces,
        quantity: item.quantity,
        unitPrice,
        totalPieces,
        itemTotal,
      };
    });

    onLoadItemsToCart(cartItems);
    onClose();
  };

  // Generate Structured Digital Invoice directly from scanned paper slip
  const handleCreateDigitalInvoice = () => {
    const validItems = detectedItems.filter(i => i.enabled && i.productName.trim());
    if (validItems.length === 0) return;

    soundManager.playCheckoutSuccess();

    const now = new Date();
    const formattedDateTime = formatDateTime(now);
    const billNumber = 'SQ-' + Date.now().toString().slice(-6);

    const customerName =
      selectedCustomer?.name || slipCustomerName.trim() || 'Walk-in Customer';
    const customerPhone =
      selectedCustomer?.phone || slipCustomerPhone.trim() || '';

    const billItems = validItems.map((item, idx) => {
      const matched = products.find(p => p.id === item.selectedProductId);
      const unitPrice = Number(item.unitPrice) || 0;
      const itemTotal =
        typeof item.totalPrice === 'number' && item.totalPrice >= 0
          ? item.totalPrice
          : Math.round(item.quantity * unitPrice * 100) / 100;
      const bundlePieces = matched?.bundlePieces || item.bundlePieces || 1;
      const totalPieces = item.unitType === 'bundle' ? item.quantity * bundlePieces : item.quantity;

      return {
        productId: matched ? matched.id : `ocr_custom_${Date.now()}_${idx}`,
        productName: item.productName.trim(),
        unit: item.unitType,
        bundleUnitName: item.unitName || matched?.bundleUnitName || 'Bundle',
        bundlePieces,
        quantity: item.quantity,
        unitPrice,
        totalPieces,
        itemTotal,
      };
    });

    const itemsTotal = billItems.reduce((sum, i) => sum + i.itemTotal, 0);
    const gstAmt = isGstEnabled ? (itemsTotal * gstRate) / 100 : 0;
    const cgstAmt = gstAmt / 2;
    const sgstAmt = gstAmt / 2;
    const prevBal = selectedCustomer ? selectedCustomer.currentBalance : 0;
    const grandTotal = Math.round((itemsTotal + gstAmt + prevBal) * 100) / 100;
    const amountReceived =
      amountPaidInput.trim() === '' ? grandTotal : Math.max(0, parseFloat(amountPaidInput) || 0);
    const remainingBal = Math.max(0, Math.round((grandTotal - amountReceived) * 100) / 100);

    const bill: Bill = {
      id: 'bill_' + Date.now(),
      billNumber,
      timestamp: now.toISOString(),
      formattedDateTime,
      customerId: selectedCustomer?.id,
      customerName,
      customerPhone,
      items: billItems,
      itemsTotal,
      isGstBill: isGstEnabled,
      gstRate: isGstEnabled ? gstRate : undefined,
      cgstAmount: isGstEnabled ? cgstAmt : undefined,
      sgstAmount: isGstEnabled ? sgstAmt : undefined,
      totalGstAmount: isGstEnabled ? gstAmt : undefined,
      gstNumber: isGstEnabled ? receiptSettings.gstNumber || '07AABCS1429B1Z1' : undefined,
      previousBalance: prevBal,
      grandTotal,
      amountReceived,
      remainingBalance: remainingBal,
      paymentMode:
        amountReceived >= grandTotal ? 'cash' : amountReceived > 0 ? 'partial' : 'credit',
      notes: scanResult?.isHandwritten
        ? `Digitized from ${scanResult.detectedLanguage || 'bilingual'} handwritten slip (${scanResult.invoiceNumber || 'Paper Slip'})`
        : `Digitized via OCR (${scanResult?.invoiceNumber || 'Scanned Bill'})`,
    };

    let updatedCustomer: Customer | undefined;
    if (selectedCustomer) {
      updatedCustomer = {
        ...selectedCustomer,
        currentBalance: remainingBal,
        updatedAt: now.toISOString(),
      };
    }

    // Trigger Udhar WhatsApp/SMS notifications if enabled and customer phone present
    if (remainingBal > 0 && customerPhone) {
      const newCreditAdded =
        remainingBal > prevBal
          ? remainingBal - prevBal
          : amountReceived < itemsTotal
          ? itemsTotal - amountReceived
          : remainingBal;
      const alertPayload = {
        customerName,
        billNumber,
        formattedDateTime,
        newCreditAdded: Math.max(0, newCreditAdded),
        totalRemainingBalance: remainingBal,
      };
      const storeProfile = getStoredStoreProfile();
      if (receiptSettings.autoUdharWhatsApp ?? true) {
        launchWhatsApp(customerPhone, buildUdharWhatsAppText(alertPayload, storeProfile));
      }
      if (receiptSettings.autoUdharSMS ?? true) {
        setTimeout(() => {
          launchSMS(customerPhone, buildUdharSMSText(alertPayload, storeProfile));
        }, 350);
      }
    } else if (receiptSettings.autoSendWhatsApp && customerPhone) {
      launchWhatsApp(customerPhone, buildWhatsAppBillText(bill, getStoredStoreProfile()));
    }

    const deductItems = deductCatalogStock
      ? billItems
          .filter(i => !i.productId.startsWith('ocr_custom_'))
          .map(i => ({ productId: i.productId, totalPieces: i.totalPieces }))
      : [];

    onGenerateDigitalInvoice(bill, updatedCustomer, deductItems);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-4xl my-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/20 text-purple-400">
              <Camera className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white tracking-wide flex flex-wrap items-center gap-2">
                <span>BILINGUAL OCR SCANNER</span>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30 font-semibold flex items-center gap-1">
                  <Languages className="w-3 h-3" />
                  English + हिंदी • Handwritten
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Convert handwritten or printed English &amp; Hindi bills into structured digital invoices or stock updates
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="Close OCR Scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Bar */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setScanMode('invoice');
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                scanMode === 'invoice'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Paper Slip &rarr; Digital Invoice</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setScanMode('restock');
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                scanMode === 'restock'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Supplier Bill &rarr; Restock</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-400 hidden md:inline">
            {scanMode === 'invoice'
              ? 'Extracts items, qty, rates & party details into an instant GST/Non-GST digital bill'
              : 'Matches vendor invoice lines to inventory catalog & adds stock pieces'}
          </span>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* SECTION 1: PHOTO UPLOAD & CAPTURE CONTROLS */}
          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Capture or Upload Paper Bill (English / हिंदी)
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Supports handwritten kachi parchi, manual notebooks, thermal slips, JPG/PNG &amp; PDF bills
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="file"
                  ref={cameraInputRef}
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-900/40 transition active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Snap Photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition active:scale-95"
                >
                  <Upload className="w-4 h-4 text-blue-400" />
                  <span>Upload Image / PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadHandwrittenBilingualSample}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-bold text-xs border border-blue-500/40 transition active:scale-95"
                  title="Test OCR on a handwritten-style Hindi & English manual paper slip"
                >
                  <PenLine className="w-3.5 h-3.5 text-blue-400" />
                  <span>Demo Hindi/EN Slip</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadSampleBill}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 font-bold text-xs border border-amber-500/40 transition active:scale-95"
                  title="Test OCR on a printed Wholesale FMCG Bill"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Demo Printed Bill</span>
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div className="leading-relaxed">{errorMsg}</div>
                </div>
                {canRetry && lastPayloadRef.current && !isScanning && (
                  <button
                    type="button"
                    onClick={handleRetryScan}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] transition active:scale-95"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}

            {imagePreview && (
              <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-900 flex justify-center min-h-[120px] max-h-56">
                {imagePreview.startsWith('data:application/pdf') ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-slate-300 gap-2">
                    <FileText className="w-10 h-10 text-purple-400" />
                    <span className="font-semibold text-xs">PDF Invoice Document Loaded</span>
                  </div>
                ) : (
                  <img
                    src={imagePreview}
                    alt="Bill Preview"
                    className="max-h-56 object-contain w-auto mx-auto rounded"
                  />
                )}

                {isScanning && (
                  <div className="absolute inset-0 bg-purple-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 gap-3">
                    <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent absolute top-1/2 -translate-y-1/2 animate-pulse shadow-lg shadow-cyan-500/50" />
                    <div className="flex items-center gap-3 bg-slate-950/95 border border-purple-500/50 px-4 py-2.5 rounded-xl shadow-2xl z-10">
                      <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                      <div className="text-left">
                        <div className="font-bold text-white text-xs">
                          Reading English &amp; Hindi Bill... ({scanElapsedSec}s)
                        </div>
                        <div className="text-[10px] text-purple-300">
                          Extracting handwritten/printed items, quantities, units &amp; prices
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelScan}
                        className="ml-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-200 hover:text-white text-[10px] font-bold border border-slate-700 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTION 2: EXTRACTED RESULTS */}
          {scanResult && (
            <div className="space-y-3">
              {/* Metadata Summary Strip */}
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <FileText className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="text-slate-400 block text-[10px]">
                      {scanMode === 'invoice' ? 'Source / Slip Ref:' : 'Vendor / Supplier:'}
                    </span>
                    <span className="font-bold text-white">
                      {scanMode === 'invoice'
                        ? `${scanResult.invoiceNumber || 'Manual Slip'} (${scanResult.invoiceDate || 'Today'})`
                        : scanResult.vendorName}
                    </span>
                  </div>
                </div>

                {/* Language & Handwriting Badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {scanResult.isHandwritten && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold">
                      <PenLine className="w-3 h-3" />
                      Handwritten Slip
                    </span>
                  )}
                  {scanResult.detectedLanguage && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold uppercase">
                      <Languages className="w-3 h-3" />
                      {scanResult.detectedLanguage === 'bilingual'
                        ? 'Hindi + English'
                        : scanResult.detectedLanguage}
                    </span>
                  )}
                  {scanDurationMs !== null && (
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[10px] font-bold">
                      {(scanDurationMs / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>

                {scanResult.totalAmount !== undefined && scanResult.totalAmount > 0 && (
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px]">Slip Printed Total:</span>
                    <span className="font-black text-emerald-400">
                      {formatCurrency(scanResult.totalAmount)}
                    </span>
                  </div>
                )}
              </div>

              {/* INVOICE MODE: Customer & Payment Attachment */}
              {scanMode === 'invoice' && (
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                      <User className="w-4 h-4 text-blue-400" />
                      Customer / Khata Details
                    </span>

                    {!selectedCustomer && slipCustomerName.trim() && (
                      <button
                        type="button"
                        onClick={handleSaveSlipCustomerToKhata}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[11px] font-bold transition"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Save "{slipCustomerName.trim()}" to Khata</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Match Existing Khata Customer:
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setIsCustomerModalOpen(true);
                        }}
                        aria-label="Search and select existing Khata customer"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-blue-500/60 text-xs text-white flex items-center justify-between gap-2 text-left transition"
                      >
                        <span className="truncate">
                          {selectedCustomer
                            ? `${selectedCustomer.name}${
                                selectedCustomer.currentBalance > 0
                                  ? ` (Due: ${formatCurrency(selectedCustomer.currentBalance)})`
                                  : ''
                              }`
                            : 'Walk-in / Use Slip Name'}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      </button>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Customer Name on Digital Invoice:
                      </label>
                      <input
                        type="text"
                        value={slipCustomerName}
                        onChange={e => {
                          setSlipCustomerName(e.target.value);
                          if (selectedCustomerId) setSelectedCustomerId('');
                        }}
                        placeholder="Walk-in Customer"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Mobile (for WhatsApp / SMS):
                      </label>
                      <input
                        type="tel"
                        value={slipCustomerPhone}
                        onChange={e => setSlipCustomerPhone(e.target.value)}
                        placeholder="10-digit phone"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Items List Header */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Boxes className="w-4 h-4 text-blue-400" />
                    {scanMode === 'invoice'
                      ? `Extracted Invoice Line Items (${detectedItems.length})`
                      : `Detected Items & Inventory Mapping (${detectedItems.length})`}
                  </label>
                  <div className="flex items-center gap-2">
                    {scanMode === 'invoice' && (
                      <>
                        <button
                          type="button"
                          onClick={handleAddBlankItem}
                          className="text-[11px] px-2 py-0.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 flex items-center gap-1 font-bold"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Item</span>
                        </button>
                        <span className="text-slate-600">|</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleAll(true)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Select All</span>
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={() => handleToggleAll(false)}
                      className="text-[11px] text-slate-400 hover:text-slate-300 flex items-center gap-1 font-semibold"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>Deselect All</span>
                    </button>
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                  {detectedItems.map(item => {
                    const matchedProduct = products.find(p => p.id === item.selectedProductId);
                    const isMatched = !!matchedProduct;
                    const currentStock = matchedProduct?.stockPieces ?? 0;
                    const newStock = currentStock + (item.enabled ? item.piecesToAdd : 0);
                    const accuracyPct = Math.round((item.confidence || 0.9) * 100);

                    if (scanMode === 'invoice') {
                      const lineRate = item.unitPrice ?? 0;
                      const lineTotal =
                        typeof item.totalPrice === 'number'
                          ? item.totalPrice
                          : Math.round(item.quantity * lineRate * 100) / 100;

                      return (
                        <div
                          key={item.id}
                          className={`p-3 rounded-xl border transition-all ${
                            item.enabled
                              ? 'bg-slate-950/90 border-slate-700 shadow-md'
                              : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={() => handleToggleItem(item.id)}
                              className="mt-2 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />

                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                {/* Editable Item Name */}
                                <div className="md:col-span-5">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <label className="text-[10px] text-slate-400">
                                      Item Name (EN / हिंदी):
                                    </label>
                                    {item.originalText && item.originalText !== item.productName && (
                                      <span className="text-[10px] text-purple-300 truncate max-w-[160px]" title={item.originalText}>
                                        Slip: {item.originalText}
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    value={item.productName}
                                    onChange={e =>
                                      handleUpdateItemField(item.id, { productName: e.target.value })
                                    }
                                    placeholder="Product description..."
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>

                                {/* Quantity Stepper */}
                                <div className="md:col-span-2">
                                  <label className="text-[10px] text-slate-400 block mb-0.5">
                                    Qty:
                                  </label>
                                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 justify-between">
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustQty(item.id, -1)}
                                      className="p-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <EditableQuantityBadge
                                      quantity={item.quantity}
                                      min={1}
                                      onCommit={newQty => handleSetQty(item.id, newQty)}
                                      ariaLabel={`${item.productName} quantity`}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustQty(item.id, 1)}
                                      className="p-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Unit Label + Bundle/Piece Switch */}
                                <div className="md:col-span-2">
                                  <label className="text-[10px] text-slate-400 block mb-0.5">
                                    Unit ({item.unitType === 'bundle' ? 'Bulk' : 'Loose'}):
                                  </label>
                                  <div className="flex gap-1">
                                    <input
                                      type="text"
                                      value={item.unitName}
                                      onChange={e =>
                                        handleUpdateItemField(item.id, { unitName: e.target.value })
                                      }
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                                    />
                                    {(!matchedProduct || getConfiguredUnits(matchedProduct).length > 1) && (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleUnitType(item.id)}
                                        className="px-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-blue-300 border border-slate-700"
                                        title="Toggle Bundle vs Loose Piece"
                                      >
                                        {item.unitType === 'bundle' ? 'Bdl' : 'Pc'}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Rate & Total */}
                                <div className="md:col-span-3 grid grid-cols-2 gap-1.5">
                                  <div>
                                    <label className="text-[10px] text-slate-400 block mb-0.5">
                                      Rate (₹):
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={lineRate}
                                      onChange={e =>
                                        handleUpdateItemField(item.id, {
                                          unitPrice: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-slate-400 block mb-0.5">
                                      Total (₹):
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={lineTotal}
                                      onChange={e =>
                                        handleUpdateItemField(item.id, {
                                          totalPrice: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-emerald-500/40 text-xs font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Optional Catalog Link & Confidence Row */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80 text-[11px]">
                                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                  <span className="text-slate-500 whitespace-nowrap">Catalog Link:</span>
                                  <select
                                    value={item.selectedProductId}
                                    onChange={e =>
                                      handleChangeMappedProduct(item.id, e.target.value)
                                    }
                                    className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500 max-w-xs"
                                  >
                                    <option value="CUSTOM">Custom Slip Item (No Catalog Link)</option>
                                    {products.map(p => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} (Stock: {p.stockPieces}p)
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-500">
                                    OCR {accuracyPct}%
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="p-1 text-slate-500 hover:text-rose-400 transition"
                                    title="Remove Row"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // RESTOCK MODE ROW
                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl border transition-all ${
                          item.enabled
                            ? 'bg-slate-950/90 border-slate-700 shadow-md'
                            : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={() => handleToggleItem(item.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />

                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <div>
                                <span className="font-black text-white text-xs sm:text-sm">
                                  {item.productName}
                                </span>
                                <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                                  <span>
                                    Detected on Bill:{' '}
                                    <strong className="text-purple-300">
                                      {item.quantity} {item.unitName}
                                    </strong>
                                  </span>
                                  {item.unitPrice ? <span>@ ₹{item.unitPrice}</span> : null}
                                  {item.totalPrice ? <span>= ₹{item.totalPrice}</span> : null}
                                  <span className="text-[10px] text-slate-500">
                                    ({accuracyPct}% confidence)
                                  </span>
                                </div>
                              </div>

                              <div>
                                {isMatched ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    Matched: {matchedProduct.name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                    <AlertCircle className="w-3 h-3 text-amber-400" />
                                    Select Product Below
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-1.5 border-t border-slate-800/80 items-center">
                              <div className="md:col-span-6">
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Map to Inventory Item:
                                </label>
                                <select
                                  value={item.selectedProductId === 'CUSTOM' ? 'SKIP' : item.selectedProductId}
                                  onChange={e =>
                                    handleChangeMappedProduct(item.id, e.target.value)
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                                >
                                  <option value="SKIP">-- Do Not Restock This Item --</option>
                                  {products.map(p => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} (
                                      {hasConfiguredBundleTier(p)
                                        ? `${p.bundleUnitName} of ${p.bundlePieces}p`
                                        : 'Single Pc'}
                                      ) — Stock: {p.stockPieces} pcs
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="md:col-span-3 flex flex-col justify-center">
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Adjust Qty &amp; Unit:
                                </label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustQty(item.id, -1)}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <EditableQuantityBadge
                                    quantity={item.quantity}
                                    min={1}
                                    onCommit={newQty => handleSetQty(item.id, newQty)}
                                    ariaLabel={`${item.productName} restock quantity`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustQty(item.id, 1)}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  {!matchedProduct || getConfiguredUnits(matchedProduct).length > 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleUnitType(item.id)}
                                      className={`ml-1 px-2 py-0.5 text-[10px] font-bold rounded border transition ${
                                        item.unitType === 'bundle'
                                          ? 'bg-purple-900/40 text-purple-300 border-purple-500/40'
                                          : 'bg-blue-900/40 text-blue-300 border-blue-500/40'
                                      }`}
                                    >
                                      {item.unitType === 'bundle' ? 'Bundle' : 'Piece'}
                                    </button>
                                  ) : (
                                    <span className="ml-1 px-2 py-0.5 text-[10px] font-bold rounded border bg-slate-800/70 text-slate-300 border-slate-700">
                                      {item.unitType === 'bundle' ? matchedProduct.bundleUnitName : 'Piece'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="md:col-span-3 bg-slate-900/80 p-2 rounded-lg border border-slate-800 text-right">
                                <span className="text-[10px] text-slate-400 block">
                                  Restock Added:
                                </span>
                                <div className="text-xs font-black text-emerald-400">
                                  +{item.piecesToAdd} Pcs
                                </div>
                                {isMatched && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {currentStock} &rarr;{' '}
                                    <strong className="text-white">{newStock} pcs</strong>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* INVOICE MODE: Billing Totals, GST Toggle & Payment Input */}
              {scanMode === 'invoice' && detectedItems.length > 0 && (
                <div className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isGstEnabled ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                        <span className="font-semibold text-slate-200">
                          {isGstEnabled ? `GST Applied (${gstRate}%)` : 'Non-GST Digital Bill'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setIsGstEnabled(!isGstEnabled);
                        }}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded transition ${
                          isGstEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {isGstEnabled ? 'Switch to Non-GST' : `Enable GST (+${gstRate}%)`}
                      </button>
                    </div>

                    <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none px-1">
                      <input
                        type="checkbox"
                        checked={deductCatalogStock}
                        onChange={e => setDeductCatalogStock(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-blue-600"
                      />
                      <span>Deduct matched catalog items from store stock</span>
                    </label>

                    <div className="space-y-1 text-[11px] text-slate-400 pt-1">
                      <div className="flex justify-between">
                        <span>Items Subtotal:</span>
                        <span className="font-semibold text-white">{formatCurrency(invoiceSubtotal)}</span>
                      </div>
                      {isGstEnabled && (
                        <div className="flex justify-between text-emerald-400">
                          <span>GST ({gstRate}% CGST+SGST):</span>
                          <span>+{formatCurrency(totalGstAmount)}</span>
                        </div>
                      )}
                      {previousBalance > 0 && (
                        <div className="flex justify-between text-amber-300">
                          <span>+ Previous Udhar Due:</span>
                          <span>{formatCurrency(previousBalance)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-black text-white pt-1 border-t border-slate-800">
                        <span>Digital Invoice Total:</span>
                        <span className="text-blue-400">{formatCurrency(invoiceGrandTotal)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 flex flex-col justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-emerald-400">
                          Amount Received (Cash/UPI Paid):
                        </label>
                        <span className="text-[11px] text-rose-400 font-bold">
                          Udhar Due: {formatCurrency(remainingBalance)}
                        </span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400">
                          ₹
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={amountPaidInput}
                          onChange={e => setAmountPaidInput(e.target.value)}
                          placeholder={String(invoiceGrandTotal)}
                          className="w-full pl-7 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm font-bold text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setAmountPaidInput(String(invoiceGrandTotal));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold hover:bg-emerald-500/30"
                      >
                        Full Paid ({formatCurrency(invoiceGrandTotal)})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setAmountPaidInput('0');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold hover:bg-rose-500/30"
                      >
                        ₹0 (Full Udhar)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!imagePreview && (
            <div className="p-6 sm:p-8 text-center border-2 border-dashed border-slate-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-center gap-3 text-slate-500">
                <PenLine className="w-9 h-9 stroke-[1.5] text-blue-400/70" />
                <Languages className="w-9 h-9 stroke-[1.5] text-purple-400/70" />
              </div>
              <h4 className="font-bold text-white text-sm">
                Scan Handwritten or Manual Bills (English &amp; हिंदी)
              </h4>
              <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                Snap a photo of any handwritten paper slip (कच्चा बिल), manual kirana notebook, or printed wholesale invoice in English or Hindi. AI Vision extracts every item, quantity, unit, and price so you can generate a digital thermal/WhatsApp invoice or restock inventory in seconds.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleLoadHandwrittenBilingualSample}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900/40 transition active:scale-95 flex items-center gap-1.5"
                >
                  <PenLine className="w-4 h-4 text-blue-200" />
                  <span>Test Handwritten Hindi + English Slip</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleBill}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-900/40 transition active:scale-95 flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Test Printed Wholesale Bill</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            {successToast ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1 text-xs">
                <CheckCircle2 className="w-4 h-4" /> {successToast}
              </span>
            ) : scanMode === 'invoice' && scanResult && enabledItems.length > 0 ? (
              <div className="text-xs">
                <span className="text-slate-400">Digital Invoice Ready: </span>
                <strong className="text-blue-400 font-black">
                  {formatCurrency(invoiceGrandTotal)}
                </strong>
                <span className="text-slate-400"> ({enabledItems.length} items)</span>
              </div>
            ) : scanMode === 'restock' && scanResult && activeItemsToRestock.length > 0 ? (
              <div className="text-xs">
                <span className="text-slate-400">Ready to Restock: </span>
                <strong className="text-emerald-400 font-black">
                  +{totalPiecesRestocked} Total Pieces
                </strong>
                <span className="text-slate-400"> across {activeItemsToRestock.length} items</span>
              </div>
            ) : (
              <span className="text-xs text-slate-500">
                Snap or upload a bill or paper slip to begin OCR extraction.
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition"
            >
              Cancel
            </button>

            {scanMode === 'invoice' ? (
              <>
                <button
                  type="button"
                  disabled={enabledItems.length === 0 || isScanning}
                  onClick={handleImportToCart}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-blue-300 font-bold text-xs border border-blue-500/40 transition active:scale-95 flex items-center gap-1.5"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>Load to Cart</span>
                </button>
                <button
                  type="button"
                  disabled={enabledItems.length === 0 || isScanning}
                  onClick={handleCreateDigitalInvoice}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-blue-900/40 transition active:scale-95 flex items-center gap-1.5"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Generate Digital Invoice</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={activeItemsToRestock.length === 0 || isScanning}
                onClick={handleConfirmStockUpdate}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-emerald-900/40 transition active:scale-95 flex items-center gap-1.5"
              >
                <PackageCheck className="w-4 h-4" />
                <span>Confirm &amp; Update Stock</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <CustomerSelectorModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        walkInLabel="Walk-in / Use Slip Name"
        walkInSubtitle="Use extracted slip name or walk-in customer"
        onSelectCustomer={cid => {
          setSelectedCustomerId(cid);
          const c = customers.find(cust => cust.id === cid);
          if (c) {
            setSlipCustomerName(c.name);
            setSlipCustomerPhone(c.phone);
          }
        }}
        onQuickCreateCustomer={(name, phone) => {
          const created = onAddNewCustomer(name, phone);
          setSlipCustomerName(created.name);
          setSlipCustomerPhone(created.phone);
          return created;
        }}
      />
    </div>
  );
};
