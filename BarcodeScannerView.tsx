import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Product, UnitType, CartItem, Customer } from '../types';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { getEffectiveUnitPrice } from '../utils/customerPricing';
import {
  hasConfiguredBundleTier,
  hasConfiguredPieceTier,
} from '../utils/unitSpecs';
import {
  buildBarcodeSvgBars,
  matchProductForQuickScan,
  resolveUnitForScannedProduct,
} from '../utils/barcodeScanner';
import { startCameraBarcodeStream, CameraScannerHandle } from '../utils/cameraBarcodeEngine';
import {
  ScanBarcode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertCircle,
  Plus,
  Star,
  RotateCcw,
  Flashlight,
  Zap,
  ShoppingCart,
  ArrowRight,
  PlusCircle,
} from 'lucide-react';

interface BarcodeScannerViewProps {
  products: Product[];
  cart: CartItem[];
  activeCustomer: Customer | null;
  onAddToCart: (product: Product, unit: UnitType, quantity?: number) => void;
  favoriteIds: Set<string>;
  onToggleFavorite: (productId: string) => void;
  onOpenCart?: () => void;
  onExpressCashCheckout?: () => void;
  onCreateProductWithBarcode?: (barcode: string) => void;
}

interface ScanLogEntry {
  id: string;
  code: string;
  productName: string;
  unitLabel: string;
  quantity: number;
  unitPrice: number;
  timestamp: string;
  matched: boolean;
}

/** Deterministic SVG barcode bars rendered cleanly from SKU barcode text */
const MiniBarcodeSvg: React.FC<{ code: string }> = ({ code }) => {
  const bars = useMemo(() => buildBarcodeSvgBars(code), [code]);

  return (
    <svg
      viewBox={`0 0 ${bars.totalWidth} 22`}
      className="h-5 w-24 text-slate-300 flex-shrink-0"
      aria-hidden="true"
    >
      {bars.bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={22} fill="currentColor" />
      ))}
    </svg>
  );
};

