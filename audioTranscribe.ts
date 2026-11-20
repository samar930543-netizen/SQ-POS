import {
  AudioListMode,
  AudioTranscribedItem,
  Product,
  SavedAudioItemList,
  UnitType,
} from '../types';
import {
  getPreferredUnit,
  hasConfiguredBundleTier,
  hasConfiguredPieceTier,
} from './unitSpecs';

const AUDIO_LISTS_STORAGE_KEY = 'sq_pos_audio_item_lists_v1';

const HINDI_ITEM_SYNONYMS: Record<string, string[]> = {
  'तेल': ['oil', 'mustard', 'fortune'],
  'सरसों': ['mustard', 'fortune', 'oil'],
  'साबुन': ['soap', 'dettol', 'lifebuoy'],
  'बिस्कुट': ['biscuit', 'parle', 'good', 'day'],
  'चाय': ['tea', 'tata'],
  'पत्ती': ['tea', 'tata'],
  'डिटर्जेंट': ['detergent', 'surf', 'rin'],
  'सर्फ': ['surf', 'excel'],
  'रिन': ['rin', 'detergent'],
  'सिगरेट': ['gold', 'flake', 'classic'],
  'कोक': ['coca', 'cola'],
  'कोल्ड': ['coca', 'cola'],
  'चीनी': ['sugar'],
  'आटा': ['atta', 'flour'],
  'नमक': ['salt'],
  'दाल': ['dal', 'lentil'],
  'माचिस': ['match', 'matchbox'],
  'मक्खन': ['butter', 'amul'],
  'घी': ['ghee'],
  'चावल': ['rice'],
};

const STOP_WORDS = new Set([
  'bundle',
  'bundles',
  'carton',
  'cartons',
  'peti',
  'case',
  'box',
  'boxes',
  'pcs',
  'pc',
  'piece',
  'pieces',
  'pkt',
  'packet',
  'packets',
  'doz',
  'dozen',
  'nos',
  'kg',
  'kilo',
  'g',
  'gm',
  'gms',
  'ml',
  'ltr',
  'liter',
  'litre',
  'of',
  'and',
  'the',
  'for',
  'a',
  'an',
  'loose',
]);

export function matchProductForAudioItem(
  itemName: string,
  spokenText: string | undefined,
  products: Product[]
): Product | null {
  const combinedRaw = `${itemName || ''} ${spokenText || ''}`.trim();
  if (!combinedRaw || products.length === 0) return null;

  let expanded = combinedRaw.toLowerCase();
  for (const [hindiWord, engWords] of Object.entries(HINDI_ITEM_SYNONYMS)) {
    if (combinedRaw.includes(hindiWord)) {
      expanded += ' ' + engWords.join(' ');
    }
  }

  const cleanText = expanded.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanText) return null;

  const exact = products.find(p => p.name.toLowerCase().trim() === cleanText);
  if (exact) return exact;

  const cleanNameOnly = itemName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanNameOnly) {
    const exactName = products.find(p => p.name.toLowerCase().trim() === cleanNameOnly);
    if (exactName) return exactName;

    const sub = products.find(p => {
      const pLower = p.name.toLowerCase().trim();
      return (
        (cleanNameOnly.length >= 3 && pLower.includes(cleanNameOnly)) ||
        (pLower.length >= 3 && cleanNameOnly.includes(pLower))
      );
    });
    if (sub) return sub;
  }

  const getKeywords = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);

  const queryKeywords = getKeywords(cleanText);
  const queryCoreTokens = queryKeywords.filter(t => !STOP_WORDS.has(t) || t.length > 4);

  let bestProduct: Product | null = null;
  let highestScore = 0;

  for (const product of products) {
    const pKeywords = getKeywords(product.name);
    const pCoreTokens = pKeywords.filter(t => !STOP_WORDS.has(t) || t.length > 4);

    let coreMatches = 0;
    for (const token of queryCoreTokens) {
      if (
        pCoreTokens.some(
          pt =>
            pt === token ||
            (token.length > 3 && pt.startsWith(token)) ||
            (pt.length > 3 && token.startsWith(pt))
        )
      ) {
        coreMatches += 2;
      }
    }

    let generalMatches = 0;
    for (const token of queryKeywords) {
      if (pKeywords.includes(token)) {
        generalMatches += 1;
      }
    }

    const totalScore = coreMatches * 2 + generalMatches;
    if (totalScore > highestScore) {
      highestScore = totalScore;
      bestProduct = product;
    }
  }

  return highestScore >= 2 ? bestProduct : null;
}

export function resolveUnitForMatchedProduct(
  product: Product,
  suggestedUnit: UnitType
): UnitType {
  const hasBundle = hasConfiguredBundleTier(product);
  const hasPiece = hasConfiguredPieceTier(product);
  if (suggestedUnit === 'bundle' && hasBundle) return 'bundle';
  if (suggestedUnit === 'piece' && hasPiece) return 'piece';
  return getPreferredUnit(product);
}

