import React, { useState, useMemo } from 'react';
import { Bill, KhataTransaction, DailyReportSummary, Product } from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import { SalesAnalytics } from './SalesAnalytics';
import { PredictiveInventoryPanel } from './PredictiveInventoryPanel';
import {
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Receipt,
  Share2,
  ChevronRight,
  Clock,
  BarChart3,
  Sparkles,
} from 'lucide-react';

interface DailyReportsProps {
  bills: Bill[];
  khata: KhataTransaction[];
  products: Product[];
  onViewBillReceipt: (bill: Bill) => void;
  onRestockProduct: (productId: string, additionalPieces: number) => void;
  onSeedSampleHistory: () => void;
  enablePredictiveAnalytics?: boolean;
  onOpenPerformanceSettings?: () => void;
}

export const DailyReports: React.FC<DailyReportsProps> = ({
  bills,
  khata,
  products,
  onViewBillReceipt,
  onRestockProduct,
  onSeedSampleHistory,
  enablePredictiveAnalytics = true,
  onOpenPerformanceSettings,
}) => {
  const { isMobileLayout } = useViewportLayout();
  const [reportView, setReportView] = useState<'analytics' | 'daily'>('analytics');
  const [predictiveInventoryEnabled, setPredictiveInventoryEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sq_reports_predictive_inventory_v1');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  const handleTogglePredictiveInventory = () => {
    soundManager.playMechanicalClick();
    setPredictiveInventoryEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sq_reports_predictive_inventory_v1', String(next));
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  // Compute stats for selected date
  const reportStats: DailyReportSummary = useMemo(() => {
    const targetBills = bills.filter(b => b.timestamp.slice(0, 10) === selectedDate);
    
    let totalSales = 0;
    let billCashReceived = 0;
    let udharGiven = 0;

    targetBills.forEach(b => {
      totalSales += b.itemsTotal;
      billCashReceived += b.amountReceived;
      // Udhar given is the uncollected portion of items on this bill
      const unpaid = Math.max(0, b.itemsTotal - b.amountReceived);
      udharGiven += unpaid;
    });

    // Payments collected on this date from Khata ledger
    const directPayments = khata.filter(
      k => k.type === 'PAYMENT_COLLECTED' && k.timestamp.slice(0, 10) === selectedDate
    );
    const directCash = directPayments.reduce((acc, curr) => acc + curr.amount, 0);

    return {
      date: selectedDate,
      totalSales,
      cashReceived: billCashReceived + directCash,
      udharGiven,
      billsCount: targetBills.length,
    };
  }, [bills, khata, selectedDate]);

  // Bills for selected date sorted newest first
  const dateBills = useMemo(() => {
    return bills
      .filter(b => b.timestamp.slice(0, 10) === selectedDate)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [bills, selectedDate]);

  // Share Daily Closing on WhatsApp
  const handleShareDaySummary = () => {
    const line = '------------------------------';
    let text = `*SQ ENTERPRISES - DAILY CLOSING REPORT*\n`;
    text += `*Date:* ${selectedDate}\n`;
    text += `${line}\n`;
    text += `*TODAY'S TOTAL SALE:* *₹${reportStats.totalSales.toFixed(2)}*\n`;
    text += `*CASH RECEIVED:* *₹${reportStats.cashReceived.toFixed(2)}*\n`;
    text += `*TOTAL UDHAR GIVEN:* *₹${reportStats.udharGiven.toFixed(2)}*\n`;
    text += `*BILLS GENERATED:* ${reportStats.billsCount}\n`;
    text += `${line}\n`;
    text += `_Generated from SQ ENTERPRISES Android POS_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Top Mode Bar: Sales Analytics & Forecasting vs Daily Closing */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setReportView('analytics');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              reportView === 'analytics'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Analytics &amp; Forecasting</span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setReportView('daily');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              reportView === 'daily'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Daily Closing &amp; Bills</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Predictive Inventory Toggle */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center gap-1.5">
              <Sparkles
                className={`w-3.5 h-3.5 ${
                  predictiveInventoryEnabled ? 'text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span className="text-xs font-bold text-slate-200 whitespace-nowrap">
                Predictive Inventory
              </span>
              <span
                className={`text-[10px] font-bold uppercase ${
                  predictiveInventoryEnabled ? 'text-indigo-400' : 'text-slate-500'
                }`}
              >
                {predictiveInventoryEnabled ? 'On' : 'Off'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={predictiveInventoryEnabled}
              aria-label="Toggle Predictive Inventory 30-day reorder suggestions"
              onClick={handleTogglePredictiveInventory}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                predictiveInventoryEnabled
                  ? 'bg-indigo-600 border-indigo-500'
                  : 'bg-slate-800 border-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  predictiveInventoryEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <span className="text-[11px] text-slate-500 hidden lg:inline">
            {reportView === 'analytics'
              ? 'Daily, weekly, monthly & custom range analytics, movement reports & seasonality'
              : 'Daily cash, udhar & individual receipt lookup'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {predictiveInventoryEnabled && (
          <PredictiveInventoryPanel
            bills={bills}
            products={products}
            onRestockProduct={onRestockProduct}
            onSeedSampleHistory={onSeedSampleHistory}
          />
        )}

      {reportView === 'analytics' ? (
        <SalesAnalytics
          bills={bills}
          products={products}
          onRestockProduct={onRestockProduct}
          onSeedSampleHistory={onSeedSampleHistory}
          enablePredictiveAnalytics={enablePredictiveAnalytics}
          onOpenPerformanceSettings={onOpenPerformanceSettings}
        />
      ) : (
        <>
          {/* Header & Date Selector */}
          <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  DAILY DASHBOARD &amp; REPORTS
                </h2>
                <p className="text-xs text-slate-400">Wholesale business performance &amp; cash summary</p>
              </div>

              <button
                onClick={handleShareDaySummary}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-xl text-xs font-bold transition active:scale-95"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share Report
              </button>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <Calendar className="w-4 h-4 text-slate-400 ml-2" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => {
                  setSelectedDate(e.target.value);
                  soundManager.playMechanicalClick();
                }}
                className="bg-transparent text-white text-xs font-bold focus:outline-none flex-1 py-1"
              />
              {isToday && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Today
                </span>
              )}
            </div>
          </div>

      {/* Daily 3 Core Metrics Grid */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800/80">
        <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'} gap-2.5`}>
          
          {/* Today's Total Sale */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-blue-500/30 shadow-md">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Today's Total Sale
            </span>
            <div className="text-2xl font-black text-white mt-1">
              {formatCurrency(reportStats.totalSales)}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Value of goods billed today</p>
          </div>

          {/* Today's Cash Received */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/30 shadow-md">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5" />
              Today's Cash Received
            </span>
            <div className="text-2xl font-black text-emerald-400 mt-1">
              {formatCurrency(reportStats.cashReceived)}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Bills cash + Khata payments</p>
          </div>

          {/* Today's Total Udhar Given */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-rose-500/30 shadow-md">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              Today's Total Udhar Given
            </span>
            <div className="text-2xl font-black text-rose-400 mt-1">
              {formatCurrency(reportStats.udharGiven)}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">New credit extended today</p>
          </div>

        </div>
      </div>

      {/* Bills Feed for Selected Date */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-blue-400" />
            Bills Generated ({dateBills.length})
          </h3>
          <span className="text-xs text-slate-500">{selectedDate}</span>
        </div>

        {dateBills.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            <Receipt className="w-10 h-10 mx-auto text-slate-600 mb-2 stroke-[1.5]" />
            No bills recorded for this date.
          </div>
        ) : (
          <div className="space-y-2">
            {dateBills.map(bill => (
              <div
                key={bill.id}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onViewBillReceipt(bill);
                }}
                className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition flex items-center justify-between gap-3 group"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm group-hover:text-blue-400 transition">
                      Bill #{bill.billNumber}
                    </span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${bill.isGstBill ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                      {bill.isGstBill ? 'GST' : 'Non-GST'}
                    </span>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {bill.formattedDateTime.split(',')[1] || ''}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 font-semibold mt-0.5 truncate">
                    {bill.customerName} {bill.customerPhone ? `(${bill.customerPhone})` : ''}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                    <span>{bill.items.length} items</span>
                    <span>•</span>
                    <span>Paid: <strong className="text-emerald-400 tabular-nums">₹{bill.amountReceived}</strong></span>
                    {bill.remainingBalance > 0 && (
                      <>
                        <span>•</span>
                        <span>Udhar: <strong className="text-rose-400 tabular-nums">₹{bill.remainingBalance}</strong></span>
                      </>
                    )}
                    {bill.syncStatus === 'pending_offline' && (
                      <>
                        <span>•</span>
                        <span className="text-amber-300 font-semibold">Pending Sync</span>
                      </>
                    )}
                    {bill.syncStatus === 'failed' && (
                      <>
                        <span>•</span>
                        <span className="text-rose-400 font-semibold">Sync Retry Needed</span>
                      </>
                    )}
                    {bill.syncStatus === 'synced' && bill.offlineCreated && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-400 font-semibold">Synced</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right flex items-center gap-2 flex-shrink-0">
                  <div>
                    <span className="text-sm font-black text-white block">
                      {formatCurrency(bill.itemsTotal)}
                    </span>
                    <span className="text-[10px] font-bold text-blue-400 uppercase">
                      View Receipt
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}
      </div>
    </div>
  );
};
