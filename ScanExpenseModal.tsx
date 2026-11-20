import React, { useEffect, useRef, useState } from 'react';
import {
  CashFlowEntry,
  CashFlowPaymentMode,
  ExpenseCategory,
  OcrExpenseScanResult,
} from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import {
  Camera,
  Upload,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Receipt,
  Sparkles,
} from 'lucide-react';

interface ScanExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate: string;
  onSaveExpenseEntries: (entries: CashFlowEntry[], navigateToDate?: string) => void;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Transport & Freight',
  'Staff Wages',
  'Rent & Utilities',
  'Packaging & Supplies',
  'Tea & Petty Cash',
  'Maintenance',
  'Other Expense',
];

async function compressReceiptImage(
  fileOrDataUrl: File | string,
  maxDim: number = 1280,
  quality: number = 0.8
): Promise<{ dataUrl: string; mimeType: string }> {
  const rawUrl =
    typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(fileOrDataUrl);
        });

  if (rawUrl.startsWith('data:application/pdf')) {
    return { dataUrl: rawUrl, mimeType: 'application/pdf' };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: rawUrl, mimeType: 'image/jpeg' });
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', quality),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => reject(new Error('Invalid receipt image'));
    img.src = rawUrl;
  });
}

function generateSampleExpenseReceiptPng(dateStr: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 620;
  canvas.height = 820;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 620, 820);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, 588, 788);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(30, 30, 560, 88);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText('SHARMA TEMPO & FREIGHT SERVICES', 310, 66);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('OKHLA TRANSPORT NAGAR · CASH FREIGHT VOUCHER', 310, 94);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('RECEIPT #: FR-4092', 42, 160);
  ctx.fillText(`DATE: ${dateStr}`, 390, 160);
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText('PAID BY: SQ ENTERPRISES', 42, 192);
  ctx.fillText('PAYMENT MODE: CASH PAID AT UNLOADING', 42, 220);

  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(40, 244);
  ctx.lineTo(580, 244);
  ctx.stroke();

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(40, 256, 540, 34);
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText('EXPENSE DESCRIPTION', 52, 278);
  ctx.textAlign = 'right';
  ctx.fillText('AMOUNT (INR)', 568, 278);

  const lines = [
    { desc: 'Tempo Freight Charges (Okhla to Shop)', amt: '650.00' },
    { desc: 'Labour / Unloading Porter (4 Cartons)', amt: '180.00' },
    { desc: 'Heavy Packing Tape & Polybags', amt: '240.00' },
    { desc: 'Chai & Refreshment (Staff / Driver)', amt: '90.00' },
  ];

  let y = 328;
  ctx.font = '15px Arial, sans-serif';
  lines.forEach(line => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(line.desc, 52, y);
    ctx.textAlign = 'right';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`Rs. ${line.amt}`, 568, y);
    ctx.font = '15px Arial, sans-serif';
    y += 48;
  });

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, 540);
  ctx.lineTo(580, 540);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('TOTAL PAID (CASH)', 52, 584);
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('Rs. 1,160.00', 568, 584);

  ctx.textAlign = 'left';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Verified by Dispatch Counter · Thank You', 52, 650);

  return canvas.toDataURL('image/png');
}

