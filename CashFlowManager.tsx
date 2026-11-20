import React, { useMemo, useState } from 'react';
import {
  Bill,
  CashFlowEntry,
  CashFlowEntryType,
  CashFlowPaymentMode,
  ExpenseCategory,
  KhataTransaction,
  PurchaseOrder,
  Supplier,
} from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  buildCashFlowCsv,
  buildWhatsAppCashFlowText,
  computeCashFlowHistory,
  computeDailyCashFlow,
} from '../utils/cashFlow';
import {
  Wallet,
  Plus,
  MinusCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Trash2,
  Edit2,
  X,
  Truck,
  Receipt,
  Check,
  RotateCcw,
  Camera,
} from 'lucide-react';
import { ScanExpenseModal } from './ScanExpenseModal';

interface CashFlowManagerProps {
  bills: Bill[];
  khata: KhataTransaction[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  cashFlowEntries: CashFlowEntry[];
  openingCashMap: Record<string, number>;
  onSetOpeningCash: (date: string, amount: number | null) => void;
  onAddCashFlowEntry: (entry: CashFlowEntry) => void;
  onAddCashFlowEntries?: (entries: CashFlowEntry[]) => void;
  onDeleteCashFlowEntry: (entryId: string) => void;
  onPaySupplierFromCashFlow: (params: {
    date: string;
    supplierId: string;
    supplierName: string;
    poId?: string;
    poNumber?: string;
    amount: number;
    paymentMode: CashFlowPaymentMode;
    notes?: string;
  }) => void;
  onViewBillReceipt?: (bill: Bill) => void;
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

const INJECTION_SOURCES = [
  'Counter Float',
  'Owner Capital Deposit',
  'Bank Cash Withdrawal',
  'Drawer Adjustment',
];

function shiftDate(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const CashFlowManager: React.FC<CashFlowManagerProps> = ({
  bills,
  khata,
  suppliers,
  purchaseOrders,
  cashFlowEntries,
  openingCashMap,
  onSetOpeningCash,
  onAddCashFlowEntry,
  onAddCashFlowEntries,
  onDeleteCashFlowEntry,
  onPaySupplierFromCashFlow,
  onViewBillReceipt,
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [subTab, setSubTab] = useState<'breakdown' | 'history'>('breakdown');
  const [historyRangeDays, setHistoryRangeDays] = useState<7 | 14>(7);
  const [toast, setToast] = useState<string | null>(null);
  const [isScanExpenseOpen, setIsScanExpenseOpen] = useState(false);

  // Inline Opening Cash Editor
  const [isEditingOpening, setIsEditingOpening] = useState(false);
  const [openingInput, setOpeningInput] = useState('');

  // Entry Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [entryType, setEntryType] = useState<CashFlowEntryType>('expense');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryMode, setEntryMode] = useState<CashFlowPaymentMode>('cash');
  const [entryCategory, setEntryCategory] = useState<string>('Transport & Freight');
  const [entryTitle, setEntryTitle] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [entrySupplierId, setEntrySupplierId] = useState('');
  const [entryPoId, setEntryPoId] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Daily Reconciliation
  const dailySummary = useMemo(
    () =>
      computeDailyCashFlow(
        selectedDate,
        bills,
        khata,
        cashFlowEntries,
        openingCashMap
      ),
    [selectedDate, bills, khata, cashFlowEntries, openingCashMap]
  );

  // Multi-day History
  const historyRows = useMemo(
    () =>
      computeCashFlowHistory(
        selectedDate,
        historyRangeDays,
        bills,
        khata,
        cashFlowEntries,
        openingCashMap
      ),
    [selectedDate, historyRangeDays, bills, khata, cashFlowEntries, openingCashMap]
  );

  // Recent supplier payouts across all dates (for visibility when viewing a date with no payouts)
  const recentSupplierPayouts = useMemo(
    () =>
      cashFlowEntries
        .filter(e => e.type === 'supplier_payment')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 8),
    [cashFlowEntries]
  );

  // Open POs for selected supplier in modal
  const supplierOpenPos = useMemo(() => {
    if (!entrySupplierId) return [];
    return purchaseOrders.filter(
      po =>
        po.supplierId === entrySupplierId &&
        po.status !== 'cancelled' &&
        po.totalAmount - po.amountPaid > 0
    );
  }, [purchaseOrders, entrySupplierId]);

  const openEntryModal = (type: CashFlowEntryType) => {
    soundManager.playMechanicalClick();
    setEntryType(type);
    setEntryAmount('');
    setEntryMode('cash');
    setEntryNotes('');
    if (type === 'expense') {
      setEntryCategory('Transport & Freight');
      setEntryTitle('');
    } else if (type === 'cash_injection') {
      setEntryCategory('Counter Float');
      setEntryTitle('Counter Float Top-up');
    } else {
      const firstSup = suppliers[0];
      setEntrySupplierId(firstSup ? firstSup.id : '');
      setEntryPoId('');
      setEntryCategory('Supplier Payment');
      setEntryTitle('');
    }
    setIsModalOpen(true);
  };

  const handleSelectSupplierInModal = (supId: string) => {
    setEntrySupplierId(supId);
    setEntryPoId('');
  };

  const handleSelectPoInModal = (poId: string) => {
    setEntryPoId(poId);
    const po = purchaseOrders.find(p => p.id === poId);
    if (po) {
      const due = Math.max(0, po.totalAmount - po.amountPaid);
      if (due > 0 && !entryAmount) {
        setEntryAmount(String(Math.round(due * 100) / 100));
      }
    }
  };

  const handleEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(entryAmount);
    if (!amount || amount <= 0) return;

    const now = new Date();
    const timestamp =
      selectedDate === todayStr
        ? now.toISOString()
        : `${selectedDate}T${now.toISOString().slice(11)}`;

    if (entryType === 'supplier_payment') {
      const sup = suppliers.find(s => s.id === entrySupplierId);
      if (!sup) return;
      const linkedPo = purchaseOrders.find(p => p.id === entryPoId);
      soundManager.playCheckoutSuccess();
      onPaySupplierFromCashFlow({
        date: selectedDate,
        supplierId: sup.id,
        supplierName: sup.name,
        poId: linkedPo?.id,
        poNumber: linkedPo?.poNumber,
        amount,
        paymentMode: entryMode,
        notes: entryNotes.trim() || undefined,
      });
      setIsModalOpen(false);
      showToast(
        `Recorded ${formatCurrency(amount)} payout to ${sup.name}${
          linkedPo ? ` (${linkedPo.poNumber})` : ''
        }`
      );
      return;
    }

    const newEntry: CashFlowEntry = {
      id: `cf_${Date.now()}`,
      date: selectedDate,
      timestamp,
      type: entryType,
      amount,
      paymentMode: entryMode,
      category: entryCategory,
      title:
        entryTitle.trim() ||
        (entryType === 'cash_injection' ? entryCategory : entryCategory),
      notes: entryNotes.trim() || undefined,
      isAutoSynced: false,
    };

    soundManager.playCheckoutSuccess();
    onAddCashFlowEntry(newEntry);
    setIsModalOpen(false);
    showToast(
      entryType === 'cash_injection'
        ? `Added ${formatCurrency(amount)} cash injection`
        : `Logged ${formatCurrency(amount)} expense`
    );
  };

  const handleSaveOpeningCash = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(openingInput);
    if (isNaN(val) || val < 0) return;
    soundManager.playMechanicalClick();
    onSetOpeningCash(selectedDate, val);
    setIsEditingOpening(false);
    showToast(`Opening cash for ${selectedDate} set to ${formatCurrency(val)}`);
  };

  const handleExportCsv = () => {
    soundManager.playMechanicalClick();
    const csv = buildCashFlowCsv(dailySummary, historyRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sq-enterprises-cashflow-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded Cash Flow CSV');
  };

  const whatsappShareUrl = useMemo(() => {
    const text = buildWhatsAppCashFlowText(dailySummary);
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [dailySummary]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-400" />
              Cash Flow &amp; Daily Register
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Opening cash · Manual injections · Automated POS sales · Supplier payouts · Operating expenses
            </p>
          </div>

          {/* Date Controls & Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center bg-slate-950 border border-slate-700 rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSelectedDate(d => shiftDate(d, -1));
                  setIsEditingOpening(false);
                }}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                title="Previous day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 px-2">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value);
                      setIsEditingOpening(false);
                    }
                  }}
                  className="bg-transparent text-xs font-mono font-bold text-white focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSelectedDate(d => shiftDate(d, 1));
                  setIsEditingOpening(false);
                }}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                title="Next day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {selectedDate !== todayStr && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(todayStr);
                  setIsEditingOpening(false);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
              >
                Today
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </button>

            <a
              href={whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share Closing</span>
            </a>
          </div>
        </div>

        {toast && (
          <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Primary Cash Flow Equation Cards */}
        <div
          className={`grid ${
            isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
          } gap-2.5`}
        >
          {/* 1. Opening Cash */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Opening Cash ({dailySummary.hasExplicitOpeningCash ? 'Manual' : 'Auto Carryover'})
              </span>
              {!isEditingOpening && (
                <button
                  type="button"
                  onClick={() => {
                    setOpeningInput(String(dailySummary.openingCash));
                    setIsEditingOpening(true);
                  }}
                  className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Set</span>
                </button>
              )}
            </div>

            {isEditingOpening ? (
              <form onSubmit={handleSaveOpeningCash} className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={openingInput}
                  onChange={e => setOpeningInput(e.target.value)}
                  className="w-full px-2.5 py-1 bg-slate-900 border border-blue-500 rounded-lg text-sm font-mono font-bold text-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="p-1.5 rounded-lg bg-blue-600 text-white"
                  title="Save Opening Cash"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                {dailySummary.hasExplicitOpeningCash && (
                  <button
                    type="button"
                    onClick={() => {
                      onSetOpeningCash(selectedDate, null);
                      setIsEditingOpening(false);
                      showToast('Reset opening cash to previous day carryover');
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300"
                    title="Reset to Auto Carryover"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingOpening(false)}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <div>
                <div className="text-xl font-bold text-white tabular-nums">
                  {formatCurrency(dailySummary.openingCash)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Start-of-day cash box float
                </div>
              </div>
            )}
          </div>

          {/* 2. Total Inflows (Sales + Injections) */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>+ Inflows (Sales &amp; Injections)</span>
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1">
              <div className="text-xl font-bold text-emerald-400 tabular-nums">
                +{formatCurrency(dailySummary.totalAutomatedInflow + dailySummary.manualCashInjections)}
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                Sales {formatCurrency(dailySummary.totalAutomatedInflow)} · Injections{' '}
                {formatCurrency(dailySummary.manualCashInjections)}
              </div>
            </div>
          </div>

          {/* 3. Total Outflows (Suppliers + Expenses) */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>− Outflows (Suppliers &amp; Expenses)</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="mt-1">
              <div className="text-xl font-bold text-rose-400 tabular-nums">
                −{formatCurrency(dailySummary.totalOutflow)}
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                Suppliers {formatCurrency(dailySummary.supplierPaymentsTotal)} · Expenses{' '}
                {formatCurrency(dailySummary.manualExpensesTotal)}
              </div>
            </div>
          </div>

          {/* 4. Daily Closing Balance */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] text-emerald-300 font-semibold">
              <span>= Closing Cash Drawer</span>
              <span
                className={`tabular-nums ${
                  dailySummary.netDayChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {dailySummary.netDayChange >= 0 ? '+' : ''}
                {formatCurrency(dailySummary.netDayChange)} net
              </span>
            </div>
            <div className="mt-1">
              <div className="text-xl font-bold text-white tabular-nums">
                {formatCurrency(dailySummary.closingCashDrawer)}
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                All modes (incl. UPI/Bank):{' '}
                <span className="text-slate-200 font-semibold">
                  {formatCurrency(dailySummary.closingBalanceAllModes)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-Tabs & Action Entry Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setSubTab('breakdown');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                subTab === 'breakdown'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Daily Cash Breakdown
            </button>
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setSubTab('history');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                subTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Multi-Day Ledger
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openEntryModal('cash_injection')}
              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Cash Injection</span>
            </button>

            <button
              type="button"
              onClick={() => openEntryModal('supplier_payment')}
              className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1 transition"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Pay Supplier</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundManager.playScannerBeep();
                setIsScanExpenseOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan Expense</span>
            </button>

            <button
              type="button"
              onClick={() => openEntryModal('expense')}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition"
            >
              <MinusCircle className="w-3.5 h-3.5" />
              <span>Add Expense</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className={`flex-1 overflow-y-auto ${isMobileLayout ? 'p-3' : 'p-4'} space-y-4`}>
        {subTab === 'breakdown' ? (
          <div className={`grid ${isDesktopLayout ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            {/* LEFT COLUMN: INFLOWS (Automated Sales + Manual Cash Injections) */}
            <div className="space-y-4">
              {/* Automated Daily Sales Revenue */}
              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Automated Daily Sales Revenue
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Synced automatically from POS bills &amp; Khata payments on {selectedDate}
                    </p>
                  </div>
                  <div className="text-sm font-bold text-emerald-400 tabular-nums">
                    +{formatCurrency(dailySummary.totalAutomatedInflow)}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">POS Cash Bills</div>
                      <div className="font-bold text-white tabular-nums mt-0.5">
                        {formatCurrency(dailySummary.automatedBillCashIn)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">POS UPI Bills</div>
                      <div className="font-bold text-sky-300 tabular-nums mt-0.5">
                        {formatCurrency(dailySummary.automatedBillUpiIn)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">Khata Collected</div>
                      <div className="font-bold text-emerald-300 tabular-nums mt-0.5">
                        {formatCurrency(dailySummary.automatedKhataCashIn)}
                      </div>
                    </div>
                  </div>

                  {dailySummary.dateBills.length === 0 &&
                  dailySummary.dateKhataPayments.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      No POS bills or Khata collections recorded on {selectedDate}.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70 max-h-56 overflow-y-auto">
                      {dailySummary.dateBills.map(bill => (
                        <div
                          key={bill.id}
                          className="py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-200 truncate">
                              Bill #{bill.billNumber} · {bill.customerName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {bill.paymentMode.toUpperCase()} · Billed{' '}
                              {formatCurrency(bill.itemsTotal + (bill.totalGstAmount || 0))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-emerald-400 tabular-nums">
                              +{formatCurrency(bill.amountReceived)}
                            </span>
                            {onViewBillReceipt && (
                              <button
                                type="button"
                                onClick={() => onViewBillReceipt(bill)}
                                className="p-1 text-slate-400 hover:text-white"
                                title="View Bill Receipt"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {dailySummary.dateKhataPayments.map(tx => (
                        <div
                          key={tx.id}
                          className="py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-200 truncate">
                              Khata Payment · {tx.customerName}
                            </div>
                            <div className="text-[11px] text-slate-400">{tx.description}</div>
                          </div>
                          <span className="font-bold text-emerald-400 tabular-nums">
                            +{formatCurrency(tx.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Manual Cash Injections */}
              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">Manual Cash Injections</h3>
                    <p className="text-[11px] text-slate-400">
                      Counter float top-ups, owner deposits &amp; bank cash withdrawals
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-emerald-400 tabular-nums">
                      +{formatCurrency(dailySummary.manualCashInjections)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEntryModal('cash_injection')}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  {dailySummary.injectionItems.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      No manual cash injections recorded on {selectedDate}.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70">
                      {dailySummary.injectionItems.map(item => (
                        <div
                          key={item.id}
                          className="py-2.5 px-1 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.category} · {item.paymentMode.toUpperCase()}
                              {item.notes ? ` · ${item.notes}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-emerald-400 tabular-nums">
                              +{formatCurrency(item.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playAlertSound();
                                onDeleteCashFlowEntry(item.id);
                                showToast('Removed cash injection entry');
                              }}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Delete entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: OUTFLOWS (Supplier Payments + Manual Expenses) */}
            <div className="space-y-4">
              {/* Itemized Outgoing Payments to Suppliers */}
              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Outgoing Payments to Suppliers
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Itemized vendor payouts &amp; auto-synced Purchase Order settlements
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-rose-400 tabular-nums">
                      −{formatCurrency(dailySummary.supplierPaymentsTotal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEntryModal('supplier_payment')}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                    >
                      + Pay
                    </button>
                  </div>
                </div>

                <div className="p-3 space-y-3">
                  {dailySummary.supplierPaymentItems.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      No supplier payments recorded on {selectedDate}.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70">
                      {dailySummary.supplierPaymentItems.map(item => (
                        <div
                          key={item.id}
                          className="py-2.5 px-1 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">
                              {item.supplierName || item.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.poNumber ? `${item.poNumber} · ` : ''}
                              {item.paymentMode.toUpperCase()}
                              {item.notes ? ` · ${item.notes}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-rose-400 tabular-nums">
                              −{formatCurrency(item.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playAlertSound();
                                onDeleteCashFlowEntry(item.id);
                                showToast('Removed supplier payout entry');
                              }}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Delete entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recent Supplier Payouts Log across other dates */}
                  {recentSupplierPayouts.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                        Recent Supplier Payouts (All Dates)
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {recentSupplierPayouts.map(sp => (
                          <button
                            key={sp.id}
                            type="button"
                            onClick={() => setSelectedDate(sp.date)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800/70 flex items-center justify-between text-[11px]"
                          >
                            <span className="truncate text-slate-300">
                              <span className="font-mono text-slate-500 mr-1.5">{sp.date}</span>
                              {sp.supplierName || sp.title}
                              {sp.poNumber ? ` (${sp.poNumber})` : ''}
                            </span>
                            <span className="font-bold text-rose-300 tabular-nums ml-2">
                              −{formatCurrency(sp.amount)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Manual Operating Expenses */}
              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Manual Operating Expenses
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Freight, wages, rent, packaging, utilities &amp; petty cash
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-rose-400 tabular-nums mr-1">
                      −{formatCurrency(dailySummary.manualExpensesTotal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playScannerBeep();
                        setIsScanExpenseOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold flex items-center gap-1"
                    >
                      <Camera className="w-3 h-3" />
                      <span>Scan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEntryModal('expense')}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                    >
                      + Expense
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  {dailySummary.expenseItems.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      No manual expenses logged on {selectedDate}.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70">
                      {dailySummary.expenseItems.map(item => (
                        <div
                          key={item.id}
                          className="py-2.5 px-1 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.category} · {item.paymentMode.toUpperCase()}
                              {item.notes ? ` · ${item.notes}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-rose-400 tabular-nums">
                              −{formatCurrency(item.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playAlertSound();
                                onDeleteCashFlowEntry(item.id);
                                showToast('Removed expense entry');
                              }}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Delete expense"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : (
          /* ================= MULTI-DAY CASH FLOW LEDGER ================= */
          <div className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Daily Closing Balance Ledger
                </h3>
                <p className="text-[11px] text-slate-400">
                  Automatic day-to-day cash drawer carryover ending {selectedDate}
                </p>
              </div>
              <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setHistoryRangeDays(7)}
                  className={`px-3 py-1 rounded-lg font-semibold ${
                    historyRangeDays === 7 ? 'bg-slate-800 text-white' : 'text-slate-400'
                  }`}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryRangeDays(14)}
                  className={`px-3 py-1 rounded-lg font-semibold ${
                    historyRangeDays === 14 ? 'bg-slate-800 text-white' : 'text-slate-400'
                  }`}
                >
                  14 Days
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Date</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Opening Cash</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Sales Inflow</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Injections</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Supplier Payouts</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Expenses</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Closing Drawer</th>
                    <th className="py-2.5 px-3 font-semibold text-right">All Modes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 tabular-nums">
                  {historyRows.map(row => (
                    <tr
                      key={row.date}
                      onClick={() => {
                        setSelectedDate(row.date);
                        setSubTab('breakdown');
                      }}
                      className={`cursor-pointer transition hover:bg-slate-800/50 ${
                        row.date === selectedDate ? 'bg-blue-950/30' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">
                        {row.date}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {formatCurrency(row.openingCash)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                        +{formatCurrency(row.totalAutomatedInflow)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-300">
                        +{formatCurrency(row.manualCashInjections)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-400">
                        −{formatCurrency(row.supplierPaymentsTotal)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-300">
                        −{formatCurrency(row.manualExpensesTotal)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-white">
                        {formatCurrency(row.closingCashDrawer)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {formatCurrency(row.closingBalanceAllModes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ================= TRANSACTION ENTRY MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">
                Record Cash Flow Entry ({selectedDate})
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Type Selector */}
            <div className="grid grid-cols-3 gap-1 p-1 mt-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  setEntryType('cash_injection');
                  setEntryCategory('Counter Float');
                  setEntryTitle('Counter Float Top-up');
                }}
                className={`py-1.5 rounded-lg font-bold transition ${
                  entryType === 'cash_injection'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Cash Injection
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryType('supplier_payment');
                  if (!entrySupplierId && suppliers[0]) {
                    setEntrySupplierId(suppliers[0].id);
                  }
                }}
                className={`py-1.5 rounded-lg font-bold transition ${
                  entryType === 'supplier_payment'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Supplier Pay
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryType('expense');
                  setEntryCategory('Transport & Freight');
                  setEntryTitle('');
                }}
                className={`py-1.5 rounded-lg font-bold transition ${
                  entryType === 'expense'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Expense
              </button>
            </div>

            <form onSubmit={handleEntrySubmit} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    autoFocus
                    value={entryAmount}
                    onChange={e => setEntryAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-base font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={entryMode}
                    onChange={e => setEntryMode(e.target.value as CashFlowPaymentMode)}
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="cash">Physical Cash Drawer</option>
                    <option value="upi">UPI / QR</option>
                    <option value="bank">Bank Transfer / NEFT</option>
                  </select>
                </div>
              </div>

              {entryType === 'supplier_payment' ? (
                <>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Select Supplier *
                    </label>
                    <select
                      required
                      value={entrySupplierId}
                      onChange={e => handleSelectSupplierInModal(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    >
                      {suppliers.length === 0 && <option value="">No suppliers found</option>}
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Link to Open Purchase Order (Optional)
                    </label>
                    <select
                      value={entryPoId}
                      onChange={e => handleSelectPoInModal(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Direct payment (No PO linked)</option>
                      {supplierOpenPos.map(po => (
                        <option key={po.id} value={po.id}>
                          {po.poNumber} · Balance Due{' '}
                          {formatCurrency(Math.max(0, po.totalAmount - po.amountPaid))}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      {entryType === 'cash_injection' ? 'Injection Source' : 'Expense Category'}
                    </label>
                    <select
                      value={entryCategory}
                      onChange={e => setEntryCategory(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    >
                      {(entryType === 'cash_injection'
                        ? INJECTION_SOURCES
                        : EXPENSE_CATEGORIES
                      ).map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Description / Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={entryTitle}
                      onChange={e => setEntryTitle(e.target.value)}
                      placeholder={
                        entryType === 'cash_injection'
                          ? 'e.g. Morning change deposit'
                          : 'e.g. Tempo freight or daily helper wages'
                      }
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={entryNotes}
                  onChange={e => setEntryNotes(e.target.value)}
                  placeholder="Voucher / receipt reference"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= OCR EXPENSE RECEIPT SCANNER MODAL ================= */}
      <ScanExpenseModal
        isOpen={isScanExpenseOpen}
        onClose={() => setIsScanExpenseOpen(false)}
        defaultDate={selectedDate}
        onSaveExpenseEntries={(newEntries, navigateToDate) => {
          if (onAddCashFlowEntries) {
            onAddCashFlowEntries(newEntries);
          } else {
            newEntries.forEach(entry => onAddCashFlowEntry(entry));
          }
          if (navigateToDate && navigateToDate !== selectedDate) {
            setSelectedDate(navigateToDate);
          }
          const totalLogged = newEntries.reduce((s, e) => s + e.amount, 0);
          showToast(
            `Scanned & logged ${newEntries.length} expense${newEntries.length > 1 ? 's' : ''} (${formatCurrency(totalLogged)})`
          );
        }}
      />
    </div>
  );
};
