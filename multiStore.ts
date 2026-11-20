import {
  BranchStockTransfer,
  BranchWorkspaceSnapshot,
  MultiBranchSyncConfig,
  Product,
  StoreBranch,
} from '../types';
import {
  MAIN_HQ_BRANCH_ID,
  applyWorkspaceSnapshotToLiveStorage,
  captureLiveWorkspaceSnapshot,
  computeBranchMetricsFromSnapshot,
  createDefaultMainBranch,
  getStoredBranchTransfers,
  getStoredBranches,
  getStoredMultiBranchConfig,
  getStoredStoreProfile,
  loadBranchVaultSnapshot,
  removeBranchVaultSnapshot,
  saveBranchTransfers,
  saveBranchVaultSnapshot,
  saveBranches,
  saveMultiBranchConfig,
  saveProducts,
} from './storage';

export interface MultiStoreServerFetchResult {
  reachable: boolean;
  config: MultiBranchSyncConfig;
  branches: StoreBranch[];
  transfers: BranchStockTransfer[];
}

export interface MultiBranchSyncResult {
  ok: boolean;
  syncDisabled?: boolean;
  error?: string;
  syncedAt?: string;
  config?: MultiBranchSyncConfig;
  branches?: StoreBranch[];
  transfers?: BranchStockTransfer[];
  activeSnapshotUpdated?: boolean;
}

export interface BranchTransferResult {
  ok: boolean;
  syncDisabled?: boolean;
  error?: string;
  transfer?: BranchStockTransfer;
  branches?: StoreBranch[];
  transfers?: BranchStockTransfer[];
}

function enrichBranchWithLocalVault(branch: StoreBranch, activeBranchId: string): StoreBranch {
  const snap =
    branch.id === activeBranchId
      ? captureLiveWorkspaceSnapshot(branch.id)
      : loadBranchVaultSnapshot(branch.id);
  if (!snap) return branch;
  const metrics = computeBranchMetricsFromSnapshot(snap);
  return {
    ...branch,
    skuCount: metrics.skuCount,
    stockPiecesTotal: metrics.stockPiecesTotal,
    todaySales: metrics.todaySales,
    totalSales: metrics.totalSales,
    billsCount: metrics.billsCount,
    lastSyncedAt: branch.lastSyncedAt || snap.updatedAt,
  };
}

export function refreshLocalBranchSummaries(
  branches: StoreBranch[],
  activeBranchId: string
): StoreBranch[] {
  const updated = branches.map(b => enrichBranchWithLocalVault(b, activeBranchId));
  saveBranches(updated);
  return updated;
}

export function buildEmptyBranchSnapshot(
  branch: Pick<StoreBranch, 'id' | 'name' | 'address' | 'phone'>,
  options?: {
    copyCatalog?: boolean;
    initialStockMode?: 'zero' | 'copy';
    copyCustomers?: boolean;
  }
): BranchWorkspaceSnapshot {
  const currentLive = captureLiveWorkspaceSnapshot(branch.id);
  const nowIso = new Date().toISOString();

  const products: Product[] =
    options?.copyCatalog !== false
      ? currentLive.products.map(p => ({
          ...p,
          stockPieces: options?.initialStockMode === 'copy' ? p.stockPieces : 0,
          updatedAt: nowIso,
        }))
      : [];

  return {
    branchId: branch.id,
    products,
    customers: options?.copyCustomers ? currentLive.customers : [],
    bills: [],
    khata: [],
    suppliers: currentLive.suppliers,
    purchaseOrders: [],
    cashFlowEntries: [],
    openingCashMap: {},
    loyaltyTransactions: [],
    staffMembers: currentLive.staffMembers,
    attendanceRecords: [],
    storeProfile: {
      ...currentLive.storeProfile,
      storeName: branch.name,
      address: branch.address || currentLive.storeProfile.address,
      contactNumber: branch.phone || currentLive.storeProfile.contactNumber,
      updatedAt: nowIso,
    },
    updatedAt: nowIso,
  };
}

