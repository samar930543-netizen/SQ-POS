import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Product, UnitType, CartItem, Customer, PosDisplayMode, PosUiVisibility } from '../types';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { getEffectiveUnitPrice, getCustomerPricingLabel } from '../utils/customerPricing';
import { getLoyaltyTierForPoints, getLoyaltyTierBadgeColor } from '../utils/loyaltyProgram';
import {
  getPreferredUnit,
  hasConfiguredBundleTier,
  hasConfiguredPieceTier,
  isUnitConfigured,
} from '../utils/unitSpecs';
import {
  getStoredFavoriteProductIds,
  saveFavoriteProductIds,
  getStoredDisplayMode,
  saveDisplayMode,
} from '../utils/storage';
import {
  DISPLAY_MODES,
  computeCategories,
  computeCategoryStats,
  computeStockAlertMetrics,
  filterCatalogProducts,
} from '../utils/catalogFilter';
import { BarcodeScannerView } from './BarcodeScannerView';
import { CustomerSelectorModal } from './CustomerSelectorModal';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  getStoredBarcodePrefs,
  matchProductForQuickScan,
  resolveUnitForScannedProduct,
  saveBarcodePrefs,
} from '../utils/barcodeScanner';
import {
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Grid3x3,
  LayoutGrid,
  List,
  Mic,
  Package,
  Pencil,
  Plus,
  PlusCircle,
  RotateCcw,
  ScanBarcode,
  Search,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';

interface ProductGridProps {
  products: Product[];
  cart: CartItem[];
  onAddToCart: (product: Product, unit: UnitType, quantity?: number, overrideUnitPrice?: number) => void;
  onUpdateQuantity?: (productId: string, unit: UnitType, newQty: number, overrideUnitPrice?: number) => void;
  onOpenNewProductModal: () => void;
  onCreateProductWithBarcode?: (barcode: string) => void;
  onOpenCart?: () => void;
  onExpressCashCheckout?: () => void;
  isExternalModalOpen?: boolean;
  customers?: Customer[];
  selectedCustomerId?: string;
  onSelectCustomer?: (customerId: string) => void;
  onAddNewCustomer?: (name: string, phone: string) => Customer;
  activeCustomer?: Customer | null;
  favoriteProductIds?: string[];
  onToggleFavorite?: (productId: string) => void;
  onOrderPurchaseOrder?: (productId: string) => void;
  onOpenAudioTranscribe?: () => void;
  posUiVisibility?: PosUiVisibility;
}

const renderModeIcon = (mode: PosDisplayMode) => {
  switch (mode) {
    case 'grid':
      return <LayoutGrid className="w-3.5 h-3.5" />;
    case 'compact_grid':
      return <Grid3x3 className="w-3.5 h-3.5" />;
    case 'list':
      return <List className="w-3.5 h-3.5" />;
    case 'category_tabbed':
      return <FolderKanban className="w-3.5 h-3.5" />;
    case 'compact_search':
      return <Zap className="w-3.5 h-3.5" />;
    case 'barcode_scanner':
      return <ScanBarcode className="w-3.5 h-3.5" />;
    case 'favorites':
      return <Star className="w-3.5 h-3.5" />;
    case 'stock_alert':
      return <AlertTriangle className="w-3.5 h-3.5" />;
  }
};

export const ProductGrid: React.FC<ProductGridProps> = ({
  products,
  cart,
  onAddToCart,
  onUpdateQuantity,
  onOpenNewProductModal,
  onCreateProductWithBarcode,
  onOpenCart,
  onExpressCashCheckout,
  isExternalModalOpen = false,
  customers = [],
  selectedCustomerId = '',
  onSelectCustomer,
  onAddNewCustomer,
  activeCustomer = null,
  favoriteProductIds,
  onToggleFavorite,
  onOrderPurchaseOrder,
  onOpenAudioTranscribe,
  posUiVisibility,
}) => {
  const { isMobileLayout, isTabletLayout, isDesktopLayout, isWideDesktop } =
    useViewportLayout();
  const showCustomerSelector = posUiVisibility?.walkInCustomerSelector !== false;
  const showLowStockBanner = posUiVisibility?.lowStockAlertBanner !== false;
  const showCategoryTabs = posUiVisibility?.categoryFilterTabs !== false;
  const showCatalogDisplayBar = posUiVisibility?.catalogDisplayBar !== false;

  const standardGridColsClass = isMobileLayout
    ? 'grid-cols-1'
    : isTabletLayout
    ? 'grid-cols-2'
    : isWideDesktop
    ? 'grid-cols-4'
    : 'grid-cols-3';

  const compactGridColsClass = isMobileLayout
    ? 'grid-cols-2'
    : isTabletLayout
    ? 'grid-cols-4'
    : isWideDesktop
    ? 'grid-cols-6'
    : 'grid-cols-5';

  const compactSearchGridColsClass = isMobileLayout
    ? 'grid-cols-1'
    : isTabletLayout
    ? 'grid-cols-2'
    : 'grid-cols-3';

  const [displayMode, setDisplayMode] = useState<PosDisplayMode>(() => getStoredDisplayMode());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState<boolean>(false);
  const [compactQuickUnit, setCompactQuickUnit] = useState<'auto' | UnitType>(
    () => getStoredBarcodePrefs().defaultUnit
  );
  const [compactFeedback, setCompactFeedback] = useState<string | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [isCameraBarcodeOpen, setIsCameraBarcodeOpen] = useState<boolean>(false);
  const [scanNotice, setScanNotice] = useState<{
    ok: boolean;
    message: string;
    unknownCode?: string;
  } | null>(null);
  const [activeTapAnimation, setActiveTapAnimation] = useState<string | null>(null);
  const [editingQtyProductId, setEditingQtyProductId] = useState<string | null>(null);
  const [editingQtyUnit, setEditingQtyUnit] = useState<UnitType>('bundle');
  const [editingQtyDraft, setEditingQtyDraft] = useState<string>('1');
  const [editingPriceDraft, setEditingPriceDraft] = useState<string>('');
  const [localFavoriteIds, setLocalFavoriteIds] = useState<string[]>(() =>
    getStoredFavoriteProductIds(products)
  );

  const qtyInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scanNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingQtyProductId) {
      const id = window.setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [editingQtyProductId, editingQtyUnit]);

  useEffect(() => {
    if (!favoriteProductIds) {
      setLocalFavoriteIds(getStoredFavoriteProductIds(products));
    }
  }, [products, favoriteProductIds]);

  const effectiveFavoriteIds = useMemo(
    () => new Set(favoriteProductIds ?? localFavoriteIds),
    [favoriteProductIds, localFavoriteIds]
  );

  const handleToggleFavoriteClick = (productId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    soundManager.playMechanicalClick();
    if (onToggleFavorite) {
      onToggleFavorite(productId);
      return;
    }
    setLocalFavoriteIds(prev => {
      const next = prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId];
      saveFavoriteProductIds(next);
      return next;
    });
  };

  const handlePinDefaultFavorites = () => {
    soundManager.playCheckoutSuccess();
    const topFour = products.slice(0, 4).map(p => p.id);
    if (onToggleFavorite) {
      topFour.forEach(id => {
        if (!effectiveFavoriteIds.has(id)) onToggleFavorite(id);
      });
    } else {
      setLocalFavoriteIds(topFour);
      saveFavoriteProductIds(topFour);
    }
  };

  const handleChangeDisplayMode = (mode: PosDisplayMode) => {
    soundManager.playMechanicalClick();
    setDisplayMode(mode);
    saveDisplayMode(mode);
    if (mode !== 'stock_alert') {
      setFilterLowStockOnly(false);
    }
    if (mode === 'compact_search') {
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  };

  // Categories, category stats & stock alert metrics
  const categories = useMemo(() => computeCategories(products), [products]);
  const categoryStats = useMemo(() => computeCategoryStats(products), [products]);
  const stockAlertMetrics = useMemo(() => computeStockAlertMetrics(products), [products]);
  const favoritesCount = useMemo(
    () => products.filter(p => effectiveFavoriteIds.has(p.id)).length,
    [products, effectiveFavoriteIds]
  );

  const effectiveSelectedCategory = showCategoryTabs ? selectedCategory : 'All';

  // Filtered products based on search, category, and display mode
  const filteredProducts = useMemo(
    () =>
      filterCatalogProducts({
        products,
        displayMode,
        favoriteIds: effectiveFavoriteIds,
        showLowStockBanner,
        filterLowStockOnly,
        effectiveSelectedCategory,
        searchQuery,
      }),
    [
      products,
      displayMode,
      effectiveFavoriteIds,
      showLowStockBanner,
      filterLowStockOnly,
      effectiveSelectedCategory,
      searchQuery,
    ]
  );

  const showScanToast = (notice: {
    ok: boolean;
    message: string;
    unknownCode?: string;
  }) => {
    setScanNotice(notice);
    if (scanNoticeTimerRef.current !== null) {
      window.clearTimeout(scanNoticeTimerRef.current);
    }
    scanNoticeTimerRef.current = window.setTimeout(() => {
      setScanNotice(null);
    }, 4500);
  };

  useEffect(() => {
    return () => {
      if (scanNoticeTimerRef.current !== null) {
        window.clearTimeout(scanNoticeTimerRef.current);
      }
    };
  }, []);

  const handleScanCodeResult = (
    rawCode: string,
    allowSinglePartialMatch: boolean = false
  ): { ok: boolean; message: string; productName?: string; amount?: number } => {
    const { match, multiplier, code } = matchProductForQuickScan(products, rawCode);
    const resolvedMatch =
      match && (allowSinglePartialMatch || match.matchedField !== 'search') ? match : null;

    if (!resolvedMatch) {
      soundManager.playAlertSound();
      const msg = `Barcode "${code || rawCode.trim()}" not found in catalog.`;
      showScanToast({
        ok: false,
        message: msg,
        unknownCode: code || rawCode.trim(),
      });
      return { ok: false, message: msg };
    }

    const chosenUnit = resolveUnitForScannedProduct(
      resolvedMatch.product,
      compactQuickUnit,
      resolvedMatch.detectedUnit
    );
    const eff = getEffectiveUnitPrice(resolvedMatch.product, chosenUnit, activeCustomer);
    const unitLabel = chosenUnit === 'bundle' ? resolvedMatch.product.bundleUnitName : 'Piece';
    const lineAmount = eff.unitPrice * multiplier;

    soundManager.playScannerBeep();
    onAddToCart(resolvedMatch.product, chosenUnit, multiplier);

    const msg = `Scanned +${multiplier} ${unitLabel}${multiplier > 1 ? 's' : ''} ${resolvedMatch.product.name} (${formatCurrency(lineAmount)})`;
    showScanToast({ ok: true, message: msg });
    return {
      ok: true,
      message: msg,
      productName: resolvedMatch.product.name,
      amount: lineAmount,
    };
  };

  useHardwareBarcodeScanner({
    enabled:
      !isExternalModalOpen &&
      !isCustomerModalOpen &&
      !isCameraBarcodeOpen &&
      displayMode !== 'barcode_scanner',
    onScan: code => {
      handleScanCodeResult(code, false);
    },
  });

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const raw = searchQuery.trim();
    if (!raw) return;

    const { match, multiplier } = matchProductForQuickScan(products, raw);
    if (match && match.matchedField !== 'search') {
      e.preventDefault();
      handleScanCodeResult(raw, false);
      setSearchQuery('');
      return;
    }

    if (displayMode === 'compact_search' && filteredProducts.length > 0) {
      e.preventDefault();
      const topProduct = filteredProducts[0];
      const targetUnit = resolveUnitForScannedProduct(topProduct, compactQuickUnit);
      if (isUnitConfigured(topProduct, targetUnit)) {
        soundManager.playItemAdded();
        onAddToCart(topProduct, targetUnit, multiplier);
        const unitLabel = targetUnit === 'bundle' ? topProduct.bundleUnitName : 'Piece';
        setCompactFeedback(`Added ${multiplier} ${unitLabel} of ${topProduct.name}`);
        window.setTimeout(() => setCompactFeedback(null), 2000);
        setSearchQuery('');
      }
    }
  };

  // Grouped categories for Category Tabbed View when "All" is selected
  const groupedCategories = useMemo(() => {
    const groups = new Map<string, Product[]>();
    filteredProducts.forEach(p => {
      const arr = groups.get(p.category) || [];
      arr.push(p);
      groups.set(p.category, arr);
    });
    return Array.from(groups.entries());
  }, [filteredProducts]);

  // Handle item tap with sound and haptics (uninterrupted billing even when stock is depleted/negative)
  const handleItemTap = (product: Product, unit: UnitType, e?: React.MouseEvent) => {
    e?.stopPropagation();

    if (!isUnitConfigured(product, unit)) {
      soundManager.playAlertSound();
      return;
    }

    soundManager.playItemAdded();

    const tapKey = `${product.id}_${unit}`;
    setActiveTapAnimation(tapKey);
    setTimeout(() => setActiveTapAnimation(null), 260);

    onAddToCart(product, unit, 1);
  };

  // Get current quantity of product in cart
  const getCartInfo = (productId: string) => {
    const bundleItem = cart.find(i => i.productId === productId && i.unit === 'bundle');
    const pieceItem = cart.find(i => i.productId === productId && i.unit === 'piece');
    if (!bundleItem && !pieceItem) return null;

    const parts = [];
    let totalPieces = 0;
    let totalAmount = 0;

    if (bundleItem) {
      parts.push(`${bundleItem.quantity} ${bundleItem.bundleUnitName}`);
      totalPieces += bundleItem.totalPieces;
      totalAmount += bundleItem.itemTotal;
    }
    if (pieceItem) {
      parts.push(`${pieceItem.quantity} Pcs`);
      totalPieces += pieceItem.quantity;
      totalAmount += pieceItem.itemTotal;
    }

    return {
      text: parts.join(' + '),
      totalPieces,
      totalAmount,
      bundleQty: bundleItem?.quantity || 0,
      pieceQty: pieceItem?.quantity || 0,
    };
  };

  const handleDirectQuantityCommit = (
    product: Product,
    unit: UnitType,
    newQty: number,
    overridePrice?: number
  ) => {
    if (!isUnitConfigured(product, unit)) return;

    const tapKey = `${product.id}_${unit}`;
    setActiveTapAnimation(tapKey);
    setTimeout(() => setActiveTapAnimation(null), 260);

    if (onUpdateQuantity) {
      onUpdateQuantity(product.id, unit, newQty, overridePrice);
      return;
    }

    const existing = cart.find(i => i.productId === product.id && i.unit === unit);
    const delta = newQty - (existing?.quantity || 0);
    if (delta > 0) {
      onAddToCart(product, unit, delta, overridePrice);
    }
  };

  const getUnitCartQty = (productId: string, unit: UnitType): number => {
    return cart.find(i => i.productId === productId && i.unit === unit)?.quantity || 0;
  };

  const getUnitCartItem = (productId: string, unit: UnitType): CartItem | undefined => {
    return cart.find(i => i.productId === productId && i.unit === unit);
  };

  const openDirectQtyEditor = (product: Product) => {
    soundManager.playMechanicalClick();
    if (editingQtyProductId === product.id) {
      setEditingQtyProductId(null);
      return;
    }

    const hasBundle = hasConfiguredBundleTier(product);
    const hasPiece = hasConfiguredPieceTier(product) || !hasBundle;
    const bundleQty = getUnitCartQty(product.id, 'bundle');
    const pieceQty = getUnitCartQty(product.id, 'piece');

    let defaultUnit: UnitType;
    if (hasBundle && !hasPiece) {
      defaultUnit = 'bundle';
    } else if (!hasBundle && hasPiece) {
      defaultUnit = 'piece';
    } else if (bundleQty > 0 && pieceQty === 0) {
      defaultUnit = 'bundle';
    } else if (pieceQty > 0 && bundleQty === 0) {
      defaultUnit = 'piece';
    } else {
      defaultUnit = getPreferredUnit(product);
    }

    const existingItem = getUnitCartItem(product.id, defaultUnit);
    const currentQty = existingItem?.quantity || 0;
    const defaultPrice = getEffectiveUnitPrice(product, defaultUnit, activeCustomer).unitPrice;
    const initialPrice = existingItem ? existingItem.unitPrice : defaultPrice;

    setEditingQtyUnit(defaultUnit);
    setEditingQtyDraft(currentQty > 0 ? String(currentQty) : '1');
    setEditingPriceDraft(String(initialPrice));
    setEditingQtyProductId(product.id);
  };

  const handleSwitchEditUnit = (product: Product, nextUnit: UnitType) => {
    soundManager.playMechanicalClick();
    setEditingQtyUnit(nextUnit);
    const existingItem = getUnitCartItem(product.id, nextUnit);
    const currentQty = existingItem?.quantity || 0;
    const defaultPrice = getEffectiveUnitPrice(product, nextUnit, activeCustomer).unitPrice;
    const initialPrice = existingItem ? existingItem.unitPrice : defaultPrice;
    setEditingQtyDraft(currentQty > 0 ? String(currentQty) : '1');
    setEditingPriceDraft(String(initialPrice));
  };

  const commitDirectQtyEditor = (product: Product) => {
    const trimmed = editingQtyDraft.trim();
    if (trimmed === '') {
      setEditingQtyProductId(null);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setEditingQtyProductId(null);
      return;
    }

    const parsedPrice = Number(editingPriceDraft.trim());
    const defaultPrice = getEffectiveUnitPrice(product, editingQtyUnit, activeCustomer).unitPrice;
    const overridePrice =
      editingPriceDraft.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0
        ? Math.round(parsedPrice * 100) / 100
        : defaultPrice;

    const nextQty = Math.max(0, Math.floor(parsed));
    soundManager.playItemAdded();
    handleDirectQuantityCommit(product, editingQtyUnit, nextQty, overridePrice);
    setEditingQtyProductId(null);
  };

  // Shared Grid / Category / Favorite / Stock Alert Card Renderer
  const renderProductCard = (product: Product, showAlertDetails: boolean = false) => {
    const stockInfo = formatStockDisplay(
      product.stockPieces,
      product.bundlePieces,
      product.bundleUnitName
    );
    const isLowStock = product.stockPieces <= product.lowStockThreshold;
    const isOutOfStock = product.stockPieces <= 0;
    const deficitPcs = Math.max(0, product.lowStockThreshold - product.stockPieces);
    const cartInfo = getCartInfo(product.id);
    const hasBundleTier = hasConfiguredBundleTier(product);
    const hasPieceTier = hasConfiguredPieceTier(product) || !hasBundleTier;
    const configuredTierCount = (hasBundleTier ? 1 : 0) + (hasPieceTier ? 1 : 0);
    const bundleEff = getEffectiveUnitPrice(product, 'bundle', activeCustomer);
    const pieceEff = getEffectiveUnitPrice(product, 'piece', activeCustomer);
    const isFav = effectiveFavoriteIds.has(product.id);
    const showSecondaryRateLine =
      (hasBundleTier && (product.bundlePieces > 1 || bundleEff.isCustomRate)) ||
      (hasPieceTier && pieceEff.isCustomRate);

    return (
      <div
        key={product.id}
        className={`relative flex flex-col bg-slate-900 rounded-2xl border transition-all duration-150 overflow-hidden shadow-lg ${
          isOutOfStock
            ? 'border-rose-500/50 ring-1 ring-rose-500/20 bg-gradient-to-b from-slate-900 to-rose-950/15'
            : isLowStock
            ? 'border-amber-500/60 ring-1 ring-amber-500/40 bg-gradient-to-b from-slate-900 to-amber-950/20'
            : 'border-slate-800 hover:border-slate-700'
        }`}
      >
        {/* Header & Identifiers */}
        <div className="p-3 flex items-start gap-2.5 bg-slate-900/90">
          <div className="relative flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-slate-950 border border-slate-700/80 shadow-md flex items-center justify-center">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={e => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                className={`w-full h-full bg-gradient-to-br ${product.color} flex items-center justify-center text-xl`}
              >
                <span>{product.emoji}</span>
              </div>
            )}

            {cartInfo && (
              <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-black text-white shadow border border-slate-900">
                ✓
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <h4 className="font-bold text-white text-sm leading-snug line-clamp-2">
                {product.name}
              </h4>
              <button
                type="button"
                onClick={e => handleToggleFavoriteClick(product.id, e)}
                className={`p-1 -mt-0.5 -mr-1 rounded-lg flex-shrink-0 transition ${
                  isFav
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-slate-600 hover:text-slate-300'
                }`}
                title={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                aria-label={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
              >
                <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400' : ''}`} />
              </button>
            </div>

            {/* Clean unboxed metadata */}
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
              <span>{product.category}</span>
              {product.barcode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {product.barcode}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Live Stock, Alert Status & Dedicated Edit Quantity Trigger */}
        <div className="px-3 py-1.5 bg-slate-900/60 flex items-center justify-between text-xs border-t border-slate-800/80 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="min-w-0 truncate">
              <span className="text-[11px] text-slate-400 mr-1">Stock:</span>
              <span
                className={`font-bold tabular-nums ${
                  isOutOfStock
                    ? 'text-rose-400'
                    : isLowStock
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {product.stockPieces === 0 ? '0 Pcs (Depleted)' : stockInfo.text}
              </span>
            </div>

            {isLowStock && (
              <span className="text-[11px] font-semibold text-rose-300 flex items-center gap-1 flex-shrink-0">
                <AlertTriangle className="w-3 h-3 text-rose-400" />
                {product.stockPieces < 0 ? 'Negative' : 'Reorder'}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              openDirectQtyEditor(product);
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border flex-shrink-0 transition active:scale-95 ${
              editingQtyProductId === product.id
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80'
            }`}
            title="Enter specific quantity directly"
            aria-label={`Edit quantity for ${product.name}`}
          >
            <Pencil className="w-3 h-3" />
            <span>{editingQtyProductId === product.id ? 'Close' : 'Qty'}</span>
          </button>
        </div>

        {/* Extra Stock Alert Deficit Strip (in Stock Alert Grid) */}
        {showAlertDetails && (
          <div className="px-3 py-1.5 bg-rose-950/30 border-t border-rose-900/40 flex items-center justify-between text-[11px]">
            <span className="text-rose-300 tabular-nums">
              Threshold: {product.lowStockThreshold} pcs · Deficit: +{deficitPcs} pcs
            </span>
            {onOrderPurchaseOrder && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOrderPurchaseOrder(product.id);
                }}
                className="font-bold text-blue-300 hover:text-blue-200 flex items-center gap-1 whitespace-nowrap"
              >
                <Truck className="w-3 h-3" />
                <span>Order PO</span>
              </button>
            )}
          </div>
        )}

        {/* In Cart Status Strip */}
        {cartInfo && (
          <div className="px-3 py-1 bg-emerald-950/40 border-t border-emerald-800/40 text-[11px] font-semibold text-emerald-300 flex items-center justify-between tabular-nums">
            <span className="flex items-center gap-1 truncate">
              <ShoppingBag className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="truncate">In Cart: {cartInfo.text}</span>
            </span>
            <span className="font-bold text-white flex-shrink-0">{formatCurrency(cartInfo.totalAmount)}</span>
          </div>
        )}

        {/* Unified Unit Pricing & Purchase Action Buttons (or Inline Bill Item Quantity & Price Override) */}
        <div className="p-2.5 bg-slate-950/80 border-t border-slate-800/80 mt-auto">
          {editingQtyProductId === product.id ? (
            (() => {
              const unitEff = editingQtyUnit === 'bundle' ? bundleEff : pieceEff;
              const tierDefaultPrice = unitEff.tierDefaultPrice;
              const parsedDraftPrice = Number(editingPriceDraft);
              const isCustomBillPrice =
                editingPriceDraft.trim() !== '' &&
                Number.isFinite(parsedDraftPrice) &&
                Math.abs(parsedDraftPrice - tierDefaultPrice) > 0.001;

              return (
                <div className="space-y-2 bg-slate-900 border border-blue-500/60 rounded-xl p-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                      Bill Item
                    </span>
                    {hasBundleTier && hasPieceTier ? (
                      <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px] min-w-0">
                        <button
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => handleSwitchEditUnit(product, 'bundle')}
                          className={`px-2 py-0.5 rounded-md font-semibold truncate transition ${
                            editingQtyUnit === 'bundle'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {product.bundleUnitName}
                        </button>
                        <button
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => handleSwitchEditUnit(product, 'piece')}
                          className={`px-2 py-0.5 rounded-md font-semibold truncate transition ${
                            editingQtyUnit === 'piece'
                              ? 'bg-amber-700 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Piece
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-300 truncate">
                        {editingQtyUnit === 'bundle' ? product.bundleUnitName : 'Single Piece'}
                      </span>
                    )}
                  </div>

                  {/* On-the-fly Price Override Field (Saves to Customer Profile when customer is selected) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <label className="text-[11px] text-slate-400 font-medium whitespace-nowrap">
                        Sell Rate:
                      </label>
                      <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                        <div className="relative flex-1 max-w-[110px]">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                            ₹
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editingPriceDraft}
                            onChange={e => setEditingPriceDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDirectQtyEditor(product);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingQtyProductId(null);
                              }
                            }}
                            aria-label={`Sell price override for ${product.name}`}
                            className={`w-full pl-5 pr-2 py-1 rounded-lg bg-slate-950 border text-xs font-bold text-right tabular-nums focus:outline-none focus:ring-1 ${
                              isCustomBillPrice
                                ? 'border-amber-500/70 text-amber-300 focus:border-amber-400 focus:ring-amber-400'
                                : 'border-slate-700 text-white focus:border-blue-500 focus:ring-blue-500'
                            } [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                        </div>
                        {isCustomBillPrice && (
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              setEditingPriceDraft(String(tierDefaultPrice));
                            }}
                            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex-shrink-0"
                            title={`Reset to default (${formatCurrency(tierDefaultPrice)})`}
                            aria-label="Reset sell price to default"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
                      <span className="truncate">
                        {activeCustomer
                          ? `Saves to ${activeCustomer.name}`
                          : 'Walk-in · select customer to save'}
                      </span>
                      {isCustomBillPrice && (
                        <span className="text-slate-500 line-through flex-shrink-0 ml-1">
                          {formatCurrency(tierDefaultPrice)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Direct Quantity Input + Actions */}
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={qtyInputRef}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={editingQtyDraft}
                      onChange={e => setEditingQtyDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitDirectQtyEditor(product);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingQtyProductId(null);
                        }
                      }}
                      aria-label={`Direct quantity for ${product.name}`}
                      className="w-full min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-black text-white text-center tabular-nums focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />

                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => commitDirectQtyEditor(product)}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 flex-shrink-0 transition active:scale-95"
                      aria-label={`Apply quantity and price for ${product.name}`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Set</span>
                    </button>

                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setEditingQtyProductId(null)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex-shrink-0 transition"
                      aria-label="Cancel quantity entry"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className={`grid ${configuredTierCount > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
              {hasBundleTier && (
                <button
                  type="button"
                  onClick={e => handleItemTap(product, 'bundle', e)}
                  className={`relative flex flex-col justify-between py-2 px-2.5 rounded-xl text-left transition active:scale-95 border ${
                    activeTapAnimation === `${product.id}_bundle`
                      ? 'bg-blue-500 text-white scale-95 border-blue-400'
                      : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-white/95 leading-tight w-full">
                    <span className="flex items-center gap-0.5 min-w-0 truncate">
                      <Plus className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{product.bundleUnitName}</span>
                    </span>
                    <span className="flex-shrink-0 text-[10px] font-semibold text-blue-100 tabular-nums">
                      {product.bundlePieces} {product.bundlePieces === 1 ? 'pc' : 'pcs'}
                    </span>
                  </div>

                  <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                    <span className="text-sm font-black text-white leading-none">
                      {formatCurrency(bundleEff.unitPrice)}
                    </span>
                    {bundleEff.isCustomRate && bundleEff.standardPrice !== bundleEff.unitPrice && (
                      <span className="text-[10px] text-blue-100/75 line-through leading-none">
                        {formatCurrency(bundleEff.standardPrice)}
                      </span>
                    )}
                  </div>

                  {showSecondaryRateLine && (
                    <div className="mt-1 text-[10px] text-blue-50/90 truncate tabular-nums leading-tight">
                      {product.bundlePieces > 1
                        ? `₹${(bundleEff.unitPrice / Math.max(1, product.bundlePieces)).toFixed(1)}/pc`
                        : 'Per unit'}
                      {bundleEff.isCustomRate ? ` · ${bundleEff.rateSource}` : ''}
                    </div>
                  )}
                </button>
              )}

              {hasPieceTier && (
                <button
                  type="button"
                  onClick={e => handleItemTap(product, 'piece', e)}
                  className={`relative flex flex-col justify-between py-2 px-2.5 rounded-xl text-left transition active:scale-95 border ${
                    activeTapAnimation === `${product.id}_piece`
                      ? 'bg-amber-600 text-white scale-95 border-amber-400'
                      : 'bg-amber-700 hover:bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-white/95 leading-tight w-full">
                    <span className="flex items-center gap-0.5 min-w-0 truncate">
                      <Plus className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">Piece</span>
                    </span>
                    <span className="flex-shrink-0 text-[10px] font-semibold text-amber-100 tabular-nums">
                      1 pc
                    </span>
                  </div>

                  <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                    <span className="text-sm font-black text-white leading-none">
                      {formatCurrency(pieceEff.unitPrice)}
                    </span>
                    {pieceEff.isCustomRate && pieceEff.standardPrice !== pieceEff.unitPrice && (
                      <span className="text-[10px] text-amber-100/75 line-through leading-none">
                        {formatCurrency(pieceEff.standardPrice)}
                      </span>
                    )}
                  </div>

                  {showSecondaryRateLine && (
                    <div className="mt-1 text-[10px] text-amber-50/90 truncate tabular-nums leading-tight">
                      {pieceEff.isCustomRate ? pieceEff.rateSource : 'Per unit'}
                    </div>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Sticky Search, Customer Pricing Bar, Catalog Display Mode Switcher & Category Filter */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 space-y-2.5 flex-shrink-0">
        {/* Walk-in Customer Rate Tier Selector + Product Search Bar */}
        {displayMode !== 'barcode_scanner' && (
          <div className="flex flex-col gap-2">
            {showCustomerSelector && onSelectCustomer && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setIsCustomerModalOpen(true);
                }}
                aria-label="Billing Customer and Rate Tier"
                className="w-full flex items-center justify-between gap-2 bg-slate-950 hover:bg-slate-900 border border-slate-700/80 hover:border-blue-500/60 rounded-xl px-3 py-2 text-left transition"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <UserCheck className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {activeCustomer
                      ? activeCustomer.name
                      : 'Walk-in Customer (Standard Rate)'}
                  </span>
                </div>
                {activeCustomer ? (
                  <div className="flex items-center gap-2 pl-2 border-l border-slate-800 text-[10px] whitespace-nowrap tabular-nums">
                    <span className="font-bold text-emerald-300 flex items-center gap-0.5">
                      <Tag className="w-3 h-3" />
                      {getCustomerPricingLabel(activeCustomer)}
                    </span>
                    <span
                      className={`font-bold flex items-center gap-0.5 ${getLoyaltyTierBadgeColor(
                        getLoyaltyTierForPoints(activeCustomer.lifetimeLoyaltyPoints).id
                      )}`}
                    >
                      <Award className="w-3 h-3" />
                      {activeCustomer.loyaltyPoints || 0} pts
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  </div>
                ) : (
                  <span className="text-[11px] font-semibold text-blue-400 flex items-center gap-1 flex-shrink-0">
                    <span>Search</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                )}
              </button>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  data-barcode-input="global"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={
                    displayMode === 'compact_search'
                      ? 'Scan barcode or type name — press Enter to add immediately...'
                      : 'Search products or scan barcode (e.g. 5*8901234001) + Enter...'
                  }
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setIsCameraBarcodeOpen(true);
                }}
                className="px-3 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-blue-500/40 text-blue-300 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition active:scale-95"
                title="Open Camera / Rapid Barcode Scanner"
                aria-label="Scan product barcode"
              >
                <ScanBarcode className="w-4 h-4" />
                {!isMobileLayout && <span>Scan</span>}
              </button>

              {onOpenAudioTranscribe && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    onOpenAudioTranscribe();
                  }}
                  className="px-3 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-sky-500/40 text-sky-300 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition active:scale-95"
                  title="Record voice or upload audio to create item list"
                  aria-label="Transcribe audio item list"
                >
                  <Mic className="w-4 h-4" />
                  {!isMobileLayout && <span>Voice</span>}
                </button>
              )}
            </div>

            {scanNotice && (
              <div
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                  scanNotice.ok
                    ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                    : 'bg-rose-950/50 border-rose-700/50 text-rose-300'
                }`}
              >
                <span className="truncate">{scanNotice.message}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {scanNotice.ok && cart.length > 0 && onExpressCashCheckout && (
                    <button
                      type="button"
                      onClick={() => onExpressCashCheckout()}
                      className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                    >
                      <Zap className="w-3 h-3" />
                      <span>Cash Pay</span>
                    </button>
                  )}
                  {scanNotice.ok && cart.length > 0 && onOpenCart && (
                    <button
                      type="button"
                      onClick={() => onOpenCart()}
                      className="px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold whitespace-nowrap"
                    >
                      Checkout
                    </button>
                  )}
                  {!scanNotice.ok && scanNotice.unknownCode && onCreateProductWithBarcode && (
                    <button
                      type="button"
                      onClick={() => {
                        const code = scanNotice.unknownCode!;
                        setScanNotice(null);
                        onCreateProductWithBarcode(code);
                      }}
                      className="px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                    >
                      <PlusCircle className="w-3 h-3" />
                      <span>Create SKU</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScanNotice(null)}
                    className="p-0.5 text-slate-400 hover:text-white"
                    aria-label="Dismiss scan message"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Catalog Display Bar + Add Item CTA */}
        {showCatalogDisplayBar && (
          <div className="flex items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Catalog display mode"
              className="flex items-center gap-1 overflow-x-auto scrollbar-none bg-slate-950 p-1 rounded-xl border border-slate-800 flex-1"
            >
              {DISPLAY_MODES.map(mode => {
                const isActive = displayMode === mode.id;
                const badgeCount =
                  mode.id === 'favorites'
                    ? favoritesCount
                    : mode.id === 'stock_alert'
                    ? stockAlertMetrics.total
                    : null;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={mode.title}
                    onClick={() => handleChangeDisplayMode(mode.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                      isActive
                        ? mode.id === 'stock_alert'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : mode.id === 'favorites'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`}
                  >
                    {renderModeIcon(mode.id)}
                    <span>{mode.label}</span>
                    {badgeCount !== null && (
                      <span
                        className={`text-[10px] font-bold tabular-nums ${
                          isActive
                            ? 'text-white/90'
                            : mode.id === 'stock_alert' && badgeCount > 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        ({badgeCount})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onOpenNewProductModal}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-500/30 whitespace-nowrap shrink-0 text-xs font-semibold transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Item</span>
            </button>
          </div>
        )}

        {/* Category Filter Tabs */}
        {showCategoryTabs &&
          (displayMode === 'grid' ||
            displayMode === 'compact_grid' ||
            displayMode === 'list' ||
            displayMode === 'category_tabbed') && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
              {categories.map(cat => {
                const stats = cat === 'All' ? null : categoryStats.get(cat);
                const isSelected =
                  selectedCategory === cat && !(showLowStockBanner && filterLowStockOnly);

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat);
                      setFilterLowStockOnly(false);
                      soundManager.playMechanicalClick();
                    }}
                    className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap shrink-0 transition active:scale-95 border ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white border-slate-700/60'
                    }`}
                  >
                    <span>{cat}</span>
                    {displayMode === 'category_tabbed' && (
                      <span className="ml-1.5 text-[10px] opacity-80 tabular-nums">
                        ({cat === 'All' ? products.length : stats?.count || 0})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

        {/* Compact Search Controls Bar */}
        {displayMode === 'compact_search' && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-semibold">Enter-Key Quick Unit:</span>
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                {(
                  [
                    { id: 'auto', label: 'Preferred' },
                    { id: 'bundle', label: 'Bulk Unit' },
                    { id: 'piece', label: 'Single Piece' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setCompactQuickUnit(opt.id);
                    }}
                    className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap transition ${
                      compactQuickUnit === opt.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {compactFeedback && (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {compactFeedback}
                </span>
              )}
              <span className="text-slate-400 tabular-nums">
                Showing {filteredProducts.length} of {products.length} SKUs
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area by Selected Display Mode */}
      <div className={`flex-1 overflow-y-auto ${isMobileLayout ? 'p-3' : 'p-4'} pb-24`}>
        {displayMode === 'barcode_scanner' ? (
          <BarcodeScannerView
            products={products}
            cart={cart}
            activeCustomer={activeCustomer}
            onAddToCart={onAddToCart}
            favoriteIds={effectiveFavoriteIds}
            onToggleFavorite={id => handleToggleFavoriteClick(id)}
            onOpenCart={onOpenCart}
            onExpressCashCheckout={onExpressCashCheckout}
            onCreateProductWithBarcode={onCreateProductWithBarcode}
          />
        ) : displayMode === 'stock_alert' ? (
          /* ================= STOCK ALERT GRID ================= */
          <div className="space-y-4">
            <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'} gap-2.5`}>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400 font-medium">Negative Stock</div>
                <div className="text-lg font-black text-rose-400 tabular-nums mt-0.5">
                  {stockAlertMetrics.negative}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400 font-medium">Depleted (0 pcs)</div>
                <div className="text-lg font-black text-orange-400 tabular-nums mt-0.5">
                  {stockAlertMetrics.depleted}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400 font-medium">Below Threshold</div>
                <div className="text-lg font-black text-amber-300 tabular-nums mt-0.5">
                  {stockAlertMetrics.low}
                </div>
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                <p className="font-semibold text-white">All catalog items are above reorder threshold</p>
                <p className="text-xs text-slate-400 mt-1">
                  Switch back to Grid or List View to browse all available products.
                </p>
              </div>
            ) : (
              <div className={`grid ${standardGridColsClass} gap-3.5`}>
                {filteredProducts.map(product => renderProductCard(product, true))}
              </div>
            )}
          </div>
        ) : displayMode === 'favorites' && filteredProducts.length === 0 ? (
          /* ================= EMPTY FAVORITES STATE ================= */
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
            <Star className="w-10 h-10 text-amber-400/70 mb-2 stroke-[1.5]" />
            <p className="font-semibold text-slate-200">
              {searchQuery ? 'No favorite items match your search' : 'No favorite items pinned yet'}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Tap the star icon on any product in Grid or List view to pin fast-moving SKUs here.
            </p>
            {!searchQuery && products.length > 0 && (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePinDefaultFavorites}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition"
                >
                  Pin Top 4 Items
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeDisplayMode('grid')}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                >
                  Browse Grid View
                </button>
              </div>
            )}
          </div>
        ) : filteredProducts.length === 0 ? (
          /* ================= GENERIC EMPTY SEARCH/FILTER STATE ================= */
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
            <Package className="w-12 h-12 text-slate-600 mb-2 stroke-[1.5]" />
            <p className="font-semibold text-slate-300">No products found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              {searchQuery
                ? `No matching items for "${searchQuery}"`
                : 'Try selecting another category or adding a new product'}
            </p>
            {filterLowStockOnly && (
              <button
                type="button"
                onClick={() => setFilterLowStockOnly(false)}
                className="mt-3 px-3 py-1.5 bg-slate-800 text-xs text-blue-400 rounded-lg border border-slate-700"
              >
                Clear Low Stock Filter
              </button>
            )}
          </div>
        ) : displayMode === 'list' ? (
          /* ================= HIGH-DENSITY LIST VIEW ================= */
          <div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800/80 overflow-hidden">
            {filteredProducts.map(product => {
              const stockInfo = formatStockDisplay(
                product.stockPieces,
                product.bundlePieces,
                product.bundleUnitName
              );
              const isLowStock = product.stockPieces <= product.lowStockThreshold;
              const isOutOfStock = product.stockPieces <= 0;
              const cartInfo = getCartInfo(product.id);
              const hasBundleTier = hasConfiguredBundleTier(product);
              const hasPieceTier = hasConfiguredPieceTier(product) || !hasBundleTier;
              const bundleEff = getEffectiveUnitPrice(product, 'bundle', activeCustomer);
              const pieceEff = getEffectiveUnitPrice(product, 'piece', activeCustomer);
              const isFav = effectiveFavoriteIds.has(product.id);

              return (
                <div
                  key={product.id}
                  className={`px-3.5 py-2.5 flex ${
                    isDesktopLayout
                      ? 'flex-row items-center justify-between'
                      : 'flex-col justify-between'
                  } gap-2.5 hover:bg-slate-800/40 transition`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={e => handleToggleFavoriteClick(product.id, e)}
                      className={`p-1 rounded-lg flex-shrink-0 transition ${
                        isFav
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-slate-600 hover:text-slate-300'
                      }`}
                      title={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400' : ''}`} />
                    </button>

                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center flex-shrink-0">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-lg">{product.emoji}</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-white truncate">
                          {product.name}
                        </h4>
                        {cartInfo && (
                          <span className="text-[11px] font-bold text-emerald-400 tabular-nums">
                            · In Cart: {cartInfo.text}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span>{product.category}</span>
                        {product.barcode && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{product.barcode}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {hasBundleTier
                            ? `1 ${product.bundleUnitName} = ${product.bundlePieces} pcs`
                            : 'Single Piece'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stock & Quick Add Buttons */}
                  <div
                    className={`flex items-center ${
                      isDesktopLayout
                        ? 'justify-end pl-0'
                        : 'justify-between pl-9'
                    } gap-3`}
                  >
                    <div className={`${isDesktopLayout ? 'text-right' : 'text-left'} min-w-[115px]`}>
                      <div
                        className={`text-xs font-bold tabular-nums ${
                          isOutOfStock
                            ? 'text-rose-400'
                            : isLowStock
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                        }`}
                      >
                        {product.stockPieces === 0 ? '0 Pcs (Depleted)' : stockInfo.text}
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        Alert ≤ {product.lowStockThreshold} pcs
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {hasBundleTier && (
                        <button
                          type="button"
                          onClick={e => handleItemTap(product, 'bundle', e)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 whitespace-nowrap tabular-nums border transition active:scale-95 ${
                            activeTapAnimation === `${product.id}_bundle`
                              ? 'bg-blue-500 text-white border-blue-400'
                              : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>
                            {product.bundleUnitName} {formatCurrency(bundleEff.unitPrice)}
                          </span>
                        </button>
                      )}
                      {hasPieceTier && (
                        <button
                          type="button"
                          onClick={e => handleItemTap(product, 'piece', e)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 whitespace-nowrap tabular-nums border transition active:scale-95 ${
                            activeTapAnimation === `${product.id}_piece`
                              ? 'bg-amber-500 text-white border-amber-400'
                              : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500'
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Pc {formatCurrency(pieceEff.unitPrice)}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : displayMode === 'compact_search' ? (
          /* ================= COMPACT SEARCH VIEW ================= */
          <div className={`grid ${compactSearchGridColsClass} gap-2.5`}>
            {filteredProducts.map((product, idx) => {
              const hasBundleTier = hasConfiguredBundleTier(product);
              const hasPieceTier = hasConfiguredPieceTier(product) || !hasBundleTier;
              const bundleEff = getEffectiveUnitPrice(product, 'bundle', activeCustomer);
              const pieceEff = getEffectiveUnitPrice(product, 'piece', activeCustomer);
              const cartInfo = getCartInfo(product.id);
              const isOutOfStock = product.stockPieces <= 0;
              const isLowStock = product.stockPieces <= product.lowStockThreshold;
              const isFav = effectiveFavoriteIds.has(product.id);

              return (
                <div
                  key={product.id}
                  className={`p-3 rounded-xl bg-slate-900 border transition flex flex-col justify-between gap-2 ${
                    idx === 0 && searchQuery.trim()
                      ? 'border-blue-500/70 ring-1 ring-blue-500/30'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg flex-shrink-0">{product.emoji}</span>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs sm:text-sm text-white truncate">
                          {product.name}
                        </h4>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap tabular-nums">
                          {product.barcode && (
                            <span className="font-mono">{product.barcode}</span>
                          )}
                          {product.barcode && <span aria-hidden="true">·</span>}
                          <span
                            className={
                              isOutOfStock
                                ? 'text-rose-400 font-semibold'
                                : isLowStock
                                ? 'text-amber-300 font-semibold'
                                : 'text-emerald-400 font-semibold'
                            }
                          >
                            {product.stockPieces} pcs
                          </span>
                          {cartInfo && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-300 font-semibold">
                                In cart: {cartInfo.text}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={e => handleToggleFavoriteClick(product.id, e)}
                      className={`p-1 rounded transition ${
                        isFav ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
                      }`}
                      title={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                    >
                      <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400' : ''}`} />
                    </button>
                  </div>

                  <div className={`grid ${hasBundleTier && hasPieceTier ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5`}>
                    {hasBundleTier && (
                      <button
                        type="button"
                        onClick={e => handleItemTap(product, 'bundle', e)}
                        className="py-1.5 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-between gap-1 tabular-nums transition active:scale-95"
                      >
                        <span className="flex items-center gap-1 truncate">
                          <Plus className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{product.bundleUnitName}</span>
                        </span>
                        <span>{formatCurrency(bundleEff.unitPrice)}</span>
                      </button>
                    )}
                    {hasPieceTier && (
                      <button
                        type="button"
                        onClick={e => handleItemTap(product, 'piece', e)}
                        className="py-1.5 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center justify-between gap-1 tabular-nums transition active:scale-95"
                      >
                        <span className="flex items-center gap-1">
                          <Plus className="w-3 h-3 flex-shrink-0" />
                          <span>Piece</span>
                        </span>
                        <span>{formatCurrency(pieceEff.unitPrice)}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : displayMode === 'category_tabbed' && effectiveSelectedCategory === 'All' ? (
          /* ================= CATEGORY TABBED VIEW (ALL GROUPED) ================= */
          <div className="space-y-6">
            {groupedCategories.map(([catName, items]) => (
              <section key={catName} className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-bold text-white">{catName}</h3>
                    <span className="text-xs text-slate-400 tabular-nums">
                      · {items.length} {items.length === 1 ? 'SKU' : 'SKUs'}
                    </span>
                  </div>
                  {showCategoryTabs && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setSelectedCategory(catName);
                      }}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300"
                    >
                      Focus Category
                    </button>
                  )}
                </div>

                <div className={`grid ${standardGridColsClass} gap-3.5`}>
                  {items.map(product => renderProductCard(product, false))}
                </div>
              </section>
            ))}
          </div>
        ) : displayMode === 'compact_grid' ? (
          /* ================= COMPACT GRID VIEW (HIGH DENSITY) ================= */
          <div className={`grid ${compactGridColsClass} gap-2`}>
            {filteredProducts.map(product => {
              const hasBundleTier = hasConfiguredBundleTier(product);
              const hasPieceTier = hasConfiguredPieceTier(product) || !hasBundleTier;
              const configuredTierCount = (hasBundleTier ? 1 : 0) + (hasPieceTier ? 1 : 0);
              const bundleEff = getEffectiveUnitPrice(product, 'bundle', activeCustomer);
              const pieceEff = getEffectiveUnitPrice(product, 'piece', activeCustomer);
              const cartInfo = getCartInfo(product.id);
              const isOutOfStock = product.stockPieces <= 0;
              const isLowStock = product.stockPieces <= product.lowStockThreshold;
              const isFav = effectiveFavoriteIds.has(product.id);

              return (
                <div
                  key={product.id}
                  className={`flex flex-col justify-between p-2 rounded-xl bg-slate-900 border transition gap-1.5 ${
                    cartInfo
                      ? 'border-emerald-500/60 bg-emerald-950/10'
                      : isOutOfStock
                      ? 'border-rose-500/45'
                      : isLowStock
                      ? 'border-amber-500/45'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Tight Header */}
                  <div className="flex items-start gap-1.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center flex-shrink-0">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm leading-none">{product.emoji}</span>
                      )}
                    </div>
                    <h4
                      className="font-bold text-[11px] leading-tight text-white line-clamp-2 flex-1 min-w-0"
                      title={product.name}
                    >
                      {product.name}
                    </h4>
                    <button
                      type="button"
                      onClick={e => handleToggleFavoriteClick(product.id, e)}
                      className={`p-0.5 rounded flex-shrink-0 transition ${
                        isFav ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
                      }`}
                      title={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                      aria-label={isFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                    >
                      <Star className={`w-3 h-3 ${isFav ? 'fill-amber-400' : ''}`} />
                    </button>
                  </div>

                  {/* Single-line Stock + Cart Count */}
                  <div className="flex items-center justify-between gap-1 text-[10px] leading-none tabular-nums">
                    <span
                      className={`font-semibold truncate ${
                        isOutOfStock
                          ? 'text-rose-400'
                          : isLowStock
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                      }`}
                    >
                      {product.stockPieces} pcs
                    </span>
                    {cartInfo ? (
                      <span className="font-bold text-emerald-300 truncate">
                        {cartInfo.totalPieces} in cart
                      </span>
                    ) : (
                      <span className="text-slate-500 truncate">
                        {hasBundleTier ? `${product.bundlePieces}p/${product.bundleUnitName}` : '1 pc'}
                      </span>
                    )}
                  </div>

                  {/* Compact Configured Unit Tap Buttons */}
                  <div className={`grid ${configuredTierCount > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-1 mt-auto`}>
                    {hasBundleTier && (
                      <button
                        type="button"
                        onClick={e => handleItemTap(product, 'bundle', e)}
                        className={`py-1 px-1.5 rounded-lg text-center transition active:scale-95 border tabular-nums ${
                          activeTapAnimation === `${product.id}_bundle`
                            ? 'bg-blue-500 text-white border-blue-400'
                            : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
                        }`}
                        title={`Add 1 ${product.bundleUnitName} (${product.bundlePieces} pcs)`}
                      >
                        <div className="text-[9px] font-bold uppercase text-blue-100 truncate leading-tight">
                          +{product.bundleUnitName}
                        </div>
                        <div className="text-[11px] font-black text-white leading-tight">
                          {formatCurrency(bundleEff.unitPrice)}
                        </div>
                      </button>
                    )}

                    {hasPieceTier && (
                      <button
                        type="button"
                        onClick={e => handleItemTap(product, 'piece', e)}
                        className={`py-1 px-1.5 rounded-lg text-center transition active:scale-95 border tabular-nums ${
                          activeTapAnimation === `${product.id}_piece`
                            ? 'bg-amber-500 text-white border-amber-400'
                            : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500'
                        }`}
                        title="Add 1 Single Piece"
                      >
                        <div className="text-[9px] font-bold uppercase text-amber-100 truncate leading-tight">
                          +Piece
                        </div>
                        <div className="text-[11px] font-black text-white leading-tight">
                          {formatCurrency(pieceEff.unitPrice)}
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ================= GRID / SINGLE-CATEGORY / FAVORITES GRID ================= */
          <div className={`grid ${standardGridColsClass} gap-3.5`}>
            {filteredProducts.map(product => renderProductCard(product, false))}
          </div>
        )}
      </div>

      {/* Customer Selection & Search Modal */}
      {onSelectCustomer && showCustomerSelector && (
        <CustomerSelectorModal
          isOpen={isCustomerModalOpen}
          onClose={() => setIsCustomerModalOpen(false)}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={onSelectCustomer}
          onQuickCreateCustomer={onAddNewCustomer}
        />
      )}

      {/* Continuous Camera / Quick Barcode Modal from POS Search Bar */}
      <CameraBarcodeModal
        isOpen={isCameraBarcodeOpen}
        onClose={() => setIsCameraBarcodeOpen(false)}
        title="Scan Barcodes to Bill"
        subtitle="Scan continuously — each matched product is added immediately to the cart"
        mode="continuous"
        unitPref={compactQuickUnit}
        onChangeUnitPref={nextUnit => {
          setCompactQuickUnit(nextUnit);
          const prefs = getStoredBarcodePrefs();
          saveBarcodePrefs({ ...prefs, defaultUnit: nextUnit });
        }}
        products={products}
        cartCount={cart.reduce((sum, i) => sum + i.quantity, 0)}
        cartTotal={cart.reduce((sum, i) => sum + i.itemTotal, 0)}
        onScanCode={code => handleScanCodeResult(code, false)}
        onProceedToCheckout={onOpenCart}
      />
    </div>
  );
};
