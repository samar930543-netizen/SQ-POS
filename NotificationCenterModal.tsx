import React, { useMemo, useState } from 'react';
import {
  Customer,
  PrinterConnectionsConfig,
  Product,
  PurchaseOrder,
  SystemNotification,
  SystemNotificationCategory,
  SystemNotificationSeverity,
} from '../types';
import { formatCurrency, formatDateTime, formatStockDisplay } from '../utils/formatters';
import { computeStockAlertMetrics } from '../utils/catalogFilter';
import { getDeliveryScheduleInfo } from '../utils/supplierHelpers';
import { evaluateCustomerCreditLimit } from '../utils/customerCredit';
import { getRemainingPaperMeters, isThermalPaperLow } from '../utils/printerManager';
import { soundManager } from '../utils/soundEffects';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Package,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  Trash2,
  Truck,
  Users,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  customers?: Customer[];
  purchaseOrders: PurchaseOrder[];
  logs: SystemNotification[];
  acknowledgedAlertIds: string[];
  showLowStockAlerts: boolean;
  printersConfig?: PrinterConnectionsConfig;
  isOffline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  lastSuccessfulSyncAt?: string;
  onMarkAllRead: () => void;
  onClearLogs: () => void;
  onDismissLog: (id: string) => void;
  onOrderPurchaseOrder: (productId: string) => void;
  onOpenInventory: () => void;
  onOpenKhataCustomer?: (customerId?: string) => void;
  onOpenSuppliers: () => void;
  onOpenOfflineSync: () => void;
  onSyncNow: () => void;
  onResetPaperRoll?: () => void;
  onOpenPrinterSettings?: () => void;
}

type FilterTab = 'all' | SystemNotificationCategory;

const SEVERITY_BADGE: Record<
  SystemNotificationSeverity,
  { icon: React.ReactNode; label: string; textClass: string; rowBorder: string }