export async function fetchMultiStoreStateFromServer(): Promise<MultiStoreServerFetchResult> {
  const localConfig = getStoredMultiBranchConfig();
  const localBranches = getStoredBranches();
  const localTransfers = getStoredBranchTransfers();

  // Ensure active branch always has an up-to-date vault snapshot locally
  const liveSnap = captureLiveWorkspaceSnapshot(localConfig.activeBranchId);
  saveBranchVaultSnapshot(localConfig.activeBranchId, liveSnap);

  try {
    const res = await fetch('/api/branches');
    if (!res.ok) {
      return {
        reachable: false,
        config: localConfig,
        branches: refreshLocalBranchSummaries(localBranches, localConfig.activeBranchId),
        transfers: localTransfers,
      };
    }
    const json = await res.json();
    const serverConfig: MultiBranchSyncConfig = {
      ...localConfig,
      ...(json?.config || {}),
      // Preserve local activeBranchId so a browser reload never jumps branches unexpectedly
      activeBranchId: localConfig.activeBranchId || json?.config?.activeBranchId || MAIN_HQ_BRANCH_ID,
    };

    const serverBranches: StoreBranch[] = Array.isArray(json?.branches) ? json.branches : [];
    const mergedMap = new Map<string, StoreBranch>();
    for (const lb of localBranches) {
      mergedMap.set(lb.id, lb);
    }
    for (const sb of serverBranches) {
      const existing = mergedMap.get(sb.id);
      mergedMap.set(sb.id, existing ? { ...existing, ...sb } : sb);
    }
    if (!mergedMap.has(MAIN_HQ_BRANCH_ID)) {
      mergedMap.set(MAIN_HQ_BRANCH_ID, createDefaultMainBranch(getStoredStoreProfile()));
    }

    const mergedBranches = refreshLocalBranchSummaries(
      Array.from(mergedMap.values()),
      serverConfig.activeBranchId
    );
    const serverTransfers: BranchStockTransfer[] = Array.isArray(json?.transfers)
      ? json.transfers
      : localTransfers;

    saveMultiBranchConfig(serverConfig);
    saveBranchTransfers(serverTransfers);

    return {
      reachable: true,
      config: serverConfig,
      branches: mergedBranches,
      transfers: serverTransfers,
    };
  } catch {
    return {
      reachable: false,
      config: localConfig,
      branches: refreshLocalBranchSummaries(localBranches, localConfig.activeBranchId),
      transfers: localTransfers,
    };
  }
}

export async function updateMultiBranchSyncConfig(
  nextConfig: MultiBranchSyncConfig
): Promise<MultiBranchSyncConfig> {
  saveMultiBranchConfig(nextConfig);
  try {
    const res = await fetch('/api/branches/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: nextConfig }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.config) {
        const reconciled: MultiBranchSyncConfig = {
          ...nextConfig,
          ...json.config,
          activeBranchId: nextConfig.activeBranchId,
        };
        saveMultiBranchConfig(reconciled);
        return reconciled;
      }
    }
  } catch {
    // Offline fallback already saved locally
  }
  return nextConfig;
}

