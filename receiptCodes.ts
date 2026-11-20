import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library';
import { Bill, ReceiptDesignConfig, StoreProfile } from '../types';

export interface QrMatrixData {
  size: number;
  modules: boolean[][];
  payload: string;
}

export interface BarcodeBarsData {
  bars: Array<{ x: number; w: number }>;
  totalWidth: number;
  encodedText: string;
}

// =========================================================================
// CODE-128B ENCODING TABLE (107 symbols, values 0..106)
// Each pattern string has 6 digits alternating bar, space, bar, space, bar, space
// (Stop symbol 106 has 7 digits: 2331112)
// =========================================================================
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

// Code-39 encoding for 0-9, A-Z, - . $ / + % space, and *
const CODE39_MAP: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export function encodeReceiptBarcode(
  rawValue: string,
  format: 'code128' | 'code39' = 'code128'
): BarcodeBarsData {
  const sanitized = (rawValue || 'SQ-000000')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 24) || 'SQ-000000';

  if (format === 'code39') {
    const clean39 = sanitized
      .toUpperCase()
      .replace(/[^0-9A-Z\-. $/+%]/g, '-');
    const full = `*${clean39}*`;
    const bars: Array<{ x: number; w: number }> = [];
    let cursor = 0;
    for (let cIdx = 0; cIdx < full.length; cIdx++) {
      const pattern = CODE39_MAP[full[cIdx]] || CODE39_MAP['-'];
      for (let i = 0; i < pattern.length; i++) {
        const w = pattern[i] === 'w' ? 2.5 : 1;
        if (i % 2 === 0) {
          bars.push({ x: cursor, w });
        }
        cursor += w;
      }
      cursor += 1; // inter-character narrow space
    }
    return { bars, totalWidth: cursor, encodedText: clean39 };
  }

  // Code-128B (supports full ASCII 32..127)
  const START_CODE_B = 104;
  const STOP_CODE = 106;
  const values: number[] = [START_CODE_B];
  let checksum = START_CODE_B;

  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);
    const val = code >= 32 && code <= 127 ? code - 32 : 13; // '-' fallback
    values.push(val);
    checksum += val * (i + 1);
  }
  values.push(checksum % 103);
  values.push(STOP_CODE);

  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;
  for (const val of values) {
    const pattern = CODE128_PATTERNS[val] || CODE128_PATTERNS[0];
    for (let i = 0; i < pattern.length; i++) {
      const w = parseInt(pattern[i], 10) || 1;
      if (i % 2 === 0) {
        bars.push({ x: cursor, w });
      }
      cursor += w;
    }
  }
  return { bars, totalWidth: cursor, encodedText: sanitized };
}

export function buildReceiptQrPayload(
  bill: Bill,
  storeProfile: StoreProfile,
  design: ReceiptDesignConfig
): string {
  const mode = design.qrCodeMode || 'invoice_verify';
  const storeName = storeProfile.storeName?.trim() || 'SQ ENTERPRISES';

  if (mode === 'upi_payment') {
    const upiId = (design.qrUpiId || '').trim() || 'sqenterprises@upi';
    const amountDue = bill.remainingBalance > 0 ? bill.remainingBalance : bill.grandTotal;
    const params = new URLSearchParams({
      pa: upiId,
      pn: storeName,
      am: Math.max(1, amountDue).toFixed(2),
      cu: 'INR',
      tn: `Bill ${bill.billNumber}`,
    });
    return `upi://pay?${params.toString()}`;
  }

  if (mode === 'custom_url') {
    const custom = (design.qrCustomPayload || '').trim();
    if (custom) return custom;
  }

  return [
    `INV:${bill.billNumber}`,
    `STORE:${storeName}`,
    `AMT:INR ${bill.grandTotal.toFixed(2)}`,
    `PAID:${bill.amountReceived.toFixed(2)}`,
    `DATE:${bill.formattedDateTime}`,
  ].join('|');
}

const qrWriter = new QRCodeWriter();

export function encodeReceiptQrMatrix(payload: string): QrMatrixData | null {
  const text = (payload || '').trim();
  if (!text) return null;
  try {
    const hints = new Map<EncodeHintType, unknown>();
    hints.set(EncodeHintType.MARGIN, 1);
    const matrix = qrWriter.encode(text, BarcodeFormat.QR_CODE, 1, 1, hints);
    const width = matrix.getWidth();
    const height = matrix.getHeight();
    const modules: boolean[][] = [];
    for (let y = 0; y < height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < width; x++) {
        row.push(Boolean(matrix.get(x, y)));
      }
      modules.push(row);
    }
    return {
      size: Math.max(width, height),
      modules,
      payload: text,
    };
  } catch {
    return null;
  }
}
