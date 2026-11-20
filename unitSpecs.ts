import { Product, UnitType } from '../types';

type UnitSpecProduct = Pick<
  Product,
  'bundleUnitName' | 'bundlePieces' | 'bundlePrice' | 'piecePrice'
>;

/**
 * Returns true if the SKU has a valid Bulk/Bundle pricing tier configured.
 * A bundle tier requires a unit name, positive bundle price, and either >1 pieces per bundle
 * or no single-piece tier configured (pure bulk pack).
 */
export function hasConfiguredBundleTier(product: UnitSpecProduct): boolean {
  const hasName = Boolean(product.bundleUnitName?.trim());
  const hasPrice = Number(product.bundlePrice) > 0;
  const hasMultiPcs = Number(product.bundlePieces) > 1;
  const piecePrice = Number(product.piecePrice);
  return hasName && hasPrice && (hasMultiPcs || piecePrice <= 0);
}

/**
 * Returns true if the SKU has a valid Single Piece pricing tier configured.
 */
export function hasConfiguredPieceTier(product: Pick<Product, 'piecePrice'>): boolean {
  return Number(product.piecePrice) > 0;
}

/**
 * Returns the ordered list of configured selling unit types for a SKU.
 * Never returns an empty list; defaults to ['piece'] only if both prices are <= 0.
 */
export function getConfiguredUnits(product: UnitSpecProduct): UnitType[] {
  const units: UnitType[] = [];
  if (hasConfiguredBundleTier(product)) {
    units.push('bundle');
  }
  if (hasConfiguredPieceTier(product)) {
    units.push('piece');
  }
  return units.length > 0 ? units : ['piece'];
}

/**
 * Returns whether a specific unit tier is configured and available for a SKU.
 */
export function isUnitConfigured(product: UnitSpecProduct, unit: UnitType): boolean {
  const units = getConfiguredUnits(product);
  return units.includes(unit);
}

/**
 * Returns the primary configured unit for a SKU (prefers bundle if configured, otherwise piece).
 */
export function getPreferredUnit(product: UnitSpecProduct): UnitType {
  return getConfiguredUnits(product)[0];
}
