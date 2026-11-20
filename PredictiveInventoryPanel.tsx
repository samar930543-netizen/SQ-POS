import React, { useMemo, useState } from 'react';
import { Bill, Product, PredictiveInventoryItem } from '../types';
import { buildPredictiveInventoryReport } from '../utils/salesAnalytics';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  Clock,
  Database,
  Download,
  PackageX,
  Search,
  Sparkles,
} from 'lucide-react';

interface PredictiveInventoryPanelProps {
  bills: Bill[];
  products: Product[];
  onRestockProduct: (productId: string, additionalPieces: number) => void;
  onSeedSampleHistory: () => void;
}

export const PredictiveInventoryPanel: React.FC<PredictiveInventoryPanelProps> = ({
  bills,
  products,
  onRestockProduct,
  onSeedSampleHistory,
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const [targetCoverDays, setTargetCoverDays] = useState<7 | 14 | 30>(14);
  const [filterView, setFilterView] = useState<'low_stock' | 'all'>('low_stock');
  const [searchQuery, setSearchQuery] = useState('');
  const [restockToast, setRestockToast] = useState<string | null>(null);

  const report = useMemo(
    () => buildPredictiveInventoryReport(bills, products, targetCoverDays),
    [bills, products, targetCoverDays]
  );

  const displayedItems = useMemo(() => {
    const base = filterView === 'low_stock' ? report.lowStockItems : report.items;
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(
      item =>
        item.productName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [report.lowStockItems, report.items, filterView, searchQuery]);

  const maxDailyConsumption = useMemo(
    () => Math.max(1, ...report.items.map(i => i.avgDailyConsumption)),
    [report.items]
  );

  const handleQuickRestock = (item: PredictiveInventoryItem) => {
    const qtyToAdd =
      item.suggestedReorderPieces > 0
        ? item.suggestedReorderPieces
        : item.bundlePieces || 12;
    soundManager.playCheckoutSuccess();
    onRestockProduct(item.productId, qtyToAdd);
    setRestockToast(`Restocked +${qtyToAdd} pcs for ${item.productName}`);
    window.setTimeout(() => setRestockToast(null), 2600);
  };

  const handleExportCsv = () => {
    soundManager.playMechanicalClick();
    const headers = [
      'Product',
      'Category',
      'Status',
      '30D Sold (Pcs)',
      'Avg Daily Consumption (Pcs/Day)',
      'Current Stock (Pcs)',
      'Low Stock Threshold (Pcs)',
      'Days of Stock Left',
      `Suggested Reorder (${targetCoverDays}D Cover, Pcs)`,
      'Suggested Bundles',
      'Estimated Value (INR)',
    ];
    const rows = report.items.map(item => [
      `"${item.productName.replace(/"/g, '""')}"`,
      `"${item.category.replace(/"/g, '""')}"`,
      item.urgency,
      item.sold30DaysPieces,
      item.avgDailyConsumption,
      item.currentStockPieces,
      item.lowStockThreshold,
      item.daysOfStockRemaining >= 999 ? '999+' : item.daysOfStockRemaining,
      item.suggestedReorderPieces,
      item.suggestedReorderBundles,
      item.estimatedReorderCost,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sq-predictive-inventory-30d-${report.endDateKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Predictive Inventory 30-Day Reorder Planner"
      className="mx-4 mt-4 rounded-2xl bg-slate-900 border border-indigo-500/35 shadow-xl overflow-hidden"
    >
      {/* Header Bar */}
      <div className="p-4 bg-slate-900/95 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Predictive Inventory &middot; 30-Day Reorder Planner
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            Rolling 30 days ({report.startDateKey} &rarr; {report.endDateKey}) &middot;{' '}
            {report.billsAnalyzedCount} bills analyzed &middot; Avg daily consumption = 30D sold / 30
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Target Stock Cover Selector */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2">
              Target Cover
            </span>
            {([7, 14, 30] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setTargetCoverDays(days);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition tabular-nums ${
                  targetCoverDays === days
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Export Reorder CSV</span>
          </button>
        </div>
      </div>

      {/* Restock Toast */}
      {restockToast && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{restockToast}</span>
        </div>
      )}

      {/* 4 Summary Metrics */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div
          className={`grid ${
            isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
          } gap-2.5`}
        >
          <div className="p-3 rounded-xl bg-slate-900 border border-amber-500/30">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Low-Stock Items
            </div>
            <div className="text-xl font-black text-white font-mono tabular-nums mt-1">
              {report.lowStockItems.length}{' '}
              <span className="text-xs font-semibold text-slate-400">
                of {report.items.length} SKUs
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              At/below threshold or &le;7d cover
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-indigo-500/30">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
              <Boxes className="w-3.5 h-3.5" />
              Suggested Reorder Qty
            </div>
            <div className="text-xl font-black text-indigo-300 font-mono tabular-nums mt-1">
              +{report.totalSuggestedReorderPieces.toLocaleString('en-IN')}{' '}
              <span className="text-xs font-semibold text-slate-400">pcs</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
              {report.totalEstimatedReorderCost > 0
                ? `Est. value ${formatCurrency(report.totalEstimatedReorderCost)} (${targetCoverDays}d cover)`
                : `For ${targetCoverDays}-day cover + safety buffer`}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              30-Day Consumption
            </div>
            <div className="text-xl font-black text-white font-mono tabular-nums mt-1">
              {report.total30DaysPiecesSold.toLocaleString('en-IN')}{' '}
              <span className="text-xs font-semibold text-slate-400">pcs</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
              Combined store avg: {report.avgTotalDailyPieces} pcs/day
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Urgency Breakdown
            </div>
            <div className="text-xl font-black text-white font-mono tabular-nums mt-1">
              {report.lowStockItems.filter(i => i.urgency === 'out_of_stock').length}{' '}
              <span className="text-xs font-semibold text-rose-400">out</span>{' '}
              <span className="text-slate-600">/</span>{' '}
              {report.lowStockItems.filter(i => i.urgency === 'critical').length}{' '}
              <span className="text-xs font-semibold text-amber-400">critical</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Prioritized by stockout risk
            </div>
          </div>
        </div>
      </div>

      {/* Empty 30-day sales history helper */}
      {report.billsAnalyzedCount === 0 && (
        <div className="mx-4 mt-3 p-3.5 rounded-xl bg-slate-950/70 border border-dashed border-slate-700 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-300">
            <span className="font-bold text-white">No sales recorded in the past 30 days.</span>{' '}
            Record bills or populate sample wholesale history to compute live 30-day consumption rates.
          </div>
          <button
            type="button"
            onClick={() => {
              soundManager.playScannerBeep();
              onSeedSampleHistory();
            }}
            className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold transition inline-flex items-center gap-1.5"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Load 60-Day Sales History</span>
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setFilterView('low_stock');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                filterView === 'low_stock'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Low-Stock Reorders ({report.lowStockItems.length})
            </button>
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setFilterView('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                filterView === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Products ({report.items.length})
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search product or category..."
              aria-label="Filter predictive inventory products"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Consumption & Reorder Table */}
        {displayedItems.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-xs text-slate-400">
            {filterView === 'low_stock' && !searchQuery.trim()
              ? 'All products have healthy stock levels relative to their 30-day consumption rate.'
              : 'No products match your search filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 px-2 text-right">30D Sold</th>
                  <th className="py-2 px-2 min-w-[140px]">Avg Daily Use</th>
                  <th className="py-2 px-2 text-right">Stock &amp; Cover</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2 text-right">Suggested Reorder</th>
                  <th className="py-2 pl-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {displayedItems.map(item => {
                  const consumptionBarPct =
                    item.avgDailyConsumption > 0
                      ? Math.max(
                          6,
                          Math.min(
                            100,
                            Math.round((item.avgDailyConsumption / maxDailyConsumption) * 100)
                          )
                        )
                      : 0;

                  const statusLabel =
                    item.urgency === 'out_of_stock'
                      ? 'Out of Stock'
                      : item.urgency === 'critical'
                      ? 'Critical Low'
                      : item.urgency === 'low_stock'
                      ? 'Low Cover'
                      : 'Healthy';

                  const statusColor =
                    item.urgency === 'out_of_stock'
                      ? 'text-rose-400'
                      : item.urgency === 'critical'
                      ? 'text-amber-400'
                      : item.urgency === 'low_stock'
                      ? 'text-yellow-300'
                      : 'text-emerald-400';

                  return (
                    <tr
                      key={item.productId}
                      className={`transition ${
                        item.urgency === 'out_of_stock'
                          ? 'bg-rose-950/15 hover:bg-rose-950/25'
                          : 'hover:bg-slate-950/60'
                      }`}
                    >
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span>{item.emoji}</span>
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate max-w-[190px]">
                              {item.productName}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {item.category} &middot; Min {item.lowStockThreshold} pcs
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-white">
                          {item.sold30DaysPieces.toLocaleString('en-IN')} pcs
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {item.activeDaysSold} active {item.activeDaysSold === 1 ? 'day' : 'days'}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 min-w-[140px]">
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums mb-1">
                          <span className="font-bold text-indigo-300">
                            {item.avgDailyConsumption.toFixed(2)}/day
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            style={{ width: `${consumptionBarPct}%` }}
                            className={`h-full rounded-full ${
                              item.avgDailyConsumption > 0 ? 'bg-indigo-500' : 'bg-slate-700'
                            }`}
                          />
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <div
                          className={`font-mono font-bold tabular-nums ${
                            item.currentStockPieces <= 0
                              ? 'text-rose-400'
                              : item.isLowStock
                              ? 'text-amber-300'
                              : 'text-slate-200'
                          }`}
                        >
                          {item.currentStockPieces <= 0 ? (
                            <span className="inline-flex items-center justify-end gap-1">
                              <PackageX className="w-3.5 h-3.5" />
                              {item.currentStockPieces} pcs
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
                          className={`text-[10px] flex items-center justify-end gap-1 tabular-nums ${
                            item.daysOfStockRemaining <= 4
                              ? 'text-rose-400 font-bold'
                              : 'text-slate-400'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {item.currentStockPieces <= 0
                            ? '0d left'
                            : item.daysOfStockRemaining >= 999
                            ? 'Idle stock'
                            : `${item.daysOfStockRemaining}d cover`}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className={`font-bold text-[11px] ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {item.suggestedReorderPieces > 0 ? (
                          <div>
                            <div className="font-black text-emerald-300">
                              +{item.suggestedReorderPieces.toLocaleString('en-IN')} pcs
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {item.suggestedReorderBundles > 0
                                ? `~${item.suggestedReorderBundles} ${item.bundleUnitName}${
                                    item.suggestedReorderBundles > 1 ? 's' : ''
                                  }`
                                : ''}
                              {item.suggestedReorderBundles > 0 && item.estimatedReorderCost > 0
                                ? ' · '
                                : ''}
                              {item.estimatedReorderCost > 0
                                ? formatCurrency(item.estimatedReorderCost)
                                : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">&mdash;</span>
                        )}
                      </td>

                      <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                        {item.suggestedReorderPieces > 0 ? (
                          <button
                            type="button"
                            onClick={() => handleQuickRestock(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition active:scale-95"
                          >
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                            <span>Restock +{item.suggestedReorderPieces}p</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-500">Sufficient</span>
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
    </section>
  );
};
