import React, { useMemo, useState } from 'react';
import {
  BranchStockTransfer,
  MultiBranchSyncConfig,
  Product,
  StoreBranch,
} from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import { MAIN_HQ_BRANCH_ID } from '../utils/storage';
import {
  ArrowRightLeft,
  Building2,
  Check,
  Edit3,
  GitBranch,
  MapPin,
  Package,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
  AlertTriangle,
  X,
} from 'lucide-react';

export interface MultiStoreManagerPanelProps {
  branches: StoreBranch[];
  config: MultiBranchSyncConfig;
  transfers: BranchStockTransfer[];
  products: Product[];
  isSyncingBranches?: boolean;
  onToggleMultiBranchSync: (enabled: boolean) => void | Promise<void>;
  onUpdateMultiBranchConfig: (nextConfig: MultiBranchSyncConfig) => void | Promise<void>;
  onSwitchBranch: (branchId: string) => void | Promise<void>;
  onSaveBranch: (
    input: {
      id?: string;
      code: string;
      name: string;
      city?: string;
      address?: string;
      phone?: string;
      managerName?: string;
    },
    options?: {
      copyCatalog?: boolean;
      initialStockMode?: 'zero' | 'copy';
      copyCustomers?: boolean;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteBranch: (branchId: string) => Promise<{ ok: boolean; error?: string }>;
  onSyncAllBranches: () => Promise<{ ok: boolean; error?: string; syncDisabled?: boolean }>;
  onTransferStock: (params: {
    fromBranchId: string;
    toBranchId: string;
    productId: string;
    productName: string;
    pieces: number;
    note?: string;
  }) => Promise<{ ok: boolean; error?: string; syncDisabled?: boolean }>;
}

export const MultiStoreManagerPanel: React.FC<MultiStoreManagerPanelProps> = ({
  branches,
  config,
  transfers,
  products,
  isSyncingBranches = false,
  onToggleMultiBranchSync,
  onUpdateMultiBranchConfig,
  onSwitchBranch,
  onSaveBranch,
  onDeleteBranch,
  onSyncAllBranches,
  onTransferStock,
}) => {
  const { isMobileLayout } = useViewportLayout();
  const activeBranchId = config.activeBranchId || MAIN_HQ_BRANCH_ID;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];

  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Branch Create / Edit Form State
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchCity, setBranchCity] = useState('');
  const [branchManager, setBranchManager] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [copyCatalogOnCreate, setCopyCatalogOnCreate] = useState(true);
  const [initialStockMode, setInitialStockMode] = useState<'zero' | 'copy'>('zero');
  const [copyCustomersOnCreate, setCopyCustomersOnCreate] = useState(true);
  const [savingBranch, setSavingBranch] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Stock Transfer Form State
  const [fromBranchId, setFromBranchId] = useState<string>(activeBranchId);
  const [toBranchId, setToBranchId] = useState<string>(() => {
    const other = branches.find(b => b.id !== activeBranchId);
    return other?.id || '';
  });
  const [transferProductId, setTransferProductId] = useState<string>(
    products[0]?.id || ''
  );
  const [transferPieces, setTransferPieces] = useState<string>('10');
  const [transferNote, setTransferNote] = useState<string>('');
  const [transferring, setTransferring] = useState(false);

  const effectiveToBranchId = useMemo(() => {
    if (toBranchId && toBranchId !== fromBranchId && branches.some(b => b.id === toBranchId)) {
      return toBranchId;
    }
    const alt = branches.find(b => b.id !== fromBranchId);
    return alt?.id || '';
  }, [toBranchId, fromBranchId, branches]);

  const effectiveProductId = useMemo(() => {
    if (transferProductId && products.some(p => p.id === transferProductId)) {
      return transferProductId;
    }
    return products[0]?.id || '';
  }, [transferProductId, products]);

  const totalNetworkTodaySales = useMemo(
    () => branches.reduce((sum, b) => sum + (Number(b.todaySales) || 0), 0),
    [branches]
  );

  const totalNetworkStockPieces = useMemo(
    () => branches.reduce((sum, b) => sum + (Number(b.stockPiecesTotal) || 0), 0),
    [branches]
  );

