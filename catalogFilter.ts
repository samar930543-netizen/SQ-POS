import { Product, PosDisplayMode } from '../types';

export const DISPLAY_MODES: Array<{
  id: PosDisplayMode;
  label: string;
  title: string;
}> = [
  { id: 'grid', label: 'Grid View', title: 'Standard multi-unit catalog cards' },
  { id: 'compact_grid', label: 'Compact Grid', title: 'Smaller cards, tight spacing & maximum density' },
  { id: 'list', label: 'List View', title: 'High-density ledger rows with quick add' },
  { id: 'category_tabbed', label: 'Category View', title: 'Browse grouped by product category tabs' },
  { id: 'compact_search', label: 'Compact Search', title: 'Fast keyboard search & instant Enter-to-add' },
  { id: 'barcode_scanner', label: 'Barcode Scan', title: 'USB/camera barcode scanner & SKU codes' },
  { id: 'favorites', label: 'Favorites', title: 'Starred fast-moving & pinned items' },
  { id: 'stock_alert', label: 'Stock Alerts', title: 'Negative, depleted & low-stock items' },
];

export interface StockAlertMetrics {
  negative: number;
  depleted: number;
  low: number;
  total: number;
}

export function computeStockAlertMetrics(products: Product[]): StockAlertMetrics {
  let negative = 0;
  let depleted = 0;
  let low = 0;
  for (const p of products) {
    if (p.stockPieces < 0) negative += 1;
    else if (p.stockPieces === 0) depleted += 1;
    else if (p.stockPieces <= p.lowStockThreshold) low += 1;
  }
  return {
    negative,
    depleted,
    low,
    total: negative + depleted + low,
  };
}

export function computeCategories(products: Product[]): string[] {
  const set = new Set<string>();
  for (const p of products) set.add(p.category);
  return ['All', ...Array.from(set)];
}

export function computeCategoryStats(
  products: Product[]
): Map<string, { count: number; lowCount: number }> {
  const map = new Map<string, { count: number; lowCount: number }>();
  for (const p of products) {
    const curr = map.get(p.category) || { count: 0, lowCount: 0 };
    curr.count += 1;
    if (p.stockPieces <= p.lowStockThreshold) curr.lowCount += 1;
    map.set(p.category, curr);
  }
  return map;
}

export interface FilterCatalogOptions {
  products: Product[];
  displayMode: PosDisplayMode;
  favoriteIds: Set<string>;
  showLowStockBanner: boolean;
  filterLowStockOnly: boolean;
  effectiveSelectedCategory: string;
  searchQuery: string;
}

export function filterCatalogProducts({
  products,
  displayMode,
  favoriteIds,
  showLowStockBanner,
  filterLowStockOnly,
  effectiveSelectedCategory,
  searchQuery,
}: FilterCatalogOptions): Product[] {
  const base = products.filter(p => {
    if (displayMode === 'favorites' && !favoriteIds.has(p.id)) {
      return false;
    }
    if (displayMode === 'stock_alert' && p.stockPieces > p.lowStockThreshold) {
      return false;
    }
    if (
      showLowStockBanner &&
      displayMode !== 'stock_alert' &&
      filterLowStockOnly &&
      p.stockPieces > p.lowStockThreshold
    ) {
      return false;
    }
    if (
      effectiveSelectedCategory !== 'All' &&
      displayMode !== 'favorites' &&
      displayMode !== 'stock_alert' &&
      p.category !== effectiveSelectedCategory
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      const matchPieceBarcode = p.pieceBarcode?.toLowerCase().includes(q);
      const matchCategory = p.category.toLowerCase().includes(q);
      return matchName || matchBarcode || matchPieceBarcode || matchCategory;
    }
    return true;
  });

  if (displayMode === 'stock_alert') {
    return [...base].sort((a, b) => a.stockPieces - b.stockPieces);
  }
  return base;
}