> = {
  critical: {
    icon: <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />,
    label: 'Critical',
    textClass: 'text-rose-300',
    rowBorder: 'border-rose-500/30 bg-rose-950/20',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
    label: 'Warning',
    textClass: 'text-amber-300',
    rowBorder: 'border-amber-500/30 bg-amber-950/15',
  },
  success: {
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
    label: 'Completed',
    textClass: 'text-emerald-300',
    rowBorder: 'border-emerald-500/25 bg-emerald-950/15',
  },
  info: {
    icon: <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />,
    label: 'Info',
    textClass: 'text-blue-300',
    rowBorder: 'border-slate-800 bg-slate-950/60',
  },
};

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  products,
  customers = [],
  purchaseOrders,
  logs,
  acknowledgedAlertIds,
  showLowStockAlerts,
  printersConfig,
  isOffline,
  isSyncing,
  pendingSyncCount,
  failedSyncCount,
  lastSuccessfulSyncAt,
  onMarkAllRead,
  onClearLogs,
  onDismissLog,
  onOrderPurchaseOrder,
  onOpenInventory,
  onOpenKhataCustomer,
  onOpenSuppliers,
  onOpenOfflineSync,
  onSyncNow,
  onResetPaperRoll,
  onOpenPrinterSettings,
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const stockMetrics = useMemo(() => computeStockAlertMetrics(products), [products]);

  const lowStockProducts = useMemo(() => {
    if (!showLowStockAlerts) return [];
    return [...products]
      .filter(p => p.stockPieces <= p.lowStockThreshold)
      .sort((a, b) => a.stockPieces - b.stockPieces);
  }, [products, showLowStockAlerts]);

  const creditAlertItems = useMemo(() => {
    return customers
      .map(customer => ({
        customer,
        evalResult: evaluateCustomerCreditLimit(customer),
      }))
      .filter(item => item.evalResult.status === 'nearing' || item.evalResult.status === 'exceeded')
      .sort((a, b) => b.evalResult.utilizationPct - a.evalResult.utilizationPct);
  }, [customers]);

  const pendingPoAlerts = useMemo(() => {
    return purchaseOrders.filter(po => {
      if (po.status !== 'ordered' && po.status !== 'in_transit' && po.status !== 'partial') {
        return false;
      }
      const sched = getDeliveryScheduleInfo(po);
      return sched.urgency === 'overdue' || sched.urgency === 'due_today';
    });
  }, [purchaseOrders]);

  const ackSet = useMemo(() => new Set(acknowledgedAlertIds), [acknowledgedAlertIds]);

  const syncAlertCount =
    (isOffline ? 1 : 0) + (failedSyncCount > 0 ? 1 : 0) + (pendingSyncCount > 0 ? 1 : 0);

  const unreadLogsCount = useMemo(
    () => logs.filter(l => !l.read).length,
    [logs]
  );

  const filteredLogs = useMemo(() => {
    if (activeFilter === 'all') return logs;
    return logs.filter(l => l.category === activeFilter);
  }, [logs, activeFilter]);

  const paperIsLow = Boolean(printersConfig && isThermalPaperLow(printersConfig));
  const paperMetrics = getRemainingPaperMeters(printersConfig);
  const paperRollRemainingPct = Math.round(paperMetrics.remainingPct);
  const paperThresholdPct = printersConfig?.paperRoll?.lowPaperThresholdPct ?? 15;

  const showLiveLowStock =
    showLowStockAlerts &&
    (activeFilter === 'all' || activeFilter === 'low_stock') &&
    lowStockProducts.length > 0;

  const showLiveCreditAlerts =
    (activeFilter === 'all' || activeFilter === 'credit_limit') &&
    creditAlertItems.length > 0;

  const showLiveSync =
    (activeFilter === 'all' || activeFilter === 'sync') &&
    (isOffline || failedSyncCount > 0 || pendingSyncCount > 0);

  const showLivePo =
    (activeFilter === 'all' || activeFilter === 'purchase_order') &&
    pendingPoAlerts.length > 0;

  const showLiveLowPaper =
    paperIsLow && (activeFilter === 'all' || activeFilter === 'system');

  if (!isOpen) return null;

  const filterTabs: Array<{ id: FilterTab; label: string; count: number }> = [
    {
      id: 'all',
      label: 'All Alerts & Logs',
      count:
        lowStockProducts.length +
        creditAlertItems.length +
        syncAlertCount +
        pendingPoAlerts.length +
        (paperIsLow ? 1 : 0) +
        logs.length,
    },
    {
      id: 'credit_limit',
      label: 'Credit Limits',
      count: creditAlertItems.length + logs.filter(l => l.category === 'credit_limit').length,
    },
    {
      id: 'low_stock',
      label: 'Low Stock',
      count: lowStockProducts.length + logs.filter(l => l.category === 'low_stock').length,
    },
    {
      id: 'sync',
      label: 'Sync & Offline',
      count: syncAlertCount + logs.filter(l => l.category === 'sync').length,
    },
    {
      id: 'purchase_order',
      label: 'Purchase Orders',
      count: pendingPoAlerts.length + logs.filter(l => l.category === 'purchase_order').length,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      count: logs.filter(l => l.category === 'whatsapp').length,
    },
  ];

  const hasAnyVisibleContent =
    showLiveLowPaper ||
    showLiveCreditAlerts ||
    showLiveLowStock ||
    showLiveSync ||
    showLivePo ||
    filteredLogs.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-center-title"
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/35 flex items-center justify-center flex-shrink-0">
              <Bell className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2
                id="notification-center-title"
                className="text-sm sm:text-base font-black text-white tracking-tight truncate"
              >
                Notification Center &amp; System Log
              </h2>
              <p className="text-[11px] text-slate-400 tabular-nums truncate">
                {creditAlertItems.length} credit alert{creditAlertItems.length === 1 ? '' : 's'}
                <span aria-hidden="true" className="mx-1.5 text-slate-600">·</span>
                {lowStockProducts.length} low stock
                <span aria-hidden="true" className="mx-1.5 text-slate-600">·</span>
                {pendingSyncCount + failedSyncCount} sync
                <span aria-hidden="true" className="mx-1.5 text-slate-600">·</span>
                {unreadLogsCount} unread
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onMarkAllRead();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
              title="Mark all notifications and log entries as read"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Mark Read</span>
            </button>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onClearLogs();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition"
                title="Clear recorded event log history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear Log</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Notification Center"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quiet System Health Summary Row */}
        <div className="p-3 sm:px-5 bg-slate-900/90 border-b border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Credit Limits Card */}
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                <span>Khata Limits</span>
              </div>
              <div className="text-xs font-bold text-white mt-0.5 tabular-nums truncate">
                {creditAlertItems.length === 0
                  ? 'All within limit'
                  : `${creditAlertItems.length} near/over cap`}
              </div>
            </div>
            {onOpenKhataCustomer && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenKhataCustomer();
                }}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 text-[11px] font-bold border border-slate-700 whitespace-nowrap transition"
              >
                Khata
              </button>
            )}
          </div>

          {/* Low Stock Card */}
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>Stock Health</span>
              </div>
              <div className="text-xs font-bold text-white mt-0.5 tabular-nums truncate">
                {!showLowStockAlerts
                  ? 'Alerts muted in Settings'
                  : stockMetrics.total === 0
                  ? 'All stock healthy'
                  : `${stockMetrics.total} below threshold`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenInventory();
              }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 text-[11px] font-bold border border-slate-700 whitespace-nowrap transition"
            >
              Stock
            </button>
          </div>

          {/* Sync Status Card */}
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                {isOffline ? (
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                ) : (
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                )}
                <span>Sync Status</span>
              </div>
              <div className="text-xs font-bold text-white mt-0.5 tabular-nums truncate">
                {isSyncing
                  ? 'Syncing now...'
                  : isOffline
                  ? `Offline · ${pendingSyncCount + failedSyncCount} queued`
                  : failedSyncCount > 0
                  ? `${failedSyncCount} failed · ${pendingSyncCount} pending`
                  : pendingSyncCount > 0
                  ? `${pendingSyncCount} pending sync`
                  : 'Online & Synced'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenOfflineSync();
              }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-bold border border-slate-700 whitespace-nowrap transition"
            >
              Sync
            </button>
          </div>

          {/* Pending PO Card */}
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                <span>Supply Orders</span>
              </div>
              <div className="text-xs font-bold text-white mt-0.5 tabular-nums truncate">
                {pendingPoAlerts.length === 0
                  ? 'No overdue POs'
                  : `${pendingPoAlerts.length} delivery alert${pendingPoAlerts.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSuppliers();
              }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-bold border border-slate-700 whitespace-nowrap transition"
            >
              POs
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="px-3 sm:px-5 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {filterTabs.map(tab => {
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setActiveFilter(tab.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-900 text-slate-300 hover:text-white border-slate-800 hover:bg-slate-800'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] tabular-nums ${
                    isActive ? 'text-white/90' : 'text-slate-400'
                  }`}
                >
                  ({tab.count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Alerts & Event Log List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-5">
          {!hasAnyVisibleContent ? (
            <div className="py-14 flex flex-col items-center justify-center text-center text-slate-400 bg-slate-950/50 rounded-2xl border border-slate-800">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2 stroke-[1.5]" />
              <p className="text-sm font-bold text-white">All systems clear</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                No active warnings or recorded alerts in this category.
              </p>
            </div>
          ) : (
            <>
              {/* Active System Warnings */}
              {(showLiveLowPaper || showLiveCreditAlerts || showLiveSync || showLivePo || showLiveLowStock) && (
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Active System Alerts
                    </h3>
                    {lastSuccessfulSyncAt && (
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        Last synced: {formatDateTime(new Date(lastSuccessfulSyncAt))}
                      </span>
                    )}
                  </div>

                  {/* Live Thermal Low-Paper Roll Alert */}
                  {showLiveLowPaper && (
                    <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <ScrollText className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                            <span>Thermal Paper Roll Low</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span className="text-[11px] font-bold text-amber-300 tabular-nums">
                              {paperRollRemainingPct}% remaining
                            </span>
                            {!ackSet.has('low_paper') && (
                              <span className="text-[10px] font-bold text-blue-300">· New</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                            {paperMetrics.remainingMeters.toFixed(1)}m left of {paperMetrics.totalMeters}m (below {paperThresholdPct}% threshold · {printersConfig?.paperRoll?.billsPrintedSinceReset || 0} prints).
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {onResetPaperRoll && (
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playCheckoutSuccess();
                              onResetPaperRoll();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap transition"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>New Roll (100%)</span>
                          </button>
                        )}
                        {onOpenPrinterSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenPrinterSettings();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold whitespace-nowrap transition"
                          >
                            Printer Setup
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Live Customer Credit Limit Alerts */}
                  {showLiveCreditAlerts &&
                    creditAlertItems.map(({ customer, evalResult }) => {
                      const isExceeded = evalResult.status === 'exceeded';
                      const isUnread = !ackSet.has(`credit_${customer.id}`);
                      return (
                        <div
                          key={customer.id}
                          className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isExceeded
                              ? 'border-rose-500/35 bg-rose-950/25'
                              : 'border-amber-500/35 bg-amber-950/20'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            {isExceeded ? (
                              <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                                <span>{customer.name}</span>
                                <span aria-hidden="true" className="text-slate-600">·</span>
                                <span
                                  className={`text-[11px] font-bold ${
                                    isExceeded ? 'text-rose-300' : 'text-amber-300'
                                  }`}
                                >
                                  {evalResult.statusLabel}
                                </span>
                                {isUnread && (
                                  <span className="text-[10px] font-bold text-blue-300">
                                    · New
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                                Balance: {formatCurrency(customer.currentBalance)} / Limit:{' '}
                                {formatCurrency(evalResult.limit)} (
                                {Math.round(evalResult.utilizationPct)}% used
                                {evalResult.excessAmount > 0
                                  ? ` · Over by ${formatCurrency(evalResult.excessAmount)}`
                                  : ` · Headroom ${formatCurrency(evalResult.remainingHeadroom)}`}
                                )
                              </p>
                            </div>
                          </div>

                          {onOpenKhataCustomer && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenKhataCustomer(customer.id);
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-white text-[11px] font-bold whitespace-nowrap transition self-start sm:self-auto ${
                                isExceeded
                                  ? 'bg-rose-600 hover:bg-rose-500'
                                  : 'bg-amber-600 hover:bg-amber-500'
                              }`}
                            >
                              Open Khata
                            </button>
                          )}
                        </div>
                      );
                    })}

                  {/* Live Sync / Offline Alerts */}
                  {showLiveSync && (
                    <div className="p-3 rounded-xl border border-amber-500/35 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {isOffline ? (
                          <WifiOff className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        ) : (
                          <RefreshCw className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-amber-200">
                            {isOffline
                              ? 'Offline Mode Active'
                              : failedSyncCount > 0
                              ? 'Sync Attention Needed'
                              : 'Queued Operations Waiting'}
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                            {isOffline
                              ? `POS billing & Khata entries are stored safely offline (${pendingSyncCount + failedSyncCount} queued for upload).`
                              : `${failedSyncCount} failed, ${pendingSyncCount} pending operation(s) waiting to sync with server.`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isOffline && (
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              onSyncNow();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 transition"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                            <span>Sync Now</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenOfflineSync();
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition"
                        >
                          Sync Details
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Live Pending PO Alerts */}
                  {showLivePo &&
                    pendingPoAlerts.map(po => (
                      <div
                        key={po.id}
                        className="p-3 rounded-xl border border-indigo-500/30 bg-indigo-950/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Truck className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                              <span>{po.poNumber}</span>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="text-indigo-300">{po.supplierName}</span>
                            </div>
                            <p className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                              Expected {po.expectedDeliveryDate} — Status: {po.status}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenSuppliers();
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 text-[11px] font-bold whitespace-nowrap transition self-start sm:self-auto"
                        >
                          Open PO
                        </button>
                      </div>
                    ))}

                  {/* Live Low Stock Items */}
                  {showLiveLowStock &&
                    lowStockProducts.map(product => {
                      const stockInfo = formatStockDisplay(
                        product.stockPieces,
                        product.bundlePieces,
                        product.bundleUnitName
                      );
                      const isNegative = product.stockPieces < 0;
                      const isDepleted = product.stockPieces === 0;
                      const isUnread = !ackSet.has(`low_stock_${product.id}`);

                      return (
                        <div
                          key={product.id}
                          className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isNegative || isDepleted
                              ? 'border-rose-500/30 bg-rose-950/20'
                              : 'border-amber-500/30 bg-amber-950/15'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <AlertTriangle
                              className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                                isNegative || isDepleted ? 'text-rose-400' : 'text-amber-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                                <span>{product.name}</span>
                                <span aria-hidden="true" className="text-slate-600">·</span>
                                <span
                                  className={`text-[11px] font-bold ${
                                    isNegative
                                      ? 'text-rose-300'
                                      : isDepleted
                                      ? 'text-orange-300'
                                      : 'text-amber-300'
                                  }`}
                                >
                                  {isNegative
                                    ? 'Negative Stock'
                                    : isDepleted
                                    ? 'Depleted (0 pcs)'
                                    : 'Low Stock'}
                                </span>
                                {isUnread && (
                                  <span className="text-[10px] font-bold text-blue-300">
                                    · New
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                                Current: {stockInfo.text} · Threshold: {product.lowStockThreshold} pcs · {product.category}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOrderPurchaseOrder(product.id);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 transition whitespace-nowrap"
                            >
                              <Truck className="w-3 h-3" />
                              <span>Order PO</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenInventory();
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition whitespace-nowrap"
                            >
                              Restock
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </section>
              )}

              {/* Chronological System & Sync Activity Log */}
              {filteredLogs.length > 0 && (
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Recorded Event Log
                    </h3>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {filteredLogs.map(entry => {
                      const style = SEVERITY_BADGE[entry.severity];
                      return (
                        <div
                          key={entry.id}
                          className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${style.rowBorder}`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="mt-0.5">{style.icon}</div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                                <span className="font-bold text-white">{entry.title}</span>
                                <span aria-hidden="true" className="text-slate-600">·</span>
                                <span className={`font-semibold text-[11px] ${style.textClass}`}>
                                  {style.label}
                                </span>
                                <span aria-hidden="true" className="text-slate-600">·</span>
                                <span className="text-[11px] text-slate-400 tabular-nums">
                                  {formatDateTime(new Date(entry.timestamp))}
                                </span>
                                {!entry.read && (
                                  <span className="text-[10px] font-bold text-blue-300">
                                    · Unread
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-300 mt-0.5 break-words">
                                {entry.message}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => onDismissLog(entry.id)}
                            aria-label={`Dismiss notification ${entry.title}`}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
