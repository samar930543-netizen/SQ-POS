import React, { useState } from 'react';
import { Product } from '../types';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { hasConfiguredBundleTier, hasConfiguredPieceTier } from '../utils/unitSpecs';
import { CategoryManagementPanel, CategoryMutationResult } from './CategoryManagementPanel';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { matchProductByBarcode } from '../utils/barcodeScanner';
import {
  Package,
  Plus,
  AlertTriangle,
  Edit2,
  Trash2,
  Search,
  ArrowUpCircle,
  X,
  Camera,
  Truck,
  FolderKanban,
  ScanBarcode,
  Mic,
} from 'lucide-react';

interface InventoryManagerProps {
  products: Product[];
  categories: string[];
  onSaveProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onRestockProduct: (productId: string, additionalPieces: number) => void;
  onAddCategory: (name: string) => CategoryMutationResult;
  onRenameCategory: (oldName: string, newName: string) => CategoryMutationResult;
  onDeleteCategory: (name: string) => CategoryMutationResult;
  onOpenNewProductModal: () => void;
  onEditProduct: (product: Product) => void;
  onOpenScanBillModal?: () => void;
  onOpenAudioTranscribe?: () => void;
  onOrderPurchaseOrder?: (productId: string) => void;
  showLowStockBanner?: boolean;
  canManageCategories?: boolean;
  canDeleteProducts?: boolean;
}