export async function saveStoreBranchProfile(
  input: {
    id?: string;
    code: string;
    name: string;
    city?: string;
    address?: string;
    phone?: string;
    managerName?: string;
  },
  currentBranches: StoreBranch[],
  activeBranchId: string,
  options?: {
    copyCatalog?: boolean;
    initialStockMode?: 'zero' | 'copy';
    copyCustomers?: boolean;
  }
): Promise<{
  ok: boolean;
  error?: string;
  branch?: StoreBranch;
  branches: StoreBranch[];
}> {
  const cleanName = input.name.trim();
  const cleanCode = input.code.trim().toUpperCase();
  if (!cleanName || !cleanCode) {
    return {
      ok: false,
      error: 'Both Branch Name and Branch Code are required.',
      branches: currentBranches,
    };
  }

  const duplicateCode = currentBranches.find(
    b => b.code.toUpperCase() === cleanCode && b.id !== input.id
  );
  if (duplicateCode) {
    return {
      ok: false,
      error: `Branch code "${cleanCode}" is already assigned to ${duplicateCode.name}.`,
      branches: currentBranches,
    };
  }

  // Keep active branch vault fresh before reading template
  const liveSnap = captureLiveWorkspaceSnapshot(activeBranchId);
  saveBranchVaultSnapshot(activeBranchId, liveSnap);

  const nowIso = new Date().toISOString();
  const isEdit = Boolean(input.id && currentBranches.some(b => b.id === input.id));
  const branchId = isEdit
    ? input.id!
    : `branch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const existing = currentBranches.find(b => b.id === branchId);
  const branchRecord: StoreBranch = {
    id: branchId,
    code: cleanCode,
    name: cleanName,
    city: input.city?.trim() || '',
    address: input.address?.trim() || '',
    phone: input.phone?.trim() || '',
    managerName: input.managerName?.trim() || '',
    isHeadquarters: existing ? existing.isHeadquarters : false,
    active: existing ? existing.active : true,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  let initialSnapshot: BranchWorkspaceSnapshot | undefined;
  if (!isEdit) {
    initialSnapshot = buildEmptyBranchSnapshot(branchRecord, options);
    saveBranchVaultSnapshot(branchId, initialSnapshot);
  } else {
    const existingVault =
      branchId === activeBranchId ? liveSnap : loadBranchVaultSnapshot(branchId);
    if (existingVault) {
      const updatedVault: BranchWorkspaceSnapshot = {
        ...existingVault,
        storeProfile: {
          ...existingVault.storeProfile,
          storeName: branchRecord.name,
          address: branchRecord.address || existingVault.storeProfile.address,
          contactNumber: branchRecord.phone || existingVault.storeProfile.contactNumber,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
      };
      saveBranchVaultSnapshot(branchId, updatedVault);
    }
  }

  const nextBranches = isEdit
    ? currentBranches.map(b => (b.id === branchId ? branchRecord : b))
    : [...currentBranches, branchRecord];

  const enrichedLocal = refreshLocalBranchSummaries(nextBranches, activeBranchId);

  try {
    const res = await fetch('/api/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch: branchRecord,
        initialSnapshot,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.branches)) {
        const merged = json.branches.map((sb: StoreBranch) =>
          enrichBranchWithLocalVault(sb, activeBranchId)
        );
        saveBranches(merged);
        return {
          ok: true,
          branch: merged.find((b: StoreBranch) => b.id === branchId) || branchRecord,
          branches: merged,
        };
      }
    }
  } catch {
    // Offline save already completed locally
  }

  return {
    ok: true,
    branch: enrichedLocal.find(b => b.id === branchId) || branchRecord,
    branches: enrichedLocal,
  };
}

export async function switchActiveStoreBranch(
  targetBranchId: string,
  currentConfig: MultiBranchSyncConfig,
  currentBranches: StoreBranch[]
): Promise<{
  ok: boolean;
  error?: string;
  config: MultiBranchSyncConfig;
  branches: StoreBranch[];
}> {
  const targetBranch = currentBranches.find(b => b.id === targetBranchId);
  if (!targetBranch) {
    return {
      ok: false,
      error: 'Target branch could not be found.',
      config: currentConfig,
      branches: currentBranches,
    };
  }

  const prevBranchId = currentConfig.activeBranchId || MAIN_HQ_BRANCH_ID;
  const liveSnapshot = captureLiveWorkspaceSnapshot(prevBranchId);
  saveBranchVaultSnapshot(prevBranchId, liveSnapshot);

  if (currentConfig.enabled && prevBranchId !== targetBranchId) {
    fetch(`/api/branches/${encodeURIComponent(prevBranchId)}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: liveSnapshot }),
    }).catch(() => {});
  }

  if (prevBranchId !== targetBranchId) {
    let targetSnapshot = loadBranchVaultSnapshot(targetBranchId);

    if (currentConfig.enabled) {
      try {
        const res = await fetch(`/api/branches/${encodeURIComponent(targetBranchId)}/snapshot`);
        if (res.ok) {
          const json = await res.json();
          const serverSnap = json?.snapshot as BranchWorkspaceSnapshot | null;
          if (serverSnap && (!targetSnapshot || serverSnap.updatedAt > targetSnapshot.updatedAt)) {
            targetSnapshot = serverSnap;
            saveBranchVaultSnapshot(targetBranchId, serverSnap);
          }
        }
      } catch {
        // Offline fallback uses local vault
      }
    }

    if (!targetSnapshot) {
      targetSnapshot = buildEmptyBranchSnapshot(targetBranch, {
        copyCatalog: true,
        initialStockMode: 'zero',
        copyCustomers: currentConfig.syncCustomersAndKhata,
      });
      saveBranchVaultSnapshot(targetBranchId, targetSnapshot);
    }

    applyWorkspaceSnapshotToLiveStorage(targetSnapshot);
  }

  const nextConfig: MultiBranchSyncConfig = {
    ...currentConfig,
    activeBranchId: targetBranchId,
  };
  saveMultiBranchConfig(nextConfig);

  fetch('/api/branches/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: nextConfig }),
  }).catch(() => {});

  const refreshedBranches = refreshLocalBranchSummaries(currentBranches, targetBranchId);
  return {
    ok: true,
    config: nextConfig,
    branches: refreshedBranches,
  };
}

