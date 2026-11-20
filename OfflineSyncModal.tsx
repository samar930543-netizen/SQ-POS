import React, { useMemo, useState } from 'react';
import { ServerSyncStatus, SyncQueueItem } from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Database,
  UploadCloud,
  DownloadCloud,
  Trash2,
  X,
  HardDrive,
  Gauge,
} from 'lucide-react';

interface OfflineSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBrowserOnline: boolean;
  forceOfflineMode: boolean;
  autoSyncOnReconnect: boolean;
  isEffectivelyOffline: boolean;
  swOfflineReady: boolean;
  isSyncing: boolean;
  syncQueue: SyncQueueItem[];
  pendingCount: number;
  failedCount: number;
  syncedCount: number;
  pendingBillsCount: number;
  indexedDbBillCount: number;
  indexedDbProductCount?: number;
  persistentStorageGranted?: boolean;
  serverStatus: ServerSyncStatus;
  lastSuccessfulSyncAt?: string;
  onToggleForceOffline: () => void;
  onToggleAutoSync: () => void;
  onSyncNow: (targetItemId?: string) => void;
  onClearSynced: () => void;
  onPushFullBackup: () => void;
  onPullServerBackup: () => void;
  autoCloudSyncEnabled?: boolean;
}

export const OfflineSyncModal: React.FC<OfflineSyncModalProps> = ({
  isOpen,
  onClose,
  isBrowserOnline,
  forceOfflineMode,
  autoSyncOnReconnect,
  isEffectivelyOffline,
  swOfflineReady,
  isSyncing,
  syncQueue,
  pendingCount,
  failedCount,
  syncedCount,
  pendingBillsCount,
  indexedDbBillCount,
  indexedDbProductCount = 0,
  persistentStorageGranted = false,
  serverStatus,
  lastSuccessfulSyncAt,
  onToggleForceOffline,
  onToggleAutoSync,
  onSyncNow,
  onClearSynced,
  onPushFullBackup,
  onPullServerBackup,
  autoCloudSyncEnabled = true,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'synced' | 'failed'>('all');

  const filteredQueue = useMemo(() => {
    return syncQueue.filter(item => {
      if (filterStatus === 'all') return true;
      if (filterStatus === 'pending') return item.status === 'pending' || item.status === 'syncing';
      return item.status === filterStatus;
    });
  }, [syncQueue, filterStatus]);

  if (!isOpen) return null;

  const formatShortTime = (iso?: string) => {
    if (!iso) return 'Never';
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                isEffectivelyOffline
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              }`}
            >
              {isEffectivelyOffline ? <WifiOff className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">
                Offline Mode & Background Sync
              </h2>
              <p className="text-xs text-slate-400">
                Local IndexedDB billing storage · Automatic queue sync on reconnect
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="Close Offline Sync Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {!autoCloudSyncEnabled && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/35 flex items-start gap-2.5 text-xs text-amber-200">
              <Gauge className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-white">
                  Automatic Cloud Syncing Paused (Performance Manager)
                </div>
                <div className="text-[11px] text-amber-200/80 mt-0.5">
                  20-second background polling and automatic checkout syncing are paused to maximize POS speed. Changes still queue locally and can be synced anytime using the buttons below.
                </div>
              </div>
            </div>
          )}

          {/* Connectivity & Mode Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">
                  {forceOfflineMode ? 'Manual Offline Mode Active' : isBrowserOnline ? 'Network Connected' : 'Device Disconnected'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {forceOfflineMode
                    ? 'Bills are stored locally until switched back online'
                    : 'Toggle to work offline without hitting sync server'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onToggleForceOffline();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition ${
                  forceOfflineMode
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                {forceOfflineMode ? 'Go Online' : 'Work Offline'}
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">Auto-Sync on Reconnect</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Service Worker: {swOfflineReady ? 'Offline Cache Ready' : 'Initializing'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onToggleAutoSync();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition ${
                  autoSyncOnReconnect
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {autoSyncOnReconnect ? 'Enabled' : 'Paused'}
              </button>
            </div>
          </div>

          {/* 4-Column Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Pending Queue
              </div>
              <div className="text-lg font-black text-amber-300 tabular-nums mt-0.5">
                {pendingCount + failedCount}
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {pendingBillsCount} local bills waiting
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                Local Vault
              </div>
              <div className="text-lg font-black text-white tabular-nums mt-0.5">
                {indexedDbBillCount} bills · {indexedDbProductCount} SKUs
              </div>
              <div className="text-[10px] text-slate-500">
                IndexedDB + LocalStorage{persistentStorageGranted ? ' · Persistent' : ''}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                Server Backed Up
              </div>
              <div className="text-lg font-black text-emerald-300 tabular-nums mt-0.5">
                {serverStatus.totalSyncedBills}
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                Rev #{serverStatus.revision}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Last Sync
              </div>
              <div className="text-xs font-bold text-slate-200 tabular-nums mt-1">
                {formatShortTime(lastSuccessfulSyncAt)}
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {syncedCount} synced in log
              </div>
            </div>
          </div>

          {/* Primary Sync Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSyncing || isEffectivelyOffline}
              onClick={() => {
                soundManager.playMechanicalClick();
                onSyncNow();
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-bold transition whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Queue...' : `Sync Pending Now (${pendingCount + failedCount})`}</span>
            </button>

            <button
              type="button"
              disabled={isSyncing || isEffectivelyOffline}
              onClick={() => {
                soundManager.playMechanicalClick();
                onPushFullBackup();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-semibold transition whitespace-nowrap"
            >
              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>Push Full Backup</span>
            </button>

            <button
              type="button"
              disabled={isSyncing || isEffectivelyOffline}
              onClick={() => {
                soundManager.playMechanicalClick();
                onPullServerBackup();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-semibold transition whitespace-nowrap"
            >
              <DownloadCloud className="w-3.5 h-3.5 text-blue-400" />
              <span>Restore from Server</span>
            </button>

            {syncedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onClearSynced();
                }}
                className="ml-auto flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white text-xs font-medium transition whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Synced</span>
              </button>
            )}
          </div>

          {/* Outbox Queue List */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Synchronization Outbox ({syncQueue.length})
              </h3>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                {(['all', 'pending', 'synced', 'failed'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setFilterStatus(tab)}
                    className={`px-2.5 py-1 rounded-md font-semibold capitalize transition ${
                      filterStatus === tab
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {filteredQueue.length === 0 ? (
              <div className="py-10 text-center rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-xs">
                {syncQueue.length === 0
                  ? 'No queued offline operations. New bills, Khata receipts, and Cash Flow updates made offline appear here automatically.'
                  : `No ${filterStatus} items in the outbox.`}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-800/80 overflow-hidden">
                {filteredQueue.map(item => (
                  <div
                    key={item.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-900/50"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{item.label}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 tabular-nums">
                        <span className="capitalize">{item.entityType.replace('_', ' ')}</span>
                        <span>·</span>
                        <span>{formatShortTime(item.createdAt)}</span>
                        {item.attempts > 0 && (
                          <>
                            <span>·</span>
                            <span>{item.attempts} attempt{item.attempts === 1 ? '' : 's'}</span>
                          </>
                        )}
                      </div>
                      {item.errorMessage && (
                        <div className="text-[11px] text-rose-400 mt-0.5">{item.errorMessage}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {typeof item.amount === 'number' && item.amount > 0 && (
                        <span className="font-bold text-slate-200 tabular-nums">
                          {formatCurrency(item.amount)}
                        </span>
                      )}

                      {item.status === 'synced' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Synced
                        </span>
                      ) : item.status === 'failed' ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                          <button
                            type="button"
                            disabled={isSyncing || isEffectivelyOffline}
                            onClick={() => onSyncNow(item.id)}
                            className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[10px] font-bold disabled:opacity-40"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300">
                          <Clock className="w-3.5 h-3.5" />
                          {item.status === 'syncing' ? 'Syncing' : 'Pending'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
