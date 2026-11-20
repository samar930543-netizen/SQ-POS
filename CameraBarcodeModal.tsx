import React, { useEffect, useRef, useState } from 'react';
import { Product, UnitType } from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { startCameraBarcodeStream, CameraScannerHandle } from '../utils/cameraBarcodeEngine';
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Flashlight,
  RefreshCw,
  ScanBarcode,
  X,
} from 'lucide-react';

interface CameraBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** 'continuous' stays open across multiple scans (POS checkout); 'single' closes after 1 scan (lookup/assign) */
  mode?: 'continuous' | 'single';
  onScanCode: (code: string) => {
    ok: boolean;
    message: string;
    productName?: string;
    amount?: number;
  } | void;
  /** Optional unit selector rendered inside continuous POS modal */
  unitPref?: 'auto' | UnitType;
  onChangeUnitPref?: (unit: 'auto' | UnitType) => void;
  /** Sample catalog products for instant one-tap test / desktop fallback */
  products?: Product[];
  cartCount?: number;
  cartTotal?: number;
  onProceedToCheckout?: () => void;
}

export const CameraBarcodeModal: React.FC<CameraBarcodeModalProps> = ({
  isOpen,
  onClose,
  title = 'Scan Product Barcode',
  subtitle = 'Point camera at an EAN-13 / Code-128 barcode, or scan with a USB scanner',
  mode = 'continuous',
  onScanCode,
  unitPref,
  onChangeUnitPref,
  products = [],
  cartCount = 0,
  cartTotal = 0,
  onProceedToCheckout,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerHandleRef = useRef<CameraScannerHandle | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  const [manualCode, setManualCode] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [engineLabel, setEngineLabel] = useState<'BarcodeDetector' | 'ZXing' | null>(null);
  const [sessionScanCount, setSessionScanCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleDetectedRef = useRef<(code: string) => void>(() => {});
  handleDetectedRef.current = (rawCode: string) => {
    const result = onScanCode(rawCode);
    if (mode === 'single') {
      soundManager.playScannerBeep();
      onClose();
      return;
    }

    if (result) {
      setLastFeedback({ ok: result.ok, message: result.message });
      if (result.ok) {
        setSessionScanCount(c => c + 1);
      }
    } else {
      setSessionScanCount(c => c + 1);
      setLastFeedback({ ok: true, message: `Scanned: ${rawCode}` });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      scannerHandleRef.current?.stop();
      scannerHandleRef.current = null;
      setCameraReady(false);
      setTorchOn(false);
      setHasTorch(false);
      setLastFeedback(null);
      setManualCode('');
      setSessionScanCount(0);
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setCameraReady(false);

    const startTimer = window.setTimeout(async () => {
      if (!videoRef.current || cancelled) return;
      try {
        const handle = await startCameraBarcodeStream({
          videoEl: videoRef.current,
          facingMode,
          onDetected: code => handleDetectedRef.current(code),
        });
        if (cancelled) {
          handle.stop();
          return;
        }
        scannerHandleRef.current = handle;
        setHasTorch(handle.hasTorch);
        setEngineLabel(handle.engineName);
        setCameraReady(true);
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error
              ? err.message
              : 'Unable to open camera. Use manual or USB scanner input below.'
          );
          manualInputRef.current?.focus();
        }
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      scannerHandleRef.current?.stop();
      scannerHandleRef.current = null;
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleToggleTorch = async () => {
    if (!scannerHandleRef.current) return;
    const next = !torchOn;
    const ok = await scannerHandleRef.current.setTorch(next);
    if (ok) setTorchOn(next);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    handleDetectedRef.current(trimmed);
    setManualCode('');
    manualInputRef.current?.focus();
  };

  const sampleBarcodeProducts = products.filter(p => p.barcode).slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Camera className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="truncate">{title}</span>
            </h3>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
            aria-label="Close scanner modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 overflow-y-auto">
          {/* Unit selector for continuous billing */}
          {mode === 'continuous' && unitPref && onChangeUnitPref && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400 font-semibold">Scan Unit Mode:</span>
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                {(
                  [
                    { id: 'auto', label: 'Auto' },
                    { id: 'bundle', label: 'Bulk Unit' },
                    { id: 'piece', label: 'Single Piece' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      onChangeUnitPref(opt.id);
                    }}
                    className={`px-2.5 py-1 rounded-md font-semibold transition whitespace-nowrap ${
                      unitPref === opt.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live Camera Viewport */}
          <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`w-full h-full object-cover ${cameraError ? 'hidden' : 'block'}`}
            />

            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-slate-400 gap-2">
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                <span>Starting camera viewfinder...</span>
              </div>
            )}

            {cameraReady && !cameraError && (
              <>
                <div className="pointer-events-none absolute inset-6 sm:inset-10 rounded-xl border border-blue-400/50">
                  <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500/85 shadow-[0_0_8px_rgba(244,63,94,0.85)]" />
                </div>
                <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px] font-semibold text-slate-200 border border-white/10">
                  {engineLabel === 'BarcodeDetector' ? 'Native Optical' : 'ZXing Optical'} · Live
                </div>
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  {hasTorch && (
                    <button
                      type="button"
                      onClick={() => void handleToggleTorch()}
                      className={`p-1.5 rounded-lg border text-xs transition ${
                        torchOn
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-black/70 text-slate-200 border-white/15 hover:bg-black/90'
                      }`}
                      title="Toggle camera flashlight"
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'))
                    }
                    className="p-1.5 rounded-lg bg-black/70 text-slate-200 border border-white/15 hover:bg-black/90 transition"
                    title="Switch front/rear camera"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}

            {cameraError && (
              <div className="p-5 text-center space-y-2 max-w-sm">
                <AlertCircle className="w-7 h-7 text-amber-400 mx-auto" />
                <p className="text-xs font-semibold text-amber-200">{cameraError}</p>
              </div>
            )}
          </div>

          {/* Scan Feedback */}
          {lastFeedback && (
            <div
              className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                lastFeedback.ok
                  ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-700/50 text-rose-300'
              }`}
            >
              {lastFeedback.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              )}
              <span>{lastFeedback.message}</span>
            </div>
          )}

          {/* USB / Manual Barcode Input */}
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
              <input
                ref={manualInputRef}
                type="text"
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                placeholder="Or scan / type barcode (e.g. 5*8901234001) + Enter"
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition"
            >
              Apply
            </button>
          </form>

          {/* Quick Catalog Test Barcodes (useful when camera unavailable on desktop) */}
          {sampleBarcodeProducts.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <div className="text-[11px] text-slate-400 font-medium">
                Quick Tap Test Barcodes:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sampleBarcodeProducts.map(prod => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleDetectedRef.current(prod.barcode!)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1.5 transition"
                  >
                    <span>{prod.emoji}</span>
                    <span className="font-semibold truncate max-w-[120px]">{prod.name}</span>
                    <span className="font-mono text-blue-300 text-[10px]">{prod.barcode}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          {mode === 'continuous' ? (
            <>
              <div className="text-xs text-slate-400 tabular-nums">
                {sessionScanCount > 0
                  ? `${sessionScanCount} scanned · Cart: ${cartCount} units (${formatCurrency(cartTotal)})`
                  : `Cart: ${cartCount} units (${formatCurrency(cartTotal)})`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                >
                  Done
                </button>
                {onProceedToCheckout && cartCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onProceedToCheckout();
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>Checkout</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