export async function removeStoreBranch(
  branchId: string,
  currentConfig: MultiBranchSyncConfig,
  currentBranches: StoreBranch[]
): Promise<{
  ok: boolean;
  error?: string;
  switchedToHq?: boolean;
  config: MultiBranchSyncConfig;
  branches: StoreBranch[];
}> {
  const target = currentBranches.find(b => b.id === branchId);
  if (!target) {
    return {
      ok: false,
      error: 'Branch not found.',
      config: currentConfig,
      branches: currentBranches,
    };
  }
  if (target.isHeadquarters || branchId === MAIN_HQ_BRANCH_ID) {
    return {
      ok: false,
      error: 'Headquarters (Main Store) branch cannot be deleted.',
      config: currentConfig,
      branches: currentBranches,
    };
  }

  let nextConfig = currentConfig;
  let switchedToHq = false;

  if (currentConfig.activeBranchId === branchId) {
    const switchRes = await switchActiveStoreBranch(
      MAIN_HQ_BRANCH_ID,
      currentConfig,
      currentBranches
    );
    nextConfig = switchRes.config;
    switchedToHq = true;
  }

  removeBranchVaultSnapshot(branchId);
  const filteredBranches = refreshLocalBranchSummaries(
    currentBranches.filter(b => b.id !== branchId),
    nextConfig.activeBranchId
  );

  try {
    await fetch(`/api/branches/${encodeURIComponent(branchId)}`, {
      method: 'DELETE',
    });
  } catch {
    // Offline deletion still persists locally
  }

  return {
    ok: true,
    switchedToHq,
    config: nextConfig,
    branches: filteredBranches,
  };
}

export async function syncAllBranchesNow(
  config: MultiBranchSyncConfig,
  branches: StoreBranch[]
): Promise<MultiBranchSyncResult> {
  if (!config.enabled) {
    return {
      ok: false,
      syncDisabled: true,
      error:
        'Multi-branch synchronization is disabled. Enable the Multi-Branch Sync toggle switch to sync branches.',
    };
  }

  const activeBranchId = config.activeBranchId || MAIN_HQ_BRANCH_ID;
  const activeSnapshot = captureLiveWorkspaceSnapshot(activeBranchId);
  saveBranchVaultSnapshot(activeBranchId, activeSnapshot);

  // Ensure server knows about all local branches & vaults before running cross-branch sync
  for (const branch of branches) {
    if (branch.id === activeBranchId) continue;
    const vault = loadBranchVaultSnapshot(branch.id);
    try {
      await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch,
          initialSnapshot: vault || undefined,
        }),
      });
    } catch {
      // Ignore individual push errors
    }
  }

  try {
    const res = await fetch('/api/branches/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeBranchId,
        activeSnapshot,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        syncDisabled: Boolean(json?.syncDisabled),
        error: json?.error || `Multi-branch sync failed (${res.status}).`,
      };
    }

    const syncedConfig: MultiBranchSyncConfig = {
      ...config,
      ...(json?.config || {}),
      activeBranchId,
    };
    saveMultiBranchConfig(syncedConfig);

    let activeSnapshotUpdated = false;
    if (json?.syncedActiveSnapshot && typeof json.syncedActiveSnapshot === 'object') {
      saveBranchVaultSnapshot(activeBranchId, json.syncedActiveSnapshot);
      applyWorkspaceSnapshotToLiveStorage(json.syncedActiveSnapshot);
      activeSnapshotUpdated = true;
    }

    const serverBranches: StoreBranch[] = Array.isArray(json?.branches) ? json.branches : branches;
    // Also fetch & update local vaults for non-active branches so catalog/customer merges persist locally
    for (const b of serverBranches) {
      if (b.id === activeBranchId) continue;
      try {
        const snapRes = await fetch(`/api/branches/${encodeURIComponent(b.id)}/snapshot`);
        if (snapRes.ok) {
          const snapJson = await snapRes.json();
          if (snapJson?.snapshot) {
            saveBranchVaultSnapshot(b.id, snapJson.snapshot);
          }
        }
      } catch {
        // Ignore offline individual snap pull
      }
    }

    const refreshedBranches = refreshLocalBranchSummaries(serverBranches, activeBranchId);
    const transfers: BranchStockTransfer[] = Array.isArray(json?.transfers)
      ? json.transfers
      : getStoredBranchTransfers();
    saveBranchTransfers(transfers);

    return {
      ok: true,
      syncedAt: json?.syncedAt || new Date().toISOString(),
      config: syncedConfig,
      branches: refreshedBranches,
      transfers,
      activeSnapshotUpdated,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Network error during multi-branch synchronization.',
    };
  }
}

