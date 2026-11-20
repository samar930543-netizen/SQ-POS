import { Bill, Customer, Product, StoreProfile } from '../types';
import { formatStockDisplay } from './formatters';

export type LiveVoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export const LIVE_VOICE_OPTIONS: Array<{
  id: LiveVoiceName;
  label: string;
  tone: string;
}> = [
  { id: 'Zephyr', label: 'Zephyr', tone: 'Bright & clear' },
  { id: 'Puck', label: 'Puck', tone: 'Upbeat & natural' },
  { id: 'Kore', label: 'Kore', tone: 'Warm & calm' },
  { id: 'Charon', label: 'Charon', tone: 'Steady & deep' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Crisp & direct' },
];

export function downsampleFloat32(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number = 16000
): Float32Array {
  if (!inputSampleRate || inputSampleRate === targetSampleRate) {
    return input;
  }
  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcPos - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function float32ToInt16PcmBase64(
  floatData: Float32Array,
  sourceSampleRate: number = 16000
): string {
  const resampled = downsampleFloat32(floatData, sourceSampleRate, 16000);
  const buffer = new ArrayBuffer(resampled.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < resampled.length; i++) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(i * 2, int16, true);
  }

  return uint8ToBase64(new Uint8Array(buffer));
}

export function decodeBase64Pcm24kToFloat32(base64Pcm: string): Float32Array {
  const binaryString = atob(base64Pcm);
  const byteLen = binaryString.length;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const sampleCount = Math.floor(byteLen / 2);
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }

  return float32;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.min(1, rms * 4.5);
}

export function buildLiveStoreContext(params: {
  storeProfile: StoreProfile;
  products: Product[];
  customers: Customer[];
  bills: Bill[];
}) {
  const { storeProfile, products, customers, bills } = params;
  const todayKey = new Date().toISOString().slice(0, 10);

  const todayBills = bills.filter(b => (b.timestamp || '').slice(0, 10) === todayKey);
  const todaySales = todayBills.reduce(
    (sum, b) => sum + (b.itemsTotal || 0) + (b.totalGstAmount || 0),
    0
  );

  const lowStockProducts = products.filter(p => p.stockPieces <= p.lowStockThreshold);
  const totalPendingUdhar = customers.reduce((sum, c) => sum + (c.currentBalance || 0), 0);

  return {
    storeName: storeProfile.storeName || 'SQ Enterprises',
    totalProducts: products.length,
    lowStockCount: lowStockProducts.length,
    totalCustomers: customers.length,
    todayBillsCount: todayBills.length,
    todaySales: Math.round(todaySales * 100) / 100,
    totalPendingUdhar: Math.round(totalPendingUdhar * 100) / 100,
    lowStockSample: lowStockProducts.slice(0, 15).map(p => {
      const disp = formatStockDisplay(p.stockPieces, p.bundlePieces, p.bundleUnitName);
      return `${p.name} (${disp.text}, threshold ${p.lowStockThreshold} pcs)`;
    }),
    catalogSample: products.slice(0, 45).map(p => {
      const disp = formatStockDisplay(p.stockPieces, p.bundlePieces, p.bundleUnitName);
      return `${p.name}: ${p.bundleUnitName}=₹${p.bundlePrice} (${p.bundlePieces} pcs), Pcs=₹${p.piecePrice}, Stock=${disp.text}`;
    }),
    topUdharSample: customers
      .filter(c => c.currentBalance > 0)
      .sort((a, b) => b.currentBalance - a.currentBalance)
      .slice(0, 12)
      .map(c => `${c.name}: ₹${Math.round(c.currentBalance)}`),
  };
}
