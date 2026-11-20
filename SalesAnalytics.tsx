import React, { useMemo, useState } from 'react';
import {
  Bill,
  Product,
  AnalyticsTimeframe,
  ProductAnalytics,
  DailySoldItemBreakdown,
} from '../types';
import {
  buildDailySalesBreakdown,
  buildSalesAnalyticsReport,
  toLocalDateKey,
} from '../utils/salesAnalytics';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  TrendingUp,
  TrendingDown,
  PackageX,
  Zap,
  Calendar,
  Download,
  Share2,
  Search,
  BarChart3,
  Flame,
  Clock,
  ArrowUpCircle,
  CheckCircle2,
  Database,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trophy,
  Package,
  Gauge,
  Play,
} from 'lucide-react';

interface SalesAnalyticsProps {
  bills: Bill[];
  products: Product[];
  onRestockProduct: (productId: string, additionalPieces: number) => void;
  onSeedSampleHistory: () => void;
  enablePredictiveAnalytics?: boolean;
  onOpenPerformanceSettings?: () => void;
}

type AnalyticsViewTab =
  | 'overview'
  | 'fast_moving'
  | 'slow_moving'
  | 'out_of_stock'
  | 'spikes_seasonal'
  | 'forecast';

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalDateKey(dt);
}

function formatReadableDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatSoldUnitsLabel(item: DailySoldItemBreakdown): string {
  const parts: string[] = [];
  if (item.bundlesSold > 0) {
    parts.push(`${item.bundlesSold} ${item.bundleUnitName}${item.bundlesSold > 1 ? 's' : ''}`);
  }
  if (item.loosePiecesSold > 0) {
    parts.push(`${item.loosePiecesSold} Pcs`);
  }
  return parts.length > 0 ? parts.join(' + ') : `${item.totalPiecesSold} Pcs`;
}