  const openCreateForm = () => {
    soundManager.playMechanicalClick();
    const nextNum = branches.length + 1;
    setEditingBranchId(null);
    setBranchCode(`BR-${String(nextNum).padStart(2, '0')}`);
    setBranchName('');
    setBranchCity('');
    setBranchManager('');
    setBranchPhone('');
    setBranchAddress('');
    setCopyCatalogOnCreate(true);
    setInitialStockMode('zero');
    setCopyCustomersOnCreate(config.syncCustomersAndKhata);
    setShowBranchForm(true);
    setStatusBanner(null);
  };

  const openEditForm = (branch: StoreBranch) => {
    soundManager.playMechanicalClick();
    setEditingBranchId(branch.id);
    setBranchCode(branch.code);
    setBranchName(branch.name);
    setBranchCity(branch.city || '');
    setBranchManager(branch.managerName || '');
    setBranchPhone(branch.phone || '');
    setBranchAddress(branch.address || '');
    setShowBranchForm(true);
    setStatusBanner(null);
  };

  const handleBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBranch(true);
    setStatusBanner(null);
    try {
      const res = await onSaveBranch(
        {
          id: editingBranchId || undefined,
          code: branchCode,
          name: branchName,
          city: branchCity,
          phone: branchPhone,
          address: branchAddress,
          managerName: branchManager,
        },
        editingBranchId
          ? undefined
          : {
              copyCatalog: copyCatalogOnCreate,
              initialStockMode,
              copyCustomers: copyCustomersOnCreate,
            }
      );
      if (res.ok) {
        soundManager.playCheckoutSuccess();
        setShowBranchForm(false);
        setEditingBranchId(null);
        setStatusBanner({
          type: 'success',
          text: editingBranchId
            ? `Updated branch details for ${branchName.trim()}.`
            : `Added new branch "${branchName.trim()}" (${branchCode.trim().toUpperCase()}).`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: res.error || 'Could not save branch.',
        });
      }
    } finally {
      setSavingBranch(false);
    }
  };

  const handleRunSync = async () => {
    soundManager.playMechanicalClick();
    setStatusBanner(null);
    const res = await onSyncAllBranches();
    if (res.ok) {
      soundManager.playCheckoutSuccess();
      setStatusBanner({
        type: 'success',
        text: `Synchronized catalog, customer balances, and KPIs across ${branches.length} branch${
          branches.length === 1 ? '' : 'es'
        }.`,
      });
    } else {
      setStatusBanner({
        type: 'error',
        text: res.error || 'Failed to synchronize branches.',
      });
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const product = products.find(p => p.id === effectiveProductId);
    const qty = Math.round(Number(transferPieces) || 0);
    if (!fromBranchId || !effectiveToBranchId || fromBranchId === effectiveToBranchId) {
      setStatusBanner({
        type: 'error',
        text: 'Select two different branches to transfer stock.',
      });
      return;
    }
    if (!product || qty <= 0) {
      setStatusBanner({
        type: 'error',
        text: 'Select a product and enter a positive number of pieces.',
      });
      return;
    }

    setTransferring(true);
    setStatusBanner(null);
    try {
      const res = await onTransferStock({
        fromBranchId,
        toBranchId: effectiveToBranchId,
        productId: product.id,
        productName: product.name,
        pieces: qty,
        note: transferNote.trim() || undefined,
      });
      if (res.ok) {
        soundManager.playCheckoutSuccess();
        setTransferNote('');
        setStatusBanner({
          type: 'success',
          text: `Transferred ${qty} pcs of ${product.name} to ${
            branches.find(b => b.id === effectiveToBranchId)?.name || 'destination branch'
          }.`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: res.error || 'Inter-branch stock transfer failed.',
        });
      }
    } finally {
      setTransferring(false);
    }
  };

  const formatSyncTime = (iso?: string) => {
    if (!iso) return 'Not synced yet';
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
    <div className="space-y-4">
      {/* Master Multi-Branch Synchronization Control Card */}
      <div
        className={`rounded-2xl border p-4 transition-colors ${
          config.enabled
            ? 'bg-slate-950 border-emerald-500/35'
            : 'bg-slate-950 border-amber-500/35'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                config.enabled
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400'
                  : 'bg-amber-500/15 border-amber-500/35 text-amber-400'
              }`}
            >
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-black text-white">
                  Multi-Branch Synchronization
                </h4>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    config.enabled
                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-950/70 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {config.enabled ? 'Sync Active' : 'Standalone Mode (Off)'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-snug">
                {config.enabled
                  ? 'Cross-branch catalog pricing, customer Khata dues, and inter-branch stock transfers stay synchronized across all stores.'
                  : 'Synchronization is paused. Each store runs independently in standalone mode and inter-branch sync & stock transfers are halted.'}
              </p>
              <div className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-3 flex-wrap tabular-nums">
                <span>
                  Active Store:{' '}
                  <strong className="text-white">
                    {activeBranch?.code || 'HQ-01'} · {activeBranch?.name || 'Main Store'}
                  </strong>
                </span>
                <span>·</span>
                <span>Last Branch Sync: {formatSyncTime(config.lastBranchSyncAt)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center flex-shrink-0">
            <button
              type="button"
              disabled={!config.enabled || isSyncingBranches}
              onClick={handleRunSync}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBranches ? 'animate-spin' : ''}`} />
              <span>{isSyncingBranches ? 'Syncing...' : 'Sync All Branches'}</span>
            </button>

            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <span className="text-xs font-bold text-slate-200 min-w-[26px] text-right">
                {config.enabled ? 'ON' : 'OFF'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                aria-label="Enable or disable multi-branch synchronization"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  void onToggleMultiBranchSync(!config.enabled);
                }}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                  config.enabled
                    ? 'bg-emerald-600 border-emerald-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    config.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Granular Sync Policies (Disabled cleanly when Master Toggle is OFF) */}
        <div
          className={`mt-4 pt-3.5 border-t border-slate-800/80 grid ${
            isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'
          } gap-2.5 transition-opacity ${
            config.enabled ? 'opacity-100' : 'opacity-45 pointer-events-none'
          }`}
        >
          {[
            {
              key: 'syncCatalogAcrossBranches' as const,
              title: 'Catalog & Rates Sync',
              desc: 'Share SKUs & pricing updates across branches (preserves branch stock)',
            },
            {
              key: 'syncInventoryTransfers' as const,
              title: 'Inter-Branch Stock Transfers',
              desc: 'Allow moving stock pieces directly between branches',
            },
            {
              key: 'syncCustomersAndKhata' as const,
              title: 'Customers & Khata Sync',
              desc: 'Unify customer credit profiles & balances across stores',
            },
          ].map(rule => {
            const isRuleOn = Boolean(config[rule.key]);
            return (
              <div
                key={rule.key}
                className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{rule.title}</div>
                  <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                    {rule.desc}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isRuleOn}
                  aria-label={rule.title}
                  disabled={!config.enabled}
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    void onUpdateMultiBranchConfig({
                      ...config,
                      [rule.key]: !isRuleOn,
                    });
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    isRuleOn
                      ? 'bg-blue-600 border-blue-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      isRuleOn ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline Feedback Banner */}
      {statusBanner && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : statusBanner.type === 'error'
              ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              : 'bg-slate-900 border-slate-700 text-slate-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Network Summary KPIs */}
      <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'} gap-2.5`}>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Total Stores / Branches
          </div>
          <div className="text-lg font-black text-white tabular-nums mt-0.5">
            {branches.length}{' '}
            <span className="text-xs font-semibold text-slate-400">
              ({config.enabled ? 'Synced Network' : 'Standalone'})
            </span>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Network Sales Today
          </div>
          <div className="text-lg font-black text-emerald-400 tabular-nums mt-0.5">
            {formatCurrency(totalNetworkTodaySales)}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Combined Inventory
          </div>
          <div className="text-lg font-black text-sky-300 tabular-nums mt-0.5">
            {totalNetworkStockPieces.toLocaleString('en-IN')} pcs
          </div>
        </div>
      </div>

      {/* Store Branches Header + Add Branch CTA */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-blue-400" />
            Store Locations &amp; Branch Switcher
          </h4>
          <p className="text-[11px] text-slate-400">
            Switch active POS terminal context to any branch without losing local ledger data.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add Branch
        </button>
      </div>

      {/* Create / Edit Branch Inline Form */}
      {showBranchForm && (
        <form
          onSubmit={handleBranchSubmit}
          className="p-4 rounded-2xl bg-slate-950 border border-blue-500/40 space-y-3.5"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h5 className="text-xs font-black uppercase tracking-wider text-blue-300">
              {editingBranchId ? 'Edit Branch Profile' : 'Register New Store Branch'}
            </h5>
            <button
              type="button"
              onClick={() => {
                setShowBranchForm(false);
                setEditingBranchId(null);
              }}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'} gap-3`}>
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                Branch Code <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={16}
                value={branchCode}
                onChange={e => setBranchCode(e.target.value.toUpperCase())}
                placeholder="BR-02"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-white uppercase focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className={`${isMobileLayout ? '' : 'col-span-2'} space-y-1`}>
              <label className="block text-[11px] font-bold text-slate-300">
                Branch / Store Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={60}
                value={branchName}
                onChange={e => setBranchName(e.target.value)}
                placeholder="e.g. SQ Enterprises - Noida Sector 18"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                City / Market Area
              </label>
              <input
                type="text"
                maxLength={40}
                value={branchCity}
                onChange={e => setBranchCity(e.target.value)}
                placeholder="e.g. Noida"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                Branch Manager
              </label>
              <input
                type="text"
                maxLength={40}
                value={branchManager}
                onChange={e => setBranchManager(e.target.value)}
                placeholder="e.g. Amit Sharma"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                Contact Phone
              </label>
              <input
                type="tel"
                maxLength={24}
                value={branchPhone}
                onChange={e => setBranchPhone(e.target.value)}
                placeholder="+91 98110 00002"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className={`${isMobileLayout ? '' : 'col-span-3'} space-y-1`}>
              <label className="block text-[11px] font-bold text-slate-300">
                Branch Address
              </label>
              <input
                type="text"
                maxLength={140}
                value={branchAddress}
                onChange={e => setBranchAddress(e.target.value)}
                placeholder="Shop / Godown address"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {!editingBranchId && (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="text-[11px] font-bold text-slate-300">
                Initial Branch Data Setup
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyCatalogOnCreate}
                    onChange={e => setCopyCatalogOnCreate(e.target.checked)}
                    className="w-4 h-4 accent-blue-500 rounded"
                  />
                  <span>Copy SKU catalog &amp; rates from current store</span>
                </label>

                {copyCatalogOnCreate && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-slate-400">Opening stock:</span>
                    <select
                      value={initialStockMode}
                      onChange={e =>
                        setInitialStockMode(e.target.value === 'copy' ? 'copy' : 'zero')
                      }
                      className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    >
                      <option value="zero">Start at 0 pcs (Recommended)</option>
                      <option value="copy">Duplicate active stock qty</option>
                    </select>
                  </label>
                )}

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyCustomersOnCreate}
                    onChange={e => setCopyCustomersOnCreate(e.target.checked)}
                    className="w-4 h-4 accent-blue-500 rounded"
                  />
                  <span>Include customer directory</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowBranchForm(false);
                setEditingBranchId(null);
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingBranch}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {savingBranch ? 'Saving...' : editingBranchId ? 'Update Branch' : 'Create Branch'}
            </button>
          </div>
        </form>
      )}

      {/* Branches Cards Grid */}
      <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
        {branches.map(branch => {
          const isActive = branch.id === activeBranchId;
          const isConfirmingDelete = confirmDeleteId === branch.id;

          return (
            <div
              key={branch.id}
              className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 transition ${
                isActive
                  ? 'bg-blue-950/25 border-blue-500/50 shadow-sm'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono font-black text-sky-300">
                        {branch.code}
                      </span>
                      {branch.isHeadquarters && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/35 text-[10px] font-bold text-indigo-300 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          HQ
                        </span>
                      )}
                      {isActive && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-black text-emerald-300">
                          ACTIVE STORE
                        </span>
                      )}
                    </div>
                    <h5 className="text-sm font-black text-white truncate mt-1">
                      {branch.name}
                    </h5>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditForm(branch)}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition"
                      title="Edit branch"
                      aria-label={`Edit ${branch.name}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {!branch.isHeadquarters && branch.id !== MAIN_HQ_BRANCH_ID && (
                      <>
                        {isConfirmingDelete ? (
                          <button
                            type="button"
                            onClick={async () => {
                              setConfirmDeleteId(null);
                              const res = await onDeleteBranch(branch.id);
                              if (!res.ok) {
                                setStatusBanner({
                                  type: 'error',
                                  text: res.error || 'Could not remove branch.',
                                });
                              } else {
                                setStatusBanner({
                                  type: 'info',
                                  text: `Removed branch "${branch.name}".`,
                                });
                              }
                            }}
                            className="px-2 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black"
                          >
                            Confirm Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(branch.id)}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-rose-950 border border-slate-800 text-slate-400 hover:text-rose-300 transition"
                            title="Delete branch"
                            aria-label={`Delete ${branch.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 space-y-0.5">
                  {(branch.city || branch.address) && (
                    <div className="flex items-center gap-1.5 truncate">
                      <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="truncate">
                        {[branch.city, branch.address].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                  {(branch.managerName || branch.phone) && (
                    <div className="flex items-center gap-3 flex-wrap">
                      {branch.managerName && (
                        <span className="flex items-center gap-1">
                          <UserCheck className="w-3 h-3 text-slate-500" />
                          {branch.managerName}
                        </span>
                      )}
                      {branch.phone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-500" />
                          {branch.phone}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Branch Metrics Row */}
                <div className="grid grid-cols-3 gap-2 pt-1.5">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Today Sales</div>
                    <div className="text-xs font-black text-emerald-400 tabular-nums">
                      {formatCurrency(branch.todaySales || 0)}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Bills</div>
                    <div className="text-xs font-black text-white tabular-nums">
                      {branch.billsCount ?? 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Stock</div>
                    <div className="text-xs font-black text-sky-300 tabular-nums">
                      {(branch.stockPiecesTotal ?? 0).toLocaleString('en-IN')} pcs
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-500 truncate">
                  {branch.skuCount ?? 0} SKUs ·{' '}
                  {branch.lastSyncedAt
                    ? `Synced ${formatSyncTime(branch.lastSyncedAt)}`
                    : 'Local vault'}
                </span>

                {isActive ? (
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/35 text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Current Terminal
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      void onSwitchBranch(branch.id);
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                  >
                    <Store className="w-3.5 h-3.5" />
                    Switch to Store
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inter-Branch Stock Transfer Section */}
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 text-sky-400" />
              Inter-Branch Stock Transfer
            </h4>
            <p className="text-[11px] text-slate-400">
              Move inventory pieces cleanly from one store godown to another.
            </p>
          </div>
          {!config.enabled && (
            <span className="text-[11px] font-bold text-amber-300">
              Sync Toggle OFF
            </span>
          )}
        </div>

        {branches.length < 2 ? (
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <Package className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <span>Add at least one second branch above to enable stock transfers between stores.</span>
          </div>
        ) : (
          <form
            onSubmit={handleTransferSubmit}
            className={`space-y-3 transition-opacity ${
              config.enabled && config.syncInventoryTransfers
                ? 'opacity-100'
                : 'opacity-50 pointer-events-none'
            }`}
          >
            <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-4'} gap-2.5`}>
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-300">
                  From Branch
                </label>
                <select
                  value={fromBranchId}
                  onChange={e => setFromBranchId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-white"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-300">
                  To Branch
                </label>
                <select
                  value={effectiveToBranchId}
                  onChange={e => setToBranchId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-white"
                >
                  {branches
                    .filter(b => b.id !== fromBranchId)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.code} · {b.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-300">
                  Product SKU
                </label>
                <select
                  value={effectiveProductId}
                  onChange={e => setTransferProductId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.stockPieces} pcs here)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-300">
                  Pieces to Transfer
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={transferPieces}
                  onChange={e => setTransferPieces(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-white tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                maxLength={120}
                value={transferNote}
                onChange={e => setTransferNote(e.target.value)}
                placeholder="Transfer dispatch note (optional, e.g. Morning van dispatch)"
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                disabled={
                  transferring || !config.enabled || !config.syncInventoryTransfers || products.length === 0
                }
                className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {transferring ? 'Transferring...' : 'Transfer Stock'}
              </button>
            </div>
          </form>
        )}

        {/* Recent Transfer Audit Trail */}
        {transfers.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Recent Inter-Branch Transfers
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {transfers.slice(0, 12).map(trf => (
                <div
                  key={trf.id}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">
                      {trf.productName}{' '}
                      <span className="text-sky-300 font-mono">
                        +{trf.pieces} pcs
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {trf.fromBranchName} &rarr; {trf.toBranchName}
                      {trf.note ? ` · ${trf.note}` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] font-mono text-slate-400">
                      {trf.transferNumber}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {formatSyncTime(trf.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