export function normalizeTranscribedItems(
  rawItems: any[],
  products: Product[]
): AudioTranscribedItem[] {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((raw, idx) => {
    const productName = String(raw?.productName || raw?.name || `Item ${idx + 1}`).trim();
    const spokenText = raw?.spokenText ? String(raw.spokenText).trim() : '';
    const quantity = Math.max(1, Math.round((Number(raw?.quantity) || 1) * 100) / 100);
    const rawUnitType: UnitType =
      String(raw?.unitType || '').toLowerCase() === 'bundle' ? 'bundle' : 'piece';

    const matched = matchProductForAudioItem(productName, spokenText, products);
    const resolvedUnit = matched
      ? resolveUnitForMatchedProduct(matched, rawUnitType)
      : rawUnitType;

    const catalogUnitPrice = matched
      ? resolvedUnit === 'bundle'
        ? matched.bundlePrice
        : matched.piecePrice
      : 0;
    const spokenUnitPrice = Number(raw?.unitPrice);
    const unitPrice =
      Number.isFinite(spokenUnitPrice) && spokenUnitPrice > 0
        ? Math.round(spokenUnitPrice * 100) / 100
        : catalogUnitPrice;

    const bundlePieces = matched
      ? matched.bundlePieces
      : Math.max(1, Math.round(Number(raw?.bundlePieces) || 1));

    const unitName = matched
      ? resolvedUnit === 'bundle'
        ? matched.bundleUnitName
        : 'Piece'
      : String(raw?.unitName || (resolvedUnit === 'bundle' ? 'Bundle' : 'Piece')).trim();

    return {
      id: `audio_item_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      productName: matched ? matched.name : productName,
      spokenText,
      quantity,
      unitType: resolvedUnit,
      unitName,
      bundlePieces,
      unitPrice,
      notes: raw?.notes ? String(raw.notes).trim() : '',
      selectedProductId: matched ? matched.id : 'CUSTOM',
      enabled: true,
    };
  });
}

export function formatAudioDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function inferAudioMimeType(file: File): string {
  const rawType = (file.type || '').split(';')[0].trim().toLowerCase();
  if (rawType.startsWith('audio/')) {
    if (rawType === 'audio/x-wav') return 'audio/wav';
    if (rawType === 'audio/x-m4a') return 'audio/mp4';
    return rawType;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mp3':
      return 'audio/mp3';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mp3';
  }
}

export function buildFormattedItemListText(
  title: string,
  items: AudioTranscribedItem[],
  includePrices: boolean = true
): string {
  const active = items.filter(i => i.enabled && i.productName.trim());
  const header = title.trim() || 'Transcribed Item List';
  const lines = active.map((item, index) => {
    const unitLabel = item.unitType === 'bundle' ? item.unitName || 'Bundle' : item.unitName || 'Pcs';
    const qtyPart = `${item.quantity} ${unitLabel}`;
    const pricePart =
      includePrices && item.unitPrice > 0
        ? ` — ₹${(item.quantity * item.unitPrice).toLocaleString('en-IN')}`
        : '';
    return `${index + 1}. ${item.productName} (${qtyPart})${pricePart}`;
  });
  const totalEst = active.reduce((sum, i) => sum + i.quantity * (i.unitPrice || 0), 0);
  const footer =
    includePrices && totalEst > 0
      ? `\nTotal Items: ${active.length} | Est. Total: ₹${totalEst.toLocaleString('en-IN')}`
      : `\nTotal Items: ${active.length}`;
  return `${header}\n${'-'.repeat(Math.min(36, header.length))}\n${lines.join('\n')}${footer}`;
}

export function buildItemListCsv(title: string, items: AudioTranscribedItem[]): string {
  const escapeCsv = (val: string | number) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = ['List Title', 'Item Name', 'Quantity', 'Unit', 'Pieces Per Unit', 'Unit Rate (INR)', 'Line Total (INR)', 'Catalog Status', 'Notes'];
  const rows = items
    .filter(i => i.enabled && i.productName.trim())
    .map(i => [
      escapeCsv(title || 'Transcribed Item List'),
      escapeCsv(i.productName),
      escapeCsv(i.quantity),
      escapeCsv(i.unitType === 'bundle' ? i.unitName || 'Bundle' : i.unitName || 'Piece'),
      escapeCsv(i.unitType === 'bundle' ? i.bundlePieces : 1),
      escapeCsv(i.unitPrice || 0),
      escapeCsv(Math.round(i.quantity * (i.unitPrice || 0) * 100) / 100),
      escapeCsv(i.selectedProductId !== 'CUSTOM' && i.selectedProductId !== 'SKIP' ? 'Matched SKU' : 'Custom Item'),
      escapeCsv(i.notes || i.spokenText || ''),
    ]);
  return [header.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export function getStoredAudioLists(): SavedAudioItemList[] {
  try {
    const raw = localStorage.getItem(AUDIO_LISTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAudioLists(lists: SavedAudioItemList[]): void {
  try {
    localStorage.setItem(AUDIO_LISTS_STORAGE_KEY, JSON.stringify(lists.slice(0, 30)));
  } catch {
    // ignore storage quota errors
  }
}

export function upsertSavedAudioList(list: SavedAudioItemList): SavedAudioItemList[] {
  const existing = getStoredAudioLists();
  const idx = existing.findIndex(l => l.id === list.id);
  const updated =
    idx > -1
      ? existing.map(l => (l.id === list.id ? list : l))
      : [list, ...existing];
  saveAudioLists(updated);
  return updated;
}

export function deleteSavedAudioList(id: string): SavedAudioItemList[] {
  const updated = getStoredAudioLists().filter(l => l.id !== id);
  saveAudioLists(updated);
  return updated;
}

export function createEmptyAudioListItem(): AudioTranscribedItem {
  return {
    id: `audio_item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    productName: '',
    spokenText: '',
    quantity: 1,
    unitType: 'piece',
    unitName: 'Piece',
    bundlePieces: 1,
    unitPrice: 0,
    notes: '',
    selectedProductId: 'CUSTOM',
    enabled: true,
  };
}

export function getDefaultListTitleForMode(mode: AudioListMode): string {
  const dateLabel = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
  switch (mode) {
    case 'cart':
      return `Voice Order · ${dateLabel}`;
    case 'restock':
      return `Restock Intake List · ${dateLabel}`;
    default:
      return `Audio Item List · ${dateLabel}`;
  }
}