export const SalesAnalytics: React.FC<SalesAnalyticsProps> = ({
  bills,
  products,
  onRestockProduct,
  onSeedSampleHistory,
  enablePredictiveAnalytics = true,
  onOpenPerformanceSettings,
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>('weekly');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => toLocalDateKey(new Date()));
  const [viewTab, setViewTab] = useState<AnalyticsViewTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredBucketKey, setHoveredBucketKey] = useState<string | null>(null);
  const [restockToast, setRestockToast] = useState<string | null>(null);
  const [expandedDayKeys, setExpandedDayKeys] = useState<Record<string, boolean>>({});
  const [forceRunPredictiveOnce, setForceRunPredictiveOnce] = useState(false);

  const effectivePredictive = enablePredictiveAnalytics || forceRunPredictiveOnce;

  const todayKey = toLocalDateKey(new Date());
  const [customStartDate, setCustomStartDate] = useState<string>(() =>
    shiftDateKey(toLocalDateKey(new Date()), -13)
  );
  const [customEndDate, setCustomEndDate] = useState<string>(() => toLocalDateKey(new Date()));

  const earliestBillDateKey = useMemo(() => {
    let minKey = todayKey;
    bills.forEach(bill => {
      const dt = new Date(bill.timestamp);
      if (!Number.isFinite(dt.getTime())) return;
      const key = toLocalDateKey(dt);
      if (key < minKey) minKey = key;
    });
    return minKey;
  }, [bills, todayKey]);

  const targetAnchorDate = useMemo(() => {
    if (timeframe !== 'daily') return new Date();
    const [y, m, d] = selectedDateKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  }, [timeframe, selectedDateKey]);

  const report = useMemo(
    () =>
      buildSalesAnalyticsReport(
        bills,
        products,
        timeframe,
        targetAnchorDate,
        timeframe === 'custom'
          ? { startDate: customStartDate, endDate: customEndDate }
          : undefined,
        { includePredictive: effectivePredictive }
      ),
    [bills, products, timeframe, targetAnchorDate, customStartDate, customEndDate, effectivePredictive]
  );

  const dailyBreakdowns = useMemo(
    () => buildDailySalesBreakdown(bills, products, 45),
    [bills, products]
  );

  const selectedDayBreakdown = useMemo(
    () => dailyBreakdowns.find(d => d.dateKey === selectedDateKey) || null,
    [dailyBreakdowns, selectedDateKey]
  );

  const filteredDailyItems = useMemo(() => {
    if (!selectedDayBreakdown) return [];
    if (!searchQuery.trim()) return selectedDayBreakdown.items;
    const q = searchQuery.toLowerCase();
    return selectedDayBreakdown.items.filter(
      item =>
        item.productName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [selectedDayBreakdown, searchQuery]);

  const filteredDayHistory = useMemo(() => {
    if (!searchQuery.trim()) return dailyBreakdowns;
    const q = searchQuery.toLowerCase();
    return dailyBreakdowns
      .map(day => ({
        ...day,
        items: day.items.filter(
          item =>
            item.productName.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
        ),
      }))
      .filter(day => day.items.length > 0);
  }, [dailyBreakdowns, searchQuery]);

  const combinedChartSeries = useMemo(
    () => [...report.series, ...report.forecastSeries],
    [report.series, report.forecastSeries]
  );

  const maxChartRevenue = useMemo(
    () => Math.max(100, ...combinedChartSeries.map(b => b.revenue)),
    [combinedChartSeries]
  );

  const maxDailyVelocity = useMemo(
    () => Math.max(1, ...report.allProducts.map(p => p.dailyVelocity)),
    [report.allProducts]
  );

  const maxWeekdayAvg = useMemo(
    () => Math.max(100, ...report.weekdaySeasonality.map(w => w.avgRevenue)),
    [report.weekdaySeasonality]
  );

  // Filter product table based on active tab & search (Weekly/Monthly)
  const displayedProducts = useMemo(() => {
    let base: ProductAnalytics[] = report.allProducts;
    if (viewTab === 'fast_moving') base = report.fastMoving;
    else if (viewTab === 'slow_moving') base = report.slowMoving;
    else if (viewTab === 'out_of_stock') {
      base = [
        ...report.outOfStock,
        ...report.criticalLowStock.filter(p => p.currentStockPieces > 0),
      ];
    } else if (viewTab === 'forecast') {
      base = [...report.allProducts].sort(
        (a, b) => b.predicted30dDemand - a.predicted30dDemand
      );
    }

    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(
      p =>
        p.productName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [report, viewTab, searchQuery]);

  // Quick 1-tap restock action
  const handleQuickReorder = (
    productId: string,
    productName: string,
    recommendedReorderPieces: number,
    bundlePieces: number
  ) => {
    const qtyToAdd =
      recommendedReorderPieces > 0 ? recommendedReorderPieces : bundlePieces || 24;
    soundManager.playCheckoutSuccess();
    onRestockProduct(productId, qtyToAdd);
    setRestockToast(`Added +${qtyToAdd} pcs to ${productName}`);
    setTimeout(() => setRestockToast(null), 2500);
  };

  // Export CSV Report
  const handleExportCsv = () => {
    soundManager.playMechanicalClick();

    if (timeframe === 'daily') {
      const itemsToExport = selectedDayBreakdown?.items || [];
      const headers = [
        'Rank',
        'Date',
        'Product',
        'Category',
        'Bundles Sold',
        'Loose Pieces Sold',
        'Total Pieces Sold',
        'Day Qty Share (%)',
        'Bills Count',
        'Avg Rate (INR/Pc)',
        'Revenue (INR)',
        'Current Stock (Pcs)',
      ];
      const rows = itemsToExport.map((item, idx) => [
        idx + 1,
        selectedDateKey,
        `"${item.productName.replace(/"/g, '""')}"`,
        `"${item.category.replace(/"/g, '""')}"`,
        item.bundlesSold,
        item.loosePiecesSold,
        item.totalPiecesSold,
        item.shareOfDayQuantityPct,
        item.ordersCount,
        item.avgUnitPrice,
        item.revenue,
        item.currentStockPieces,
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sq-enterprises-daily-items-${selectedDateKey}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const headers = [
      'Product',
      'Category',
      'Movement Tier',
      'Current Stock (Pcs)',
      'Units Sold (Pcs)',
      'Revenue (INR)',
      'Daily Velocity (Pcs/Day)',
      'Days of Cover',
      'Predicted 7D Demand (Pcs)',
      'Predicted 30D Demand (Pcs)',
      'Recommended Reorder (Pcs)',
      'Demand Spike',
    ];

    const rows = report.allProducts.map(p => [
      `"${p.productName.replace(/"/g, '""')}"`,
      `"${p.category.replace(/"/g, '""')}"`,
      p.movementTier,
      p.currentStockPieces,
      p.unitsSoldPieces,
      p.revenue,
      p.dailyVelocity,
      p.daysOfCover >= 999 ? '999+' : p.daysOfCover,
      p.predicted7dDemand,
      p.predicted30dDemand,
      p.recommendedReorderPieces,
      p.isSpikeActive ? `${p.spikeMultiplier}x` : 'No',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      timeframe === 'custom'
        ? `sq-enterprises-custom-${report.startDateKey}-to-${report.endDateKey}.csv`
        : `sq-enterprises-${timeframe}-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Share Daily / Weekly / Monthly Summary on WhatsApp
  const handleShareAnalyticsWhatsApp = () => {
    soundManager.playMechanicalClick();

    if (timeframe === 'daily') {
      const topItems = (selectedDayBreakdown?.items || [])
        .slice(0, 8)
        .map(
          (item, i) =>
            `${i + 1}. ${item.productName} — *${item.totalPiecesSold} pcs* (${formatSoldUnitsLabel(
              item
            )}) · ${formatCurrency(item.revenue)}`
        )
        .join('\n');

      let msg = `*SQ ENTERPRISES — DAILY ITEM SALES (${formatReadableDate(selectedDateKey)})*\n`;
      msg += `Revenue: *${formatCurrency(report.totalRevenue)}* (${report.revenueChangePct >= 0 ? '+' : ''}${report.revenueChangePct}% vs prior day)\n`;
      msg += `Total Units Sold: *${report.totalPiecesSold} pcs* across ${report.totalBills} bills\n\n`;
      if (topItems) {
        msg += `*Highest-Selling Items (By Qty):*\n${topItems}`;
      } else {
        msg += `No items recorded on this date.`;
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
      return;
    }

    const periodLabel =
      timeframe === 'weekly'
        ? 'WEEKLY (7D)'
        : timeframe === 'monthly'
        ? 'MONTHLY (30D)'
        : `CUSTOM (${report.startDateKey} to ${report.endDateKey}, ${report.windowDays}D)`;
    const topFast = report.fastMoving
      .slice(0, 3)
      .map((p, i) => `${i + 1}. ${p.productName} (${p.unitsSoldPieces} pcs · ${p.dailyVelocity}/day)`)
      .join('\n');
    const oos = [...report.outOfStock, ...report.criticalLowStock]
      .slice(0, 3)
      .map(p => `- ${p.productName}: ${p.currentStockPieces} pcs left (Need +${p.recommendedReorderPieces}p)`)
      .join('\n');

    let msg = `*SQ ENTERPRISES — ${periodLabel} ANALYTICS & FORECAST*\n`;
    msg += `Revenue: *${formatCurrency(report.totalRevenue)}* (${report.revenueChangePct >= 0 ? '+' : ''}${report.revenueChangePct}%)\n`;
    msg += `Volume Sold: *${report.totalPiecesSold} pcs* across ${report.totalBills} bills\n`;
    msg += `Next ${report.windowDays}D Forecast: *${formatCurrency(report.predictedNextPeriodRevenue)}* (~${report.predictedNextPeriodPieces} pcs)\n\n`;
    if (topFast) msg += `*Top Fast-Moving:*\n${topFast}\n\n`;
    if (oos) msg += `*Urgent Reorder Alerts:*\n${oos}\n\n`;
    if (report.demandSpikes.length > 0) {
      msg += `*Demand Spikes:* ${report.demandSpikes[0].productName} (${report.demandSpikes[0].multiplier}x normal)\n`;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const hoveredBucket =
    combinedChartSeries.find(b => b.key === hoveredBucketKey) || null;

  const productLookupMap = useMemo(() => {
    const map = new Map<string, ProductAnalytics>();
    report.allProducts.forEach(p => map.set(p.productId, p));
    return map;
  }, [report.allProducts]);

  return (
    <div className="flex flex-col bg-slate-950 text-slate-100">
      {/* Top Toolbar */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              Sales Analytics &amp; Demand Forecasting
            </h2>
            <p className="text-xs text-slate-400 tabular-nums">
              {timeframe === 'daily'
                ? `Daily Item Breakdown (${formatReadableDate(selectedDateKey)})`
                : timeframe === 'weekly'
                ? '7-Day Rolling Window'
                : timeframe === 'monthly'
                ? '30-Day Monthly Window'
                : `Custom Range (${formatReadableDate(report.startDateKey)} – ${formatReadableDate(report.endDateKey)} · ${report.windowDays}d)`}
              {' · '}
              {report.totalBills}{' '}
              {timeframe === 'daily'
                ? 'bills on selected date'
                : timeframe === 'custom'
                ? 'bills in selected range'
                : 'historical bills analyzed'}
              {' · '}
              {timeframe === 'daily' ? 'Sorted by quantity sold' : 'Velocity-weighted seasonal projections'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period Segmented Switch: Daily | Weekly (7D) | Monthly (30D) */}
            <div
              role="tablist"
              aria-label="Analytics timeframe"
              className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={timeframe === 'daily'}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setTimeframe('daily');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                  timeframe === 'daily'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timeframe === 'weekly'}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setTimeframe('weekly');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                  timeframe === 'weekly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Weekly (7D)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timeframe === 'monthly'}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setTimeframe('monthly');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                  timeframe === 'monthly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Monthly (30D)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timeframe === 'custom'}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setTimeframe('custom');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                  timeframe === 'custom'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Custom Range</span>
              </button>
            </div>

            {bills.length < 5 && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playScannerBeep();
                  onSeedSampleHistory();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-bold transition"
                title="Populate 60 days of realistic wholesale bills so you can explore daily, weekly & monthly breakdowns"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Load 60-Day Sales History</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">CSV</span>
            </button>

            <button
              type="button"
              onClick={handleShareAnalyticsWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>
          </div>
        </div>

        {/* Custom Date Range Selector Toolbar */}
        {timeframe === 'custom' && (
          <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span>Date Range</span>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>From</span>
                <input
                  type="date"
                  value={customStartDate}
                  max={todayKey}
                  onChange={e => {
                    const nextStart = e.target.value;
                    if (!nextStart) return;
                    soundManager.playMechanicalClick();
                    setCustomStartDate(nextStart);
                    if (nextStart > customEndDate) {
                      setCustomEndDate(nextStart);
                    }
                  }}
                  aria-label="Custom range start date"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </label>

              <span className="text-xs text-slate-500">&rarr;</span>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>To</span>
                <input
                  type="date"
                  value={customEndDate}
                  max={todayKey}
                  onChange={e => {
                    const nextEnd = e.target.value;
                    if (!nextEnd) return;
                    soundManager.playMechanicalClick();
                    setCustomEndDate(nextEnd);
                    if (nextEnd < customStartDate) {
                      setCustomStartDate(nextEnd);
                    }
                  }}
                  aria-label="Custom range end date"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </label>

              <span className="text-[11px] font-mono tabular-nums text-blue-300 font-semibold">
                {report.windowDays} {report.windowDays === 1 ? 'day' : 'days'} selected
              </span>
            </div>

            {/* Quick Custom Range Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                {
                  label: 'Last 14D',
                  start: shiftDateKey(todayKey, -13),
                  end: todayKey,
                },
                {
                  label: 'This Month',
                  start: `${todayKey.slice(0, 7)}-01`,
                  end: todayKey,
                },
                {
                  label: 'Last Month',
                  start: (() => {
                    const now = new Date();
                    return toLocalDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
                  })(),
                  end: (() => {
                    const now = new Date();
                    return toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), 0));
                  })(),
                },
                {
                  label: 'Last 90D',
                  start: shiftDateKey(todayKey, -89),
                  end: todayKey,
                },
                ...(earliestBillDateKey < todayKey
                  ? [
                      {
                        label: 'All History',
                        start: earliestBillDateKey,
                        end: todayKey,
                      },
                    ]
                  : []),
              ].map(preset => {
                const isActive =
                  customStartDate === preset.start && customEndDate === preset.end;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setCustomStartDate(preset.start);
                      setCustomEndDate(preset.end);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/25 border-blue-500 text-blue-200'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sub-Report Navigation Tabs (Weekly / Monthly / Custom Range views) */}
        {timeframe !== 'daily' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {[
              { id: 'overview', label: 'Overview & Chart' },
              { id: 'fast_moving', label: `Fast-Moving (${report.fastMoving.length})` },
              { id: 'slow_moving', label: `Slow-Moving (${report.slowMoving.length})` },
              {
                id: 'out_of_stock',
                label: `Stockouts & Low (${report.outOfStock.length + report.criticalLowStock.length})`,
              },
              {
                id: 'spikes_seasonal',
                label: `Spikes (${report.demandSpikes.length}) & Seasonality`,
              },
              { id: 'forecast', label: 'Demand Forecast & Reorder' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setViewTab(tab.id as AnalyticsViewTab);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition ${
                  viewTab === tab.id
                    ? 'bg-slate-800 text-white border-blue-500/60'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Toast Notification for Restock */}
      {restockToast && (
        <div className="mx-4 mt-3 px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{restockToast}</span>
        </div>
      )}

      {/* Performance Manager Predictive Engine Notice */}
      {!enablePredictiveAnalytics && (
        <div className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-amber-500/35 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Gauge className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="text-xs min-w-0">
              <span className="font-bold text-white">
                {forceRunPredictiveOnce
                  ? 'On-Demand Predictive Analysis Active'
                  : 'Predictive Analytics & Forecasting Paused'}
              </span>
              <span className="text-slate-400 ml-1.5">
                {forceRunPredictiveOnce
                  ? 'Showing manual snapshot while automatic forecasting remains paused in Performance Manager.'
                  : '60-day seasonality, demand spike math & 7D/30D projections are skipped for max speed.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setForceRunPredictiveOnce(prev => !prev);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 border transition whitespace-nowrap ${
                forceRunPredictiveOnce
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
              }`}
            >
              <Play className="w-3 h-3" />
              {forceRunPredictiveOnce ? 'Pause Preview' : 'Run Predictive Analysis Once'}
            </button>
            {onOpenPerformanceSettings && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOpenPerformanceSettings();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-300 transition whitespace-nowrap"
              >
                Performance Settings
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* DAILY VIEW: ITEMS SOLD PER DAY SORTED BY QUANTITY */}
      {/* ===================================================================== */}
      {timeframe === 'daily' ? (
        <div className="p-4 space-y-4">
          {/* Date Picker & Quick Active Day Switcher */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white">
                  {selectedDateKey === todayKey
                    ? `Today · ${formatReadableDate(selectedDateKey)}`
                    : formatReadableDate(selectedDateKey)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setSelectedDateKey(prev => shiftDateKey(prev, -1));
                  }}
                  className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition"
                  title="Previous Day"
                  aria-label="Previous day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="date"
                  value={selectedDateKey}
                  max={todayKey}
                  onChange={e => {
                    if (e.target.value) setSelectedDateKey(e.target.value);
                  }}
                  aria-label="Select date for daily item sales breakdown"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={selectedDateKey >= todayKey}
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setSelectedDateKey(prev => shiftDateKey(prev, 1));
                  }}
                  className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition disabled:opacity-40"
                  title="Next Day"
                  aria-label="Next day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                {selectedDateKey !== todayKey && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setSelectedDateKey(todayKey);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-[11px] font-bold transition whitespace-nowrap"
                  >
                    Today
                  </button>
                )}
              </div>
            </div>

            {/* Recent Active Sales Days Strip */}
            {dailyBreakdowns.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                {dailyBreakdowns.slice(0, 10).map(day => {
                  const isActive = day.dateKey === selectedDateKey;
                  return (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setSelectedDateKey(day.dateKey);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-left transition flex-shrink-0 ${
                        isActive
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      <div className="text-[11px] font-bold whitespace-nowrap">
                        {day.dateKey === todayKey ? 'Today' : `${day.weekdayName}, ${day.label.slice(0, 6)}`}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {day.totalPiecesSold} pcs · {formatCurrency(day.totalRevenue)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4 Daily KPIs */}
          <div
            className={`grid ${
              isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
            } gap-3`}
          >
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Day Revenue
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono tabular-nums mt-1">
                {formatCurrency(selectedDayBreakdown?.totalRevenue ?? report.totalRevenue)}
              </div>
              <div className="text-[11px] mt-1 flex items-center gap-1.5 text-slate-400 tabular-nums">
                {report.revenueChangePct >= 0 ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" />+{report.revenueChangePct}%
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold flex items-center gap-0.5">
                    <TrendingDown className="w-3 h-3" />
                    {report.revenueChangePct}%
                  </span>
                )}
                <span>vs prior day</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Quantity Sold
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono tabular-nums mt-1">
                {(selectedDayBreakdown?.totalPiecesSold ?? 0).toLocaleString('en-IN')}{' '}
                <span className="text-xs font-semibold text-slate-400">pcs</span>
              </div>
              <div className="text-[11px] mt-1 text-slate-400 tabular-nums">
                {selectedDayBreakdown?.billsCount ?? 0} bills · {selectedDayBreakdown?.uniqueSkusSold ?? 0} unique SKUs
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/30">
              <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5" />
                #1 Highest-Selling Item
              </div>
              {selectedDayBreakdown?.topSellerName ? (
                <>
                  <div className="text-sm sm:text-base font-black text-white mt-1 truncate">
                    {selectedDayBreakdown.topSellerEmoji} {selectedDayBreakdown.topSellerName}
                  </div>
                  <div className="text-[11px] mt-1 text-emerald-300 font-mono tabular-nums font-bold">
                    {selectedDayBreakdown.topSellerPieces.toLocaleString('en-IN')} pcs (
                    {selectedDayBreakdown.items[0]?.shareOfDayQuantityPct ?? 0}% of day&apos;s qty)
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-bold text-slate-400 mt-1">No sales on this date</div>
                  <div className="text-[11px] mt-1 text-slate-500">Pick an active sales date above</div>
                </>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Stock Risk Alerts
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono tabular-nums mt-1">
                {report.outOfStock.length + report.criticalLowStock.length}{' '}
                <span className="text-xs font-semibold text-amber-400">risk SKUs</span>
              </div>
              <div className="text-[11px] mt-1 text-slate-400 tabular-nums">
                {report.outOfStock.length} out of stock · {report.demandSpikes.length} demand spikes
              </div>
            </div>
          </div>

          {/* Selected Day Detailed Items Breakdown (Sorted by Quantity Descending) */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-400" />
                  Items Sold Breakdown &mdash; {formatReadableDate(selectedDateKey)}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Sorted descending by total quantity sold to highlight highest-selling products
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter item or category..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {!selectedDayBreakdown || filteredDailyItems.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-3 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                <p className="text-xs text-slate-400">
                  {selectedDayBreakdown
                    ? 'No sold items on this date match your search filter.'
                    : `No items were billed on ${formatReadableDate(selectedDateKey)}.`}
                </p>
                {!selectedDayBreakdown && dailyBreakdowns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setSelectedDateKey(dailyBreakdowns[0].dateKey);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                  >
                    Jump to Latest Sales Day ({dailyBreakdowns[0].label} ·{' '}
                    {dailyBreakdowns[0].totalPiecesSold} pcs)
                  </button>
                )}
                {bills.length < 5 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playScannerBeep();
                        onSeedSampleHistory();
                      }}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold transition inline-flex items-center gap-1.5"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Populate 60-Day Demo Sales History</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-2 w-12">Rank</th>
                      <th className="py-2 px-2">Product</th>
                      <th className="py-2 px-2">Sold Units</th>
                      <th className="py-2 px-2 text-right">Total Qty (Pcs)</th>
                      <th className="py-2 px-2 min-w-[120px]">Qty Share</th>
                      <th className="py-2 px-2 text-right">Bills</th>
                      <th className="py-2 px-2 text-right">Revenue</th>
                      <th className="py-2 pl-2 text-right">Stock / Restock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredDailyItems.map((item, idx) => {
                      const rank = idx + 1;
                      const isTop3 = rank <= 3;
                      const prodMeta = productLookupMap.get(item.productId);
                      const needsRestock =
                        item.currentStockPieces <= item.lowStockThreshold ||
                        (prodMeta?.recommendedReorderPieces ?? 0) > 0;
                      const maxItemPcs = Math.max(1, filteredDailyItems[0]?.totalPiecesSold || 1);
                      const barPct = Math.max(
                        4,
                        Math.round((item.totalPiecesSold / maxItemPcs) * 100)
                      );

                      return (
                        <tr
                          key={item.productId}
                          className={`transition ${
                            rank === 1
                              ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                              : 'hover:bg-slate-950/60'
                          }`}
                        >
                          <td className="py-2.5 pr-2 font-mono tabular-nums whitespace-nowrap">
                            <span
                              className={`font-black text-xs ${
                                rank === 1
                                  ? 'text-emerald-400'
                                  : isTop3
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
                              }`}
                            >
                              #{rank}
                            </span>
                          </td>

                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2">
                              <span>{item.emoji}</span>
                              <div className="min-w-0">
                                <div className="font-bold text-white truncate max-w-[200px]">
                                  {item.productName}
                                </div>
                                <div className="text-[10px] text-slate-400">{item.category}</div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 whitespace-nowrap text-[11px] font-semibold text-slate-200 tabular-nums">
                            {formatSoldUnitsLabel(item)}
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            <span
                              className={`font-black ${
                                rank === 1 ? 'text-emerald-300' : 'text-white'
                              }`}
                            >
                              {item.totalPiecesSold.toLocaleString('en-IN')} pcs
                            </span>
                          </td>

                          <td className="py-2.5 px-2 min-w-[120px]">
                            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1 text-slate-300">
                              <span>{item.shareOfDayQuantityPct}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                              <div
                                style={{ width: `${barPct}%` }}
                                className={`h-full rounded-full ${
                                  rank === 1
                                    ? 'bg-emerald-500'
                                    : isTop3
                                    ? 'bg-blue-400'
                                    : 'bg-slate-500'
                                }`}
                              />
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                            {item.ordersCount}
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-bold text-white">
                              {formatCurrency(item.revenue)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatCurrency(item.avgUnitPrice)}/pc
                            </div>
                          </td>

                          <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                            <div
                              className={`font-mono text-[11px] font-bold tabular-nums ${
                                item.currentStockPieces <= 0 ? 'text-rose-400' : 'text-slate-300'
                              }`}
                            >
                              {item.currentStockPieces <= 0
                                ? 'Out of stock'
                                : formatStockDisplay(
                                    item.currentStockPieces,
                                    item.bundlePieces,
                                    item.bundleUnitName
                                  ).text}
                            </div>
                            {needsRestock && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickReorder(
                                    item.productId,
                                    item.productName,
                                    prodMeta?.recommendedReorderPieces ?? item.bundlePieces,
                                    item.bundlePieces
                                  )
                                }
                                className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold transition"
                              >
                                <ArrowUpCircle className="w-3 h-3" />
                                <span>
                                  +{prodMeta?.recommendedReorderPieces || item.bundlePieces}p
                                </span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Day-by-Day Items Sold History (Each Day Sorted by Quantity) */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Day-by-Day Sales Breakdown (Recent {filteredDayHistory.length} Active Days)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Expand any day to inspect every item sold sorted by quantity, or click Focus Day to load it above.
                </p>
              </div>
            </div>

            {filteredDayHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No historical daily sales available yet.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDayHistory.slice(0, 20).map(day => {
                  const isExpanded = Boolean(expandedDayKeys[day.dateKey]);
                  const isFocused = day.dateKey === selectedDateKey;

                  return (
                    <div
                      key={day.dateKey}
                      className={`rounded-xl border transition-colors ${
                        isFocused
                          ? 'bg-slate-950 border-blue-500/60'
                          : 'bg-slate-950/70 border-slate-800'
                      }`}
                    >
                      <div className="p-3 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playMechanicalClick();
                            setExpandedDayKeys(prev => ({
                              ...prev,
                              [day.dateKey]: !prev[day.dateKey],
                            }));
                          }}
                          className="flex items-center gap-2.5 text-left flex-1 min-w-0"
                          aria-expanded={isExpanded}
                        >
                          <ChevronDown
                            className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
                              isExpanded ? 'rotate-180 text-white' : ''
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              {day.dateKey === todayKey ? 'Today · ' : ''}
                              {day.weekdayName}, {day.label}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate tabular-nums">
                              Top Seller: {day.topSellerEmoji} {day.topSellerName || '—'} ({day.topSellerPieces} pcs)
                              {' · '}
                              {day.uniqueSkusSold} items sold
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right font-mono tabular-nums">
                            <div className="text-xs font-black text-white">
                              {day.totalPiecesSold.toLocaleString('en-IN')} pcs
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatCurrency(day.totalRevenue)} · {day.billsCount} bills
                            </div>
                          </div>

                          {!isFocused && (
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playMechanicalClick();
                                setSelectedDateKey(day.dateKey);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-bold text-slate-200 transition whitespace-nowrap"
                            >
                              Focus Day
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-3 pb-3 pt-2 border-t border-slate-800/80 overflow-x-auto">
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                                <th className="py-1.5 pr-2 w-10">#</th>
                                <th className="py-1.5 px-2">Item</th>
                                <th className="py-1.5 px-2">Sold Units</th>
                                <th className="py-1.5 px-2 text-right">Qty (Pcs)</th>
                                <th className="py-1.5 px-2 text-right">Share</th>
                                <th className="py-1.5 pl-2 text-right">Revenue</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {day.items.map((item, idx) => (
                                <tr key={item.productId} className="hover:bg-slate-900/60">
                                  <td className="py-1.5 pr-2 font-mono tabular-nums font-bold text-slate-400">
                                    #{idx + 1}
                                  </td>
                                  <td className="py-1.5 px-2 font-semibold text-white">
                                    {item.emoji} {item.productName}
                                  </td>
                                  <td className="py-1.5 px-2 text-slate-300 tabular-nums">
                                    {formatSoldUnitsLabel(item)}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-300 tabular-nums">
                                    {item.totalPiecesSold} pcs
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-slate-400 tabular-nums">
                                    {item.shareOfDayQuantityPct}%
                                  </td>
                                  <td className="py-1.5 pl-2 text-right font-mono font-bold text-white tabular-nums">
                                    {formatCurrency(item.revenue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ===================================================================== */
        /* WEEKLY / MONTHLY VIEW (PRESERVED ANALYTICS & DEMAND FORECASTING) */
        /* ===================================================================== */
        <div className="p-4 space-y-4">
          {/* 4 Core Analytics KPIs */}
          <div
            className={`grid ${
              isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
            } gap-3`}
          >
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {timeframe === 'weekly'
                  ? '7-Day Revenue'
                  : timeframe === 'monthly'
                  ? '30-Day Revenue'
                  : `${report.windowDays}-Day Range Revenue`}
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono tabular-nums mt-1">
                {formatCurrency(report.totalRevenue)}
              </div>
              <div className="text-[11px] mt-1 flex items-center gap-1.5 text-slate-400">
                {report.revenueChangePct >= 0 ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" />+{report.revenueChangePct}%
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold flex items-center gap-0.5">
                    <TrendingDown className="w-3 h-3" />
                    {report.revenueChangePct}%
                  </span>
                )}
                <span>vs prior {report.windowDays}d</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Units Sold
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono mt-1">
                {report.totalPiecesSold.toLocaleString('en-IN')}{' '}
                <span className="text-xs font-semibold text-slate-400">pcs</span>
              </div>
              <div className="text-[11px] mt-1 text-slate-400">
                {report.totalBills} bills · Avg {formatCurrency(report.avgOrderValue)}/bill
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-blue-500/30">
              <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                Predicted Next {report.windowDays}D
              </div>
              {effectivePredictive ? (
                <>
                  <div className="text-xl sm:text-2xl font-black text-blue-300 font-mono tabular-nums mt-1">
                    {formatCurrency(report.predictedNextPeriodRevenue)}
                  </div>
                  <div className="text-[11px] mt-1 text-slate-400 tabular-nums">
                    Est. ~{report.predictedNextPeriodPieces.toLocaleString('en-IN')} pcs demand
                  </div>
                </>
              ) : (
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-amber-300">Paused</div>
                    <div className="text-[10px] text-slate-400">Fast speed mode</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setForceRunPredictiveOnce(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600/25 hover:bg-blue-600/40 border border-blue-500/40 text-blue-200 text-[10.5px] font-bold transition whitespace-nowrap"
                  >
                    Run Once
                  </button>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Inventory &amp; Spike Alerts
              </div>
              <div className="text-xl sm:text-2xl font-black text-white font-mono mt-1">
                {report.outOfStock.length + report.criticalLowStock.length}{' '}
                <span className="text-xs font-semibold text-amber-400">
                  risk SKUs
                </span>
              </div>
              <div className="text-[11px] mt-1 text-slate-400">
                {report.outOfStock.length} out of stock · {report.demandSpikes.length} demand spikes
              </div>
            </div>
          </div>

          {/* Empty History Helper */}
          {report.totalBills === 0 && (
            <div className="p-5 rounded-xl bg-slate-900 border border-dashed border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  No sales recorded in the selected {report.windowDays}-day window
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete bills in the Billing tab or load 60-day sample wholesale sales history to inspect velocity forecasts, spikes, and seasonal curves.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playScannerBeep();
                  onSeedSampleHistory();
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                <Database className="w-4 h-4" />
                <span>Populate 60-Day Demo Sales History</span>
              </button>
            </div>
          )}

          {/* OVERVIEW & FORECAST BAR CHART */}
          {(viewTab === 'overview' || viewTab === 'forecast') && (
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Historical Sales &amp; Velocity-Based Forecast
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Solid bars: actual daily billing · Dashed emerald bars: weekday-adjusted velocity forecast
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-300">
                  {hoveredBucket ? (
                    <span>
                      {hoveredBucket.isForecast ? 'Forecast ' : ''}
                      {hoveredBucket.label}:{' '}
                      <strong className="text-white">
                        {formatCurrency(hoveredBucket.revenue)}
                      </strong>{' '}
                      ({hoveredBucket.piecesSold} pcs)
                    </span>
                  ) : (
                    <span className="text-slate-500">Hover any bar for daily breakdown</span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="min-w-[540px] h-44 flex items-end gap-1 pt-4 border-b border-slate-800">
                  {combinedChartSeries.map(bucket => {
                    const pctHeight = Math.max(
                      4,
                      Math.round((bucket.revenue / maxChartRevenue) * 100)
                    );
                    const isHovered = hoveredBucketKey === bucket.key;
                    return (
                      <div
                        key={bucket.key}
                        onMouseEnter={() => setHoveredBucketKey(bucket.key)}
                        onMouseLeave={() => setHoveredBucketKey(null)}
                        className="flex-1 flex flex-col items-center justify-end h-full group cursor-pointer"
                      >
                        <div
                          style={{ height: `${pctHeight}%` }}
                          className={`w-full rounded-t transition-all ${
                            bucket.isForecast
                              ? isHovered
                                ? 'bg-emerald-400/70 border border-dashed border-emerald-300'
                                : 'bg-emerald-500/25 border border-dashed border-emerald-500/60'
                              : isHovered
                              ? 'bg-blue-400'
                              : 'bg-blue-600/80'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="min-w-[540px] flex justify-between text-[10px] text-slate-500 font-mono mt-1.5">
                  <span>{combinedChartSeries[0]?.label}</span>
                  <span className="text-blue-400">
                    Actual ({report.windowDays}d{report.windowDays > 62 ? ' · weekly bars' : ''}) &rarr; Forecast ({report.forecastSeries.length}d)
                  </span>
                  <span>{combinedChartSeries[combinedChartSeries.length - 1]?.label}</span>
                </div>
              </div>
            </div>
          )}

          {/* SPIKES & SEASONAL TRENDS SECTION */}
          {(viewTab === 'overview' || viewTab === 'spikes_seasonal') && (
            <div className={`grid ${isDesktopLayout ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
              {/* Demand Spikes Tracker */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Flame className="w-4 h-4 text-amber-400" />
                    Demand Spike Detector ({report.demandSpikes.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Threshold: &ge;1.5x baseline velocity
                  </span>
                </div>

                {report.demandSpikes.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    No abnormal demand surges detected in this window. Velocity is steady.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {report.demandSpikes.map(spike => (
                      <div
                        key={spike.productId}
                        className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span>{spike.emoji}</span>
                            <span className="font-bold text-white text-xs truncate">
                              {spike.productName}
                            </span>
                            <span
                              className={`text-[10px] font-black font-mono ${
                                spike.severity === 'high' ? 'text-rose-400' : 'text-amber-400'
                              }`}
                            >
                              {spike.multiplier}x surge
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Baseline {spike.baselineDailyVelocity}/day &rarr; Spike {spike.spikeVelocity}/day
                            {' · '}Peak {spike.peakUnitsSold} pcs on {spike.peakDate}
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-bold text-slate-200 font-mono">
                            {spike.currentStockPieces} pcs left
                          </div>
                          <div
                            className={`text-[10px] font-semibold ${
                              spike.daysOfCoverAtSpike <= 3 ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {spike.daysOfCoverAtSpike >= 999
                              ? 'Adequate'
                              : `~${spike.daysOfCoverAtSpike}d at spike pace`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Seasonal Trends: Weekday Pattern & Category Momentum */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-purple-400" />
                    Seasonal Trends &amp; Peak Days
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">{report.seasonalSummary}</p>
                </div>

                {/* Weekday Distribution Bars */}
                <div className="grid grid-cols-7 gap-2 items-end h-24 pt-2">
                  {report.weekdaySeasonality.map(wd => {
                    const h = Math.max(8, Math.round((wd.avgRevenue / maxWeekdayAvg) * 100));
                    const isPeak = report.peakWeekday?.dayIndex === wd.dayIndex && wd.avgRevenue > 0;
                    return (
                      <div key={wd.dayIndex} className="flex flex-col items-center gap-1 h-full justify-end">
                        <span className="text-[9px] font-mono text-slate-400">
                          {wd.avgRevenue > 0 ? `${wd.indexScore}x` : '-'}
                        </span>
                        <div
                          style={{ height: `${h}%` }}
                          className={`w-full rounded-t ${
                            isPeak ? 'bg-purple-500' : 'bg-slate-700'
                          }`}
                          title={`${wd.dayName}: Avg ${formatCurrency(wd.avgRevenue)} (${wd.avgPieces} pcs)`}
                        />
                        <span
                          className={`text-[10px] font-bold ${
                            isPeak ? 'text-purple-300' : 'text-slate-400'
                          }`}
                        >
                          {wd.dayName}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Category Seasonal Momentum */}
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Category Velocity &amp; Seasonal Multiplier
                  </div>
                  {report.categoryTrends.length === 0 ? (
                    <p className="text-xs text-slate-500">No category billing recorded yet.</p>
                  ) : (
                    report.categoryTrends.slice(0, 4).map(cat => (
                      <div
                        key={cat.category}
                        className="flex items-center justify-between text-xs py-1"
                      >
                        <span className="text-slate-200 font-medium truncate">
                          {cat.category}
                        </span>
                        <div className="flex items-center gap-3 font-mono text-[11px] flex-shrink-0">
                          <span className="text-slate-400">{cat.sharePct}% share</span>
                          <span
                            className={
                              cat.growthPct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                            }
                          >
                            {cat.growthPct >= 0 ? '+' : ''}
                            {cat.growthPct}%
                          </span>
                          <span className="text-purple-300 font-bold">
                            {cat.seasonalFactor}x
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* FAST / SLOW / OUT-OF-STOCK / FORECAST SKU TABLE */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {viewTab === 'fast_moving'
                    ? 'Fast-Moving Products Report'
                    : viewTab === 'slow_moving'
                    ? 'Slow-Moving & Dead-Stock Report'
                    : viewTab === 'out_of_stock'
                    ? 'Out-of-Stock & Critical Low Cover Items'
                    : viewTab === 'forecast'
                    ? 'Velocity-Based Demand Forecast & Reorder Plan'
                    : 'Product Movement, Velocity & Demand Prediction'}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Fast-moving ({report.fastMoving.length}) · Steady ({report.steadyMoving.length}) · Slow-moving ({report.slowMoving.length}) · Out of stock ({report.outOfStock.length})
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter product or category..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {displayedProducts.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No items match this filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 px-2">Tier</th>
                      <th className="py-2 px-2 text-right">Sold ({report.windowDays}D)</th>
                      <th className="py-2 px-2">Velocity (Pcs/Day)</th>
                      <th className="py-2 px-2 text-right">Stock &amp; Cover</th>
                      <th className="py-2 px-2 text-right">7D / 30D Forecast</th>
                      <th className="py-2 pl-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {displayedProducts.map(item => {
                      const velPct = Math.min(
                        100,
                        Math.round((item.dailyVelocity / maxDailyVelocity) * 100)
                      );
                      const tierLabel =
                        item.movementTier === 'out_of_stock'
                          ? 'Out of Stock'
                          : item.movementTier === 'fast_moving'
                          ? 'Fast-Moving'
                          : item.movementTier === 'slow_moving'
                          ? 'Slow-Moving'
                          : 'Steady';

                      const tierColor =
                        item.movementTier === 'out_of_stock'
                          ? 'text-rose-400'
                          : item.movementTier === 'fast_moving'
                          ? 'text-emerald-400'
                          : item.movementTier === 'slow_moving'
                          ? 'text-amber-400'
                          : 'text-blue-400';

                      return (
                        <tr key={item.productId} className="hover:bg-slate-950/60 transition">
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-2">
                              <span>{item.emoji}</span>
                              <div className="min-w-0">
                                <div className="font-bold text-white truncate max-w-[190px]">
                                  {item.productName}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {item.category}
                                  {item.isSpikeActive && (
                                    <span className="text-amber-400 font-bold">
                                      {' '}· {item.spikeMultiplier}x Spike
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <span className={`font-bold text-[11px] ${tierColor}`}>
                              {tierLabel}
                            </span>
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">
                            <div className="font-bold text-white">
                              {item.unitsSoldPieces.toLocaleString('en-IN')} pcs
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatCurrency(item.revenue)}
                            </div>
                          </td>

                          <td className="py-2.5 px-2 min-w-[140px]">
                            <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                              <span className="font-bold text-slate-200">
                                {item.dailyVelocity}/day
                              </span>
                              <span
                                className={
                                  item.velocityChangePct >= 0
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                }
                              >
                                {item.velocityChangePct >= 0 ? '+' : ''}
                                {item.velocityChangePct}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                              <div
                                style={{ width: `${velPct}%` }}
                                className={`h-full rounded-full ${
                                  item.movementTier === 'fast_moving'
                                    ? 'bg-emerald-500'
                                    : item.movementTier === 'slow_moving'
                                    ? 'bg-amber-500'
                                    : 'bg-blue-500'
                                }`}
                              />
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap">
                            <div
                              className={`font-mono font-bold ${
                                item.currentStockPieces <= 0 ? 'text-rose-400' : 'text-slate-200'
                              }`}
                            >
                              {item.currentStockPieces <= 0 ? (
                                <span className="text-rose-400 inline-flex items-center justify-end gap-1">
                                  <PackageX className="w-3.5 h-3.5" />
                                  {item.currentStockPieces === 0
                                    ? '0 pcs'
                                    : formatStockDisplay(
                                        item.currentStockPieces,
                                        item.bundlePieces,
                                        item.bundleUnitName
                                      ).text}
                                </span>
                              ) : (
                                formatStockDisplay(
                                  item.currentStockPieces,
                                  item.bundlePieces,
                                  item.bundleUnitName
                                ).text
                              )}
                            </div>
                            <div
                              className={`text-[10px] flex items-center justify-end gap-1 ${
                                item.daysOfCover <= 4 ? 'text-rose-400 font-bold' : 'text-slate-400'
                              }`}
                            >
                              <Clock className="w-3 h-3" />
                              {item.currentStockPieces < 0
                                ? 'Negative stock'
                                : item.currentStockPieces === 0
                                ? 'Out of stock'
                                : item.daysOfCover >= 999
                                ? 'Idle stock'
                                : `${item.daysOfCover}d cover`}
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">
                            <div className="font-bold text-blue-300">
                              {item.predicted7dDemand}p <span className="text-slate-500">/ 7d</span>
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {item.predicted30dDemand}p / 30d
                            </div>
                          </td>

                          <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                            {item.recommendedReorderPieces > 0 ||
                            item.currentStockPieces <= item.lowStockThreshold ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickReorder(
                                    item.productId,
                                    item.productName,
                                    item.recommendedReorderPieces,
                                    item.bundlePieces
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition active:scale-95"
                              >
                                <ArrowUpCircle className="w-3.5 h-3.5" />
                                <span>
                                  Restock +{item.recommendedReorderPieces || item.bundlePieces}p
                                </span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500">Healthy</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