export async function transferStockBetweenBranches(
  params: {
    fromBranchId: string;
    toBranchId: string;
    productId: string;
    productName: string;
    pieces: number;
    note?: string;
    createdBy?: string;
  },
  config: MultiBranchSyncConfig,
  branches: StoreBranch[]
): Promise<BranchTransferResult> {
  if (!config.enabled) {
    return {
      ok: false,
      syncDisabled: true,
      error:
        'Multi-branch synchronization is disabled. Enable the Multi-Branch Sync toggle switch to transfer stock.',
    };
  }

  if (!config.syncInventoryTransfers) {
    return {
      ok: false,
      error: 'Inventory transfers between branches are paused in branch sync rules.',
    };
  }

  const activeBranchId = config.activeBranchId || MAIN_HQ_BRANCH_ID;
  const liveSnapshot = captureLiveWorkspaceSnapshot(activeBranchId);
  saveBranchVaultSnapshot(activeBranchId, liveSnapshot);

  // Push involved snapshots so server balances match local reality
  for (const bid of Array.from(new Set([params.fromBranchId, params.toBranchId, activeBranchId]))) {
    const snap = bid === activeBranchId ? liveSnapshot : loadBranchVaultSnapshot(bid);
    if (snap) {
      try {
        await fetch(`/api/branches/${encodeURIComponent(bid)}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot: snap }),
        });
      } catch {
        // Proceed cleanly
      }
    }
  }

  try {
    const res = await fetch('/api/branches/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        syncDisabled: Boolean(json?.syncDisabled),
        error: json?.error || `Transfer failed (${res.status}).`,
      };
    }

    // Update local vaults & live storage if active branch was involved
    for (const bid of [params.fromBranchId, params.toBranchId]) {
      try {
        const snapRes = await fetch(`/api/branches/${encodeURIComponent(bid)}/snapshot`);
        if (snapRes.ok) {
          const snapJson = await snapRes.json();
          if (snapJson?.snapshot) {
            saveBranchVaultSnapshot(bid, snapJson.snapshot);
            if (bid === activeBranchId && Array.isArray(snapJson.snapshot.products)) {
              saveProducts(snapJson.snapshot.products);
            }
          }
        }
      } catch {
        // Fallback manual local vault update
        const vault = bid === activeBranchId ? liveSnapshot : loadBranchVaultSnapshot(bid);
        if (vault) {
          const delta = bid === params.fromBranchId ? -params.pieces : params.pieces;
          const nextProds = vault.products.map(p =>
            p.id === params.productId
              ? { ...p, stockPieces: Math.max(0, p.stockPieces + delta) }
              : p
          );
          const updatedVault: BranchWorkspaceSnapshot = {
            ...vault,
            products: nextProds,
            updatedAt: new Date().toISOString(),
          };
          saveBranchVaultSnapshot(bid, updatedVault);
          if (bid === activeBranchId) {
            saveProducts(nextProds);
          }
        }
      }
    }

    const nextTransfers: BranchStockTransfer[] = Array.isArray(json?.transfers)
      ? json.transfers
      : getStoredBranchTransfers();
    saveBranchTransfers(nextTransfers);

    const serverBranches: StoreBranch[] = Array.isArray(json?.branches) ? json.branches : branches;
    const refreshedBranches = refreshLocalBranchSummaries(serverBranches, activeBranchId);

    return {
      ok: true,
      transfer: json?.transfer,
      branches: refreshedBranches,
      transfers: nextTransfers,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Network error while transferring stock between branches.',
    };
  }
}
