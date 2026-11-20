import { useEffect, useRef } from 'react';

interface UseHardwareBarcodeScannerOptions {
  enabled: boolean;
  onScan: (barcode: string) => void;
  minLength?: number;
  maxInterKeyDelayMs?: number;
}

/**
 * Global USB / Bluetooth HID keyboard-wedge barcode scanner detector.
 * Captures high-speed bursts of characters (<65ms apart) ending with Enter/Tab
 * even when an input field is not focused, without interfering with normal typing.
 */
export function useHardwareBarcodeScanner({
  enabled,
  onScan,
  minLength = 4,
  maxInterKeyDelayMs = 65,
}: UseHardwareBarcodeScannerOptions): void {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const clearTimerRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      bufferRef.current = '';
      return;
    }

    const resetBuffer = () => {
      bufferRef.current = '';
      lastKeyTimeRef.current = 0;
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toUpperCase() || '';
      const isEditable =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        target?.isContentEditable;

      // Allow inputs explicitly opted into handling their own Enter-key submission
      if (isEditable && target?.dataset?.barcodeInput !== 'global') {
        resetBuffer();
        return;
      }

      const now = performance.now();
      const elapsed = lastKeyTimeRef.current ? now - lastKeyTimeRef.current : 0;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const scanned = bufferRef.current.trim();
        if (scanned.length >= minLength && elapsed <= maxInterKeyDelayMs * 2.5) {
          e.preventDefault();
          e.stopPropagation();
          resetBuffer();
          onScanRef.current(scanned);
        } else {
          resetBuffer();
        }
        return;
      }

      if (e.key.length === 1) {
        if (lastKeyTimeRef.current && elapsed > maxInterKeyDelayMs) {
          bufferRef.current = '';
        }
        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;

        if (clearTimerRef.current !== null) {
          window.clearTimeout(clearTimerRef.current);
        }
        clearTimerRef.current = window.setTimeout(resetBuffer, 260);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      resetBuffer();
    };
  }, [enabled, minLength, maxInterKeyDelayMs]);
}