export const BarcodeScannerView: React.FC<BarcodeScannerViewProps> = ({
  products,
  cart,
  activeCustomer,
  onAddToCart,
  favoriteIds,
  onToggleFavorite,
  onOpenCart,
  onExpressCashCheckout,
  onCreateProductWithBarcode,
}) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanUnitPref, setScanUnitPref] = useState<'auto' | UnitType>('auto');
  const [scanMultiplier, setScanMultiplier] = useState<number>(1);
  const [scanLogs, setScanLogs] = useState<ScanLogEntry[]>([]);
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    unknownCode?: string;
  } | null>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [engineName, setEngineName] = useState<'BarcodeDetector' | 'ZXing' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraHandleRef = useRef<CameraScannerHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const executeScanRef = useRef<(rawCode: string, explicitUnit?: UnitType) => void>(() => {});

  const stopCamera = () => {
    cameraHandleRef.current?.stop();
    cameraHandleRef.current = null;
    setIsCameraActive(false);
    setHasTorch(false);
    setTorchOn(false);
    setEngineName(null);
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      stopCamera();
    };
  }, []);

  const executeScan = (rawCode: string, explicitUnit?: UnitType) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    const { match, multiplier: parsedMult, code } = matchProductForQuickScan(products, trimmed);
    const effectiveQty = parsedMult > 1 ? parsedMult : scanMultiplier;

    const nowLabel = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    if (!match) {
      soundManager.playAlertSound();
      setScanFeedback({
        type: 'error',
        message: `No catalog SKU found for barcode "${code || trimmed}".`,
        unknownCode: code || trimmed,
      });
      setScanLogs(prev => [
        {
          id: `scan_${Date.now()}`,
          code: code || trimmed,
          productName: 'Unrecognized Barcode',
          unitLabel: '-',
          quantity: 0,
          unitPrice: 0,
          timestamp: nowLabel,
          matched: false,
        },
        ...prev.slice(0, 19),
      ]);
      return;
    }

    const matched = match.product;
    const chosenUnit = resolveUnitForScannedProduct(
      matched,
      scanUnitPref,
      explicitUnit || match.detectedUnit
    );

    const eff = getEffectiveUnitPrice(matched, chosenUnit, activeCustomer);
    const unitLabel = chosenUnit === 'bundle' ? matched.bundleUnitName : 'Piece';

    soundManager.playScannerBeep();
    onAddToCart(matched, chosenUnit, effectiveQty);

    setScanFeedback({
      type: 'success',
      message: `Added ${effectiveQty} ${unitLabel}${effectiveQty > 1 ? 's' : ''} of ${matched.name} (${formatCurrency(eff.unitPrice * effectiveQty)})`,
    });

    setScanLogs(prev => [
      {
        id: `scan_${Date.now()}`,
        code:
          (chosenUnit === 'piece' && matched.pieceBarcode) ||
          matched.barcode ||
          code,
        productName: matched.name,
        unitLabel,
        quantity: effectiveQty,
        unitPrice: eff.unitPrice,
        timestamp: nowLabel,
        matched: true,
      },
      ...prev.slice(0, 19),
    ]);
  };

  executeScanRef.current = executeScan;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    executeScan(barcodeInput);
    setBarcodeInput('');
    inputRef.current?.focus();
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);

    window.setTimeout(async () => {
      if (!videoRef.current) return;
      try {
        const handle = await startCameraBarcodeStream({
          videoEl: videoRef.current,
          facingMode: 'environment',
          onDetected: code => executeScanRef.current(code),
        });
        cameraHandleRef.current = handle;
        setHasTorch(handle.hasTorch);
        setEngineName(handle.engineName);
      } catch (err) {
        stopCamera();
        setCameraError(
          err instanceof Error
            ? err.message
            : 'Camera access unavailable. Use the focused USB/Bluetooth scanner input above.'
        );
      }
    }, 60);
  };

  const handleToggleTorch = async () => {
    if (!cameraHandleRef.current) return;
    const next = !torchOn;
    const ok = await cameraHandleRef.current.setTorch(next);
    if (ok) setTorchOn(next);
  };

  const quickScanProducts = useMemo(() => {
    const q = barcodeInput.trim().toLowerCase();
    return q
      ? products.filter(
          p =>
            p.barcode?.toLowerCase().includes(q) ||
            p.pieceBarcode?.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        )
      : products;
  }, [products, barcodeInput]);

  const { cartUnits, cartSubtotal } = useMemo(() => {
    return cart.reduce(
      (acc, i) => {
        acc.cartUnits += i.quantity;
        acc.cartSubtotal += i.itemTotal;
        return acc;
      },
      { cartUnits: 0, cartSubtotal: 0 }
    );
  }, [cart]);

  return (
    <div className="space-y-4">
      {/* Scanner Console Card */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ScanBarcode className="w-4 h-4 text-blue-400" />
              <span>Barcode &amp; SKU Rapid Scanner</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Scan USB/Bluetooth or camera barcodes, or use qty*code syntax (e.g. 5*8901234001)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isCameraActive && hasTorch && (
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 transition ${
                  torchOn
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <Flashlight className="w-3.5 h-3.5" />
                <span>Flash</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => (isCameraActive ? stopCamera() : void startCamera())}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap transition ${
                isCameraActive
                  ? 'bg-rose-600/20 text-rose-300 border-rose-500/40 hover:bg-rose-600/30'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {isCameraActive ? (
                <>
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>Stop Camera</span>
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5 text-blue-400" />
                  <span>Camera Scan</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scanner Input + Unit + Multiplier Controls */}
        <form onSubmit={handleFormSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-2">
          <div className="lg:col-span-6 relative">
            <ScanBarcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
            <input
              ref={inputRef}
              type="text"
              data-barcode-input="global"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="Scan barcode or type qty*code (e.g. 5*8901234001) + Enter..."
              className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-blue-500/40 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* Default Unit Preference */}
          <div className="lg:col-span-3 flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
            {(
              [
                { id: 'auto', label: 'Auto' },
                { id: 'bundle', label: 'Bulk' },
                { id: 'piece', label: 'Piece' },
              ] as const
            ).map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setScanUnitPref(opt.id);
                }}
                className={`flex-1 py-1.5 rounded-lg font-semibold whitespace-nowrap transition ${
                  scanUnitPref === opt.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Scan Quantity Multiplier + Submit */}
          <div className="lg:col-span-3 flex items-center gap-1.5">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs flex-1">
              {[1, 2, 5, 10].map(mult => (
                <button
                  key={mult}
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setScanMultiplier(mult);
                  }}
                  className={`flex-1 py-1.5 rounded-lg font-mono font-bold transition ${
                    scanMultiplier === mult
                      ? 'bg-slate-800 text-amber-300 border border-slate-700'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {mult}x
                </button>
              ))}
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold whitespace-nowrap transition active:scale-95"
            >
              Scan Add
            </button>
          </div>
        </form>

        {/* Camera Viewfinder */}
        {isCameraActive && (
          <div className="relative rounded-xl overflow-hidden bg-black border border-slate-700 max-h-60 flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full max-h-60 object-cover"
            />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            {engineName && (
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-200 border border-white/10">
                {engineName === 'BarcodeDetector' ? 'Native Optical' : 'ZXing Optical'} · Live
              </span>
            )}
          </div>
        )}

        {cameraError && (
          <div className="px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-800/50 text-xs text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{cameraError}</span>
          </div>
        )}

        {scanFeedback && (
          <div
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
              scanFeedback.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                : 'bg-rose-950/50 border-rose-700/50 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {scanFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              )}
              <span className="truncate">{scanFeedback.message}</span>
            </div>

            {scanFeedback.type === 'error' &&
              scanFeedback.unknownCode &&
              onCreateProductWithBarcode && (
                <button
                  type="button"
                  onClick={() => onCreateProductWithBarcode(scanFeedback.unknownCode!)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Create SKU</span>
                </button>
              )}
          </div>
        )}
      </div>

      {/* Two-Column Split: Catalog Barcode Tiles (left) + Session Log & Express Checkout (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-semibold text-slate-300">
              Catalog Barcodes ({quickScanProducts.length})
            </span>
            <span>Tap any unit button to simulate barcode scan</span>
          </div>

          {quickScanProducts.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2.5">
              <p className="text-xs text-slate-400">
                No catalog SKU matches &ldquo;{barcodeInput}&rdquo;.
              </p>
              {barcodeInput.trim() && onCreateProductWithBarcode && (
                <button
                  type="button"
                  onClick={() => onCreateProductWithBarcode(barcodeInput.trim())}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Create Product with Barcode &ldquo;{barcodeInput.trim()}&rdquo;</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {quickScanProducts.map(product => {
                const hasBundle = hasConfiguredBundleTier(product);
                const hasPiece = hasConfiguredPieceTier(product) || !hasBundle;
                const bundleEff = getEffectiveUnitPrice(product, 'bundle', activeCustomer);
                const pieceEff = getEffectiveUnitPrice(product, 'piece', activeCustomer);
                const stockInfo = formatStockDisplay(
                  product.stockPieces,
                  product.bundlePieces,
                  product.bundleUnitName
                );
                const inCartQty = cart
                  .filter(c => c.productId === product.id)
                  .reduce((s, c) => s + c.totalPieces, 0);
                const isFav = favoriteIds.has(product.id);

                return (
                  <div
                    key={product.id}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{product.emoji}</span>
                          <h4 className="font-bold text-sm text-white truncate">
                            {product.name}
                          </h4>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{product.category}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-semibold tabular-nums ${
                              product.stockPieces <= 0
                                ? 'text-rose-400'
                                : product.stockPieces <= product.lowStockThreshold
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                            }`}
                          >
                            {stockInfo.text}
                          </span>
                          {inCartQty > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-300 font-semibold tabular-nums">
                                {inCartQty} pcs in cart
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onToggleFavorite(product.id)}
                        className={`p-1 rounded-lg transition ${
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

                    {/* Visual Barcode + Code + Instant Scan Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <div className="min-w-0">
                        {product.barcode ? (
                          <div className="space-y-0.5">
                            <MiniBarcodeSvg code={product.barcode} />
                            <div className="font-mono text-[11px] text-slate-300 tabular-nums truncate">
                              {product.barcode}
                              {product.pieceBarcode ? ` / Pc:${product.pieceBarcode}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">No barcode assigned</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {hasBundle && (
                          <button
                            type="button"
                            onClick={() =>
                              executeScan(product.barcode || product.name, 'bundle')
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap tabular-nums transition active:scale-95"
                          >
                            <Plus className="w-3 h-3" />
                            <span>
                              {scanMultiplier > 1 ? `${scanMultiplier}× ` : ''}
                              {product.bundleUnitName} {formatCurrency(bundleEff.unitPrice)}
                            </span>
                          </button>
                        )}
                        {hasPiece && (
                          <button
                            type="button"
                            onClick={() =>
                              executeScan(
                                product.pieceBarcode || product.barcode || product.name,
                                'piece'
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap tabular-nums transition active:scale-95"
                          >
                            <Plus className="w-3 h-3" />
                            <span>
                              {scanMultiplier > 1 ? `${scanMultiplier}× ` : ''}
                              Pc {formatCurrency(pieceEff.unitPrice)}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Express Checkout & Recent Scans Log */}
        <div className="xl:col-span-4 space-y-3">
          {/* Express Scan-to-Checkout Card */}
          <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Express Scan Checkout</span>
              <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
                {cartUnits} {cartUnits === 1 ? 'unit' : 'units'} · {formatCurrency(cartSubtotal)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {onExpressCashCheckout && (
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => onExpressCashCheckout()}
                  className="py-2 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition active:scale-95"
                  title="Complete full cash bill immediately & print receipt"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>1-Tap Cash Bill</span>
                </button>
              )}
              {onOpenCart && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    onOpenCart();
                  }}
                  className={`py-2 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition active:scale-95 ${
                    onExpressCashCheckout ? '' : 'col-span-2'
                  }`}
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>Review / Khata</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Scan Session Feed ({scanLogs.filter(l => l.matched).length})
              </h4>
              {scanLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setScanLogs([]);
                    setScanFeedback(null);
                  }}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {scanLogs.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Scanned items will appear here in real time with price and timestamp.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
                {scanLogs.map(entry => (
                  <div key={entry.id} className="py-2 flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div
                        className={`font-semibold truncate ${
                          entry.matched ? 'text-white' : 'text-rose-400'
                        }`}
                      >
                        {entry.productName}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                        {entry.code} · {entry.timestamp}
                      </div>
                    </div>
                    {entry.matched && (
                      <div className="text-right flex-shrink-0 tabular-nums">
                        <div className="font-bold text-emerald-400">
                          +{entry.quantity} {entry.unitLabel}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {formatCurrency(entry.unitPrice * entry.quantity)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
