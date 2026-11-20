import { Product, UnitType } from '../types';
import { getPreferredUnit, isUnitConfigured } from './unitSpecs';

export interface ParsedBarcodeInput {
  code: string;
  multiplier: number;
}

export interface BarcodeMatchResult {
  product: Product;
  detectedUnit?: UnitType;
  matchedField: 'barcode' | 'pieceBarcode' | 'search';
}

export interface BarcodeScannerPreferences {
  hardwareWedgeEnabled: boolean;
  defaultUnit: 'auto' | UnitType;
  continuousCameraScan: boolean;
  expressCashConfirm: boolean;
}

const BARCODE_PREFS_KEY = 'sq_pos_barcode_prefs_v1';

export const DEFAULT_BARCODE_PREFS: BarcodeScannerPreferences = {
  hardwareWedgeEnabled: true,
  defaultUnit: 'auto',
  continuousCameraScan: true,
  expressCashConfirm: true,
};

export function getStoredBarcodePrefs(): BarcodeScannerPreferences {
  try {
    const raw = localStorage.getItem(BARCODE_PREFS_KEY);
    if (!raw) return DEFAULT_BARCODE_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_BARCODE_PREFS,
      ...parsed,
    };
  } catch {
    return DEFAULT_BARCODE_PREFS;
  }
}

export function saveBarcodePrefs(prefs: BarcodeScannerPreferences): void {
  try {
    localStorage.setItem(BARCODE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

/**
 * Supports standard barcodes ("8901234001") and fast quantity multiplier syntax
 * ("5*8901234001" or "8901234001*5" or "5x8901234001").
 */
export function parseBarcodeScanInput(raw: string): ParsedBarcodeInput {
  const trimmed = raw.trim();
  if (!trimmed) return { code: '', multiplier: 1 };

  // Prefix multiplier: 5*8901234001 or 5x8901234001
  const prefixMatch = trimmed.match(/^(\d{1,3})\s*[*xX]\s*([A-Za-z0-9\-_.]{3,})$/);
  if (prefixMatch) {
    return {
      code: prefixMatch[2].trim(),
      multiplier: Math.max(1, Math.min(999, parseInt(prefixMatch[1], 10) || 1)),
    };
  }

  // Suffix multiplier: 8901234001*5
  const suffixMatch = trimmed.match(/^([A-Za-z0-9\-_.]{3,})\s*\*\s*(\d{1,3})$/);
  if (suffixMatch) {
    return {
      code: suffixMatch[1].trim(),
      multiplier: Math.max(1, Math.min(999, parseInt(suffixMatch[2], 10) || 1)),
    };
  }

  return { code: trimmed, multiplier: 1 };
}

function normalizeNumericBarcode(code: string): string {
  const cleaned = code.trim();
  if (/^\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+/, '') || '0';
  }
  return cleaned.toLowerCase();
}

/**
 * Finds exact catalog match for a scanned barcode across bulk (`barcode`) and
 * optional loose piece (`pieceBarcode`) codes.
 */
export function matchProductByBarcode(
  products: Product[],
  rawCode: string
): BarcodeMatchResult | null {
  const q = rawCode.trim().toLowerCase();
  if (!q) return null;
  const qNorm = normalizeNumericBarcode(q);

  // 1. Exact loose-piece barcode match -> force piece unit
  const exactPiece = products.find(p => {
    if (!p.pieceBarcode) return false;
    const pb = p.pieceBarcode.trim().toLowerCase();
    return pb === q || normalizeNumericBarcode(pb) === qNorm;
  });
  if (exactPiece) {
    return {
      product: exactPiece,
      detectedUnit: isUnitConfigured(exactPiece, 'piece') ? 'piece' : getPreferredUnit(exactPiece),
      matchedField: 'pieceBarcode',
    };
  }

  // 2. Exact primary/bulk barcode match
  const exactPrimary = products.find(p => {
    if (!p.barcode) return false;
    const b = p.barcode.trim().toLowerCase();
    return b === q || normalizeNumericBarcode(b) === qNorm;
  });
  if (exactPrimary) {
    return {
      product: exactPrimary,
      matchedField: 'barcode',
    };
  }

  return null;
}

/**
 * Matches either an exact barcode or a unique partial catalog query (for Enter-key billing).
 */
export function matchProductForQuickScan(
  products: Product[],
  rawInput: string
): { match: BarcodeMatchResult | null; multiplier: number; code: string } {
  const { code, multiplier } = parseBarcodeScanInput(rawInput);
  if (!code) return { match: null, multiplier: 1, code: '' };

  const exact = matchProductByBarcode(products, code);
  if (exact) return { match: exact, multiplier, code };

  const q = code.toLowerCase();
  const partialMatches = products.filter(
    p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q) ||
      p.pieceBarcode?.toLowerCase().includes(q)
  );
  if (partialMatches.length === 1) {
    return {
      match: { product: partialMatches[0], matchedField: 'search' },
      multiplier,
      code,
    };
  }

  return { match: null, multiplier, code };
}

export function resolveUnitForScannedProduct(
  product: Product,
  pref: 'auto' | UnitType,
  detectedUnit?: UnitType
): UnitType {
  if (detectedUnit && isUnitConfigured(product, detectedUnit)) {
    return detectedUnit;
  }
  if (pref !== 'auto' && isUnitConfigured(product, pref)) {
    return pref;
  }
  return getPreferredUnit(product);
}

/**
 * Generates a valid GS1 EAN-13 barcode with prefix 890 (India retail/wholesale)
 * and a valid check digit, avoiding collisions with existing catalog barcodes.
 */
export function generateEan13Barcode(existingProducts: Product[] = []): string {
  const existingSet = new Set<string>();
  existingProducts.forEach(p => {
    if (p.barcode) existingSet.add(p.barcode.trim());
    if (p.pieceBarcode) existingSet.add(p.pieceBarcode.trim());
  });

  for (let attempt = 0; attempt < 25; attempt++) {
    const randNine = Math.floor(100000000 + Math.random() * 899999999).toString();
    const body12 = `890${randNine}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = Number(body12[i]);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const candidate = `${body12}${checkDigit}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }

  const fallback12 = `890${Date.now().toString().slice(-9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(fallback12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${fallback12}${(10 - (sum % 10)) % 10}`;
}

export function buildBarcodeSvgBars(code: string): {
  bars: Array<{ x: number; w: number }>;
  totalWidth: number;
} {
  const chars = (code || '8901234001').split('');
  const result: Array<{ x: number; w: number }> = [];
  let cursor = 2;

  // Guard bars left
  result.push({ x: cursor, w: 1.4 });
  cursor += 2.6;
  result.push({ x: cursor, w: 1.4 });
  cursor += 3.2;

  chars.forEach((ch, idx) => {
    const val = ch.charCodeAt(0) + idx * 7;
    const w1 = (val % 3) + 1;
    const gap = ((val >> 1) % 2) + 1.5;
    result.push({ x: cursor, w: w1 });
    cursor += w1 + gap;
    if (idx % 2 === 0) {
      const w2 = ((val >> 2) % 2) + 1;
      result.push({ x: cursor, w: w2 });
      cursor += w2 + 1.5;
    }
  });

  // Guard bars right
  cursor += 1;
  result.push({ x: cursor, w: 1.4 });
  cursor += 2.6;
  result.push({ x: cursor, w: 1.4 });
  cursor += 3.4;

  return { bars: result, totalWidth: Math.max(64, cursor) };
}