export const ScanExpenseModal: React.FC<ScanExpenseModalProps> = ({
  isOpen,
  onClose,
  defaultDate,
  onSaveExpenseEntries,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanTimeMs, setScanTimeMs] = useState<number | null>(null);
  const [parsedResult, setParsedResult] = useState<OcrExpenseScanResult | null>(null);

  // Editable review state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Transport & Freight');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(defaultDate);
  const [paymentMode, setPaymentMode] = useState<CashFlowPaymentMode>('cash');
  const [notes, setNotes] = useState('');
  const [splitLines, setSplitLines] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setExpenseDate(defaultDate);
    } else {
      abortRef.current?.abort();
      setPreviewUrl('');
      setParsedResult(null);
      setScanError(null);
      setIsScanning(false);
      setScanTimeMs(null);
      setSplitLines(false);
    }
  }, [isOpen, defaultDate]);

  if (!isOpen) return null;

  const processReceipt = async (source: File | string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsScanning(true);
    setScanError(null);
    setParsedResult(null);
    setScanTimeMs(null);

    const timeoutId = window.setTimeout(() => {
      controller.abort(new Error('CLIENT_TIMEOUT'));
    }, 58_000);

    try {
      const { dataUrl, mimeType } = await compressReceiptImage(source);
      setPreviewUrl(dataUrl);

      const response = await fetch('/api/ocr/scan-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: dataUrl, mimeType }),
        signal: controller.signal,
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload?.error || 'Failed to parse expense receipt.');
      }

      const data: OcrExpenseScanResult = payload.data;
      setParsedResult(data);
      setScanTimeMs(payload.processingTimeMs || null);

      setTitle(data.title || data.merchantName || data.suggestedCategory);
      setCategory(data.suggestedCategory || 'Other Expense');
      setAmount(String(data.totalAmount || ''));
      setPaymentMode(data.paymentMode || 'cash');
      setExpenseDate(data.receiptDate || defaultDate);

      const metaParts: string[] = [];
      if (data.merchantName) metaParts.push(data.merchantName);
      if (data.receiptNumber) metaParts.push(`Ref: ${data.receiptNumber}`);
      if (data.notes) metaParts.push(data.notes);
      setNotes(metaParts.join(' · '));
      setSplitLines(false);
      soundManager.playScannerBeep();
    } catch (err: any) {
      if (err?.name === 'AbortError' || String(err?.message).includes('CLIENT_TIMEOUT')) {
        setScanError('Receipt OCR timed out. Please tap Retry or capture a closer photo.');
      } else {
        setScanError(err?.message || 'Could not scan expense receipt.');
      }
      soundManager.playAlertSound();
    } finally {
      window.clearTimeout(timeoutId);
      setIsScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      processReceipt(file);
    }
  };

  const handleSaveToCashFlow = (e: React.FormEvent) => {
    e.preventDefault();
    const numericTotal = parseFloat(amount);
    if (!numericTotal || numericTotal <= 0) return;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const baseTimestamp =
      expenseDate === todayStr
        ? now.toISOString()
        : `${expenseDate}T${now.toISOString().slice(11)}`;

    let entriesToAdd: CashFlowEntry[] = [];

    if (splitLines && parsedResult && parsedResult.lineItems.length > 1) {
      entriesToAdd = parsedResult.lineItems.map((li, idx) => ({
        id: `cf_ocr_${Date.now()}_${idx}`,
        date: expenseDate,
        timestamp: baseTimestamp,
        type: 'expense',
        amount: li.amount,
        paymentMode,
        category,
        title: li.description,
        notes: notes || (parsedResult.merchantName ? `Receipt: ${parsedResult.merchantName}` : 'Scanned via OCR'),
        isAutoSynced: true,
      }));
    } else {
      entriesToAdd = [
        {
          id: `cf_ocr_${Date.now()}`,
          date: expenseDate,
          timestamp: baseTimestamp,
          type: 'expense',
          amount: numericTotal,
          paymentMode,
          category,
          title: title.trim() || category,
          notes: notes.trim() || 'Scanned expense receipt',
          isAutoSynced: true,
        },
      ];
    }

    soundManager.playCheckoutSuccess();
    onSaveExpenseEntries(entriesToAdd, expenseDate);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Camera className="w-4 h-4 text-blue-400" />
              OCR Expense Receipt Scanner
            </h3>
            <p className="text-[11px] text-slate-400">
              Scan thermal slips, transport bilties, utility bills &amp; Hindi/English handwritten vouchers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Hidden Inputs */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Capture Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => cameraInputRef.current?.click()}
              className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition"
            >
              <Camera className="w-4 h-4" />
              <span>Take Receipt Photo</span>
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => uploadInputRef.current?.click()}
              className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Upload className="w-4 h-4 text-slate-300" />
              <span>Upload Photo / PDF</span>
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => {
                const sample = generateSampleExpenseReceiptPng(defaultDate);
                if (sample) processReceipt(sample);
              }}
              className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-amber-300 border border-amber-500/30 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Test Sample Receipt</span>
            </button>
          </div>

          {/* Scanning Progress */}
          {isScanning && (
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto" />
              <div className="font-semibold text-sm text-white">
                Reading expense receipt with AI Vision...
              </div>
              <p className="text-slate-400">
                Extracting merchant, date, payment mode, category &amp; itemized charges
              </p>
            </div>
          )}

          {/* Error Banner */}
          {scanError && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{scanError}</span>
              </div>
              {previewUrl && (
                <button
                  type="button"
                  onClick={() => processReceipt(previewUrl)}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold whitespace-nowrap"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Extracted Review Form */}
          {!isScanning && parsedResult && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Preview */}
              <div className="md:col-span-2 rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-col justify-between gap-2">
                <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                  <span>Receipt Preview</span>
                  {scanTimeMs && (
                    <span className="font-mono text-emerald-400">
                      Parsed in {(scanTimeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>

                {previewUrl.startsWith('data:application/pdf') ? (
                  <div className="py-12 text-center text-slate-400 space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-blue-400" />
                    <div>PDF Receipt Uploaded</div>
                  </div>
                ) : (
                  <img
                    src={previewUrl}
                    alt="Scanned expense receipt"
                    className="w-full max-h-72 object-contain rounded-lg bg-white"
                  />
                )}

                <div className="text-[11px] text-slate-400 space-y-0.5 pt-1 border-t border-slate-800">
                  {parsedResult.merchantName && (
                    <div>
                      Merchant: <span className="text-slate-200">{parsedResult.merchantName}</span>
                    </div>
                  )}
                  <div>
                    Language: {parsedResult.detectedLanguage || 'English'}
                    {parsedResult.isHandwritten ? ' · Handwritten' : ' · Printed'}
                  </div>
                </div>
              </div>

              {/* Editable Form */}
              <form
                onSubmit={handleSaveToCashFlow}
                className="md:col-span-3 space-y-3 rounded-xl bg-slate-950 border border-slate-800 p-4"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Review &amp; Populate Expense Log</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {Math.round((parsedResult.confidence || 0.9) * 100)}% match
                  </span>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Expense Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Amount (₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="0.01"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Expense Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={expenseDate}
                      onChange={e => setExpenseDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Category</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as ExpenseCategory)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    >
                      {EXPENSE_CATEGORIES.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={paymentMode}
                      onChange={e => setPaymentMode(e.target.value as CashFlowPaymentMode)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="cash">Physical Cash Drawer</option>
                      <option value="upi">UPI / QR</option>
                      <option value="bank">Bank / Card</option>
                    </select>
                  </div>
                </div>

                {/* Detected Itemized Charges */}
                {parsedResult.lineItems.length > 1 && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1">
                        <Receipt className="w-3.5 h-3.5 text-blue-400" />
                        Detected Itemized Lines ({parsedResult.lineItems.length})
                      </span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-blue-300 font-semibold">
                        <input
                          type="checkbox"
                          checked={splitLines}
                          onChange={e => setSplitLines(e.target.checked)}
                          className="rounded border-slate-600 bg-slate-950 text-blue-600"
                        />
                        <span>Split into separate log entries</span>
                      </label>
                    </div>
                    <div className="space-y-1 max-h-28 overflow-y-auto text-[11px] text-slate-300">
                      {parsedResult.lineItems.map((li, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span className="truncate pr-2">{li.description}</span>
                          <span className="font-mono tabular-nums text-slate-200">
                            {formatCurrency(li.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Merchant, voucher # or extra details"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                  >
                    {splitLines && parsedResult.lineItems.length > 1
                      ? `Log ${parsedResult.lineItems.length} Expenses`
                      : `Log Expense (${formatCurrency(parseFloat(amount) || 0)})`}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