export const InventoryManager: React.FC<InventoryManagerProps> = ({
  products,
  categories,
  onSaveProduct,
  onDeleteProduct,
  onRestockProduct,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onOpenNewProductModal,
  onEditProduct,
  onOpenScanBillModal,
  onOpenAudioTranscribe,
  onOrderPurchaseOrder,
  showLowStockBanner = true,
  canManageCategories = true,
  canDeleteProducts = true,
}) => {
  const [activeSubView, setActiveSubView] = useState<'products' | 'categories'>('products');
  const [search, setSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<string | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockBundles, setRestockBundles] = useState('1');
  const [restockLoosePcs, setRestockLoosePcs] = useState('0');
  const [isBarcodeLookupOpen, setIsBarcodeLookupOpen] = useState(false);

  // Count low stock items
  const lowStockCount = products.filter(p => p.stockPieces <= p.lowStockThreshold).length;

  const filtered = products.filter(p => {
    if (selectedCategoryFilter !== 'All' && p.category !== selectedCategoryFilter) {
      return false;
    }
    if (showLowStockBanner && filterLowStockOnly && p.stockPieces > p.lowStockThreshold) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        Boolean(p.barcode?.toLowerCase().includes(q)) ||
        Boolean(p.pieceBarcode?.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleRestockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct) return;

    const hasBundleTier = hasConfiguredBundleTier(restockProduct);
    const bundles = hasBundleTier ? (parseInt(restockBundles) || 0) : 0;
    const loose = parseInt(restockLoosePcs) || 0;
    const totalAdditional = bundles * restockProduct.bundlePieces + loose;

    if (totalAdditional > 0) {
      soundManager.playCheckoutSuccess();
      onRestockProduct(restockProduct.id, totalAdditional);
    }

    setRestockProduct(null);
    setRestockBundles('1');
    setRestockLoosePcs('0');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      
      {/* Top Header */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-400" />
              SMART INVENTORY &amp; STOCK
            </h2>
            <p className="text-xs text-slate-400">
              Manage SKUs, bundles, stock thresholds &amp; product categories
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Dedicated Products / Categories Sub-view Switcher */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setActiveSubView('products');
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 tabular-nums ${
                  activeSubView === 'products'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Products ({products.length})</span>
              </button>
              {canManageCategories && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setActiveSubView('categories');
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 tabular-nums ${
                    activeSubView === 'categories'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span>Categories ({categories.length})</span>
                </button>
              )}
            </div>

            {onOpenAudioTranscribe && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOpenAudioTranscribe();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-200 border border-sky-500/40 rounded-xl text-xs font-bold transition active:scale-95 whitespace-nowrap shrink-0"
                title="Record voice or upload audio file to build a restock item list"
              >
                <Mic className="w-4 h-4 text-sky-400" />
                <span>Audio Restock</span>
              </button>
            )}

            {onOpenScanBillModal && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playScannerBeep();
                  onOpenScanBillModal();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-900/40 transition active:scale-95 whitespace-nowrap shrink-0"
                title="Scan vendor bills from photo to restock inventory"
              >
                <Camera className="w-4 h-4 text-purple-200" />
                <span>Scan Bill OCR</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenNewProductModal();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md transition active:scale-95 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          </div>
        </div>

        {/* Search, Category Filter & Low-Stock Filter (Products view only) */}
        {activeSubView === 'products' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search products by name, category, or barcode..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setIsBarcodeLookupOpen(true);
                }}
                className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-blue-300 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
                title="Scan product barcode to locate or restock"
              >
                <ScanBarcode className="w-4 h-4" />
                <span className="hidden sm:inline">Scan Barcode</span>
              </button>
            </div>

            <select
              value={selectedCategoryFilter}
              onChange={e => setSelectedCategoryFilter(e.target.value)}
              aria-label="Filter products by category"
              className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            >
              <option value="All">All Categories ({categories.length})</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {showLowStockBanner && lowStockCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setFilterLowStockOnly(!filterLowStockOnly);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition whitespace-nowrap flex items-center justify-center gap-1.5 tabular-nums shrink-0 ${
                  filterLowStockOnly
                    ? 'bg-amber-600 text-white border-amber-500'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                <AlertTriangle className={`w-3.5 h-3.5 ${filterLowStockOnly ? 'text-white' : 'text-amber-400'}`} />
                <span>{filterLowStockOnly ? 'Showing Low Stock (All)' : `Filter Low Stock (${lowStockCount})`}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Category Management View vs Products List */}
      {activeSubView === 'categories' && canManageCategories ? (
        <CategoryManagementPanel
          categories={categories}
          products={products}
          onAddCategory={onAddCategory}
          onRenameCategory={(oldName, newName) => {
            const res = onRenameCategory(oldName, newName);
            if (res.ok && selectedCategoryFilter === oldName) {
              setSelectedCategoryFilter(newName.trim());
            }
            return res;
          }}
          onDeleteCategory={name => {
            const res = onDeleteCategory(name);
            if (res.ok && selectedCategoryFilter === name) {
              setSelectedCategoryFilter('All');
            }
            return res;
          }}
          onViewCategoryProducts={catName => {
            setSelectedCategoryFilter(catName);
            setActiveSubView('products');
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-800/60">
          {filtered.length === 0 ? (
            <div className="py-14 px-4 flex flex-col items-center justify-center text-center bg-slate-900/40 rounded-2xl border border-slate-800">
              <Package className="w-10 h-10 text-slate-600 mb-2 stroke-[1.5]" />
              <p className="text-sm font-bold text-slate-200">No matching products</p>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing your search or category filter, or add a new product.
              </p>
              {(search.trim() || selectedCategoryFilter !== 'All' || filterLowStockOnly) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setSelectedCategoryFilter('All');
                    setFilterLowStockOnly(false);
                  }}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            filtered.map(product => {
          const stockInfo = formatStockDisplay(
            product.stockPieces,
            product.bundlePieces,
            product.bundleUnitName
          );
          const isLowStock = product.stockPieces <= product.lowStockThreshold;

          return (
            <div
              key={product.id}
              className="py-3.5 px-2 rounded-xl hover:bg-slate-900/60 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="w-12 h-12 rounded-xl overflow-hidden bg-slate-950 border border-slate-700/80 flex items-center justify-center flex-shrink-0 shadow-md"
                >
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className={`w-full h-full bg-gradient-to-br ${product.color} flex items-center justify-center text-xl`}
                    >
                      {product.emoji}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-white text-sm truncate">{product.name}</h4>
                    {isLowStock && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {product.stockPieces < 0
                          ? 'Negative Stock - Reorder'
                          : product.stockPieces === 0
                          ? 'Depleted - Reorder'
                          : 'Low Stock - Reorder'}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{product.category}</span>
                    {product.barcode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                          {product.barcode}
                        </span>
                      </>
                    )}
                    {product.pieceBarcode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-amber-300 tabular-nums">
                          Pc:{product.pieceBarcode}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Dynamic Multi-unit rates (only configured tiers shown) */}
                  <div className="flex items-center gap-3 text-xs mt-1.5 flex-wrap">
                    {hasConfiguredBundleTier(product) && (
                      <span className="text-blue-300 font-semibold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 tabular-nums">
                        {product.bundleUnitName} ({product.bundlePieces} {product.bundlePieces === 1 ? 'pc' : 'pcs'}): {formatCurrency(product.bundlePrice)}
                      </span>
                    )}
                    {(hasConfiguredPieceTier(product) || !hasConfiguredBundleTier(product)) && (
                      <span className="text-amber-300 font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 tabular-nums">
                        Piece: {formatCurrency(product.piecePrice)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stock display & Action buttons */}
              <div className="flex items-center justify-between sm:justify-end gap-3 pl-14 sm:pl-0 pt-1 sm:pt-0">
                <div className="text-left sm:text-right">
                  <div
                    className={`text-sm font-black tabular-nums ${
                      product.stockPieces <= 0
                        ? 'text-rose-400'
                        : isLowStock
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {stockInfo.text}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Threshold: {product.lowStockThreshold} pcs
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {onOrderPurchaseOrder && (
                    <button
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onOrderPurchaseOrder(product.id);
                      }}
                      className="p-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1 transition active:scale-95"
                      title="Create Supplier Purchase Order for this item"
                    >
                      <Truck className="w-4 h-4" />
                      <span className="hidden md:inline">Order PO</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      const hasBundle = hasConfiguredBundleTier(product);
                      setRestockBundles(hasBundle ? '1' : '0');
                      setRestockLoosePcs(hasBundle ? '0' : '10');
                      setRestockProduct(product);
                    }}
                    className="p-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1 transition active:scale-95"
                    title="Restock shipment"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    <span>Restock</span>
                  </button>

                  <button
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      onEditProduct(product);
                    }}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    title="Edit item"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {canDeleteProducts &&
                    (confirmDeleteProductId === product.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playAlertSound();
                            onDeleteProduct(product.id);
                            setConfirmDeleteProductId(null);
                          }}
                          className="px-2 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold whitespace-nowrap"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProductId(null)}
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setConfirmDeleteProductId(product.id);
                        }}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
                        title="Delete item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ))}
                </div>
              </div>
            </div>
          );
        })
          )}
      </div>
      )}

      {/* Restock Modal */}
      {restockProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">RESTOCK PRODUCT SHIPMENT</h3>
              <button
                onClick={() => setRestockProduct(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRestockSubmit} className="mt-4 space-y-3.5 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Product:</span>
                <div className="text-sm font-bold text-white">{restockProduct.name}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Current Stock: {restockProduct.stockPieces} pieces
                  {hasConfiguredBundleTier(restockProduct)
                    ? ` (1 ${restockProduct.bundleUnitName} = ${restockProduct.bundlePieces} pcs)`
                    : ''}
                </div>
              </div>

              <div className={`grid ${hasConfiguredBundleTier(restockProduct) ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5`}>
                {hasConfiguredBundleTier(restockProduct) && (
                  <div>
                    <label className="text-blue-300 font-bold block mb-1">
                      Add {restockProduct.bundleUnitName}s:
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={restockBundles}
                      onChange={e => setRestockBundles(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-bold text-base focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      = {(parseInt(restockBundles) || 0) * restockProduct.bundlePieces} pcs
                    </span>
                  </div>
                )}

                <div>
                  <label className="text-amber-300 font-bold block mb-1">
                    {hasConfiguredBundleTier(restockProduct) ? 'Add Loose Pieces:' : 'Add Stock (Pieces):'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={restockLoosePcs}
                    onChange={e => setRestockLoosePcs(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-bold text-base focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    {hasConfiguredBundleTier(restockProduct) ? 'Loose stock' : 'Single-piece unit stock'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400 font-medium">New Total Stock:</span>
                <span className="text-sm font-black text-emerald-400 tabular-nums">
                  {restockProduct.stockPieces +
                    (hasConfiguredBundleTier(restockProduct)
                      ? (parseInt(restockBundles) || 0) * restockProduct.bundlePieces
                      : 0) +
                    (parseInt(restockLoosePcs) || 0)}{' '}
                  Pieces
                </span>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setRestockProduct(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md shadow-emerald-900/40"
                >
                  Confirm Restock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CameraBarcodeModal
        isOpen={isBarcodeLookupOpen}
        onClose={() => setIsBarcodeLookupOpen(false)}
        title="Scan Barcode to Locate Inventory SKU"
        subtitle="Scan any box or loose piece barcode to filter inventory immediately"
        mode="single"
        products={products}
        onScanCode={code => {
          const match = matchProductByBarcode(products, code);
          setSelectedCategoryFilter('All');
          setFilterLowStockOnly(false);
          setSearch(match ? match.product.barcode || match.product.name : code);
          return match
            ? { ok: true, message: `Found ${match.product.name}` }
            : { ok: false, message: `Filtered for "${code}"` };
        }}
      />

    </div>
  );
};
