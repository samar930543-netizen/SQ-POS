import type { IScannerControls } from '@zxing/browser';

export interface CameraScannerHandle {
  stop: () => void;
  setTorch: (on: boolean) => Promise<boolean>;
  hasTorch: boolean;
  engineName: 'BarcodeDetector' | 'ZXing';
}

export async function startCameraBarcodeStream(params: {
  videoEl: HTMLVideoElement;
  facingMode?: 'environment' | 'user';
  onDetected: (code: string) => void;
  cooldownMs?: number;
}): Promise<CameraScannerHandle> {
  const { videoEl, facingMode = 'environment', onDetected, cooldownMs = 1400 } = params;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera access is unavailable in this browser context. Use a USB/Bluetooth scanner or manual barcode entry.'
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch {
    throw new Error(
      'Camera permission denied or no camera device detected. You can still scan via USB/Bluetooth scanner or type the code.'
    );
  }

  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  const capabilities =
    track && typeof track.getCapabilities === 'function'
      ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
      : null;
  const hasTorch = Boolean(capabilities?.torch);

  const setTorch = async (on: boolean): Promise<boolean> => {
    if (!track || !hasTorch) return false;
    try {
      await track.applyConstraints({
        advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
      });
      return true;
    } catch {
      return false;
    }
  };

  let lastCode = '';
  let lastTime = 0;
  const emitIfFresh = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    const now = Date.now();
    if (clean === lastCode && now - lastTime < cooldownMs) return;
    lastCode = clean;
    lastTime = now;
    onDetected(clean);
  };

  // Prefer native hardware-accelerated BarcodeDetector when browser supports standard retail formats
  const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  let useNative = false;
  if (BarcodeDetectorCtor) {
    try {
      if (typeof BarcodeDetectorCtor.getSupportedFormats === 'function') {
        const supported: string[] = await BarcodeDetectorCtor.getSupportedFormats();
        useNative = supported.some(f => f === 'ean_13' || f === 'code_128' || f === 'qr_code');
      } else {
        useNative = true;
      }
    } catch {
      useNative = false;
    }
  }

  if (useNative && BarcodeDetectorCtor) {
    let rafId: number | null = null;
    let stopped = false;
    const detector = new BarcodeDetectorCtor({
      formats: [
        'ean_13',
        'ean_8',
        'code_128',
        'code_39',
        'upc_a',
        'upc_e',
        'itf',
        'qr_code',
      ],
    });

    const scanLoop = async () => {
      if (stopped) return;
      if (videoEl.readyState >= 2) {
        try {
          const results = await detector.detect(videoEl);
          if (results && results.length > 0 && results[0]?.rawValue) {
            emitIfFresh(String(results[0].rawValue));
          }
        } catch {
          // Ignore single-frame decode misses
        }
      }
      if (!stopped) {
        rafId = requestAnimationFrame(scanLoop);
      }
    };

    rafId = requestAnimationFrame(scanLoop);

    return {
      engineName: 'BarcodeDetector',
      hasTorch,
      setTorch,
      stop: () => {
        stopped = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        stream.getTracks().forEach(t => t.stop());
        if (videoEl.srcObject === stream) {
          videoEl.srcObject = null;
        }
      },
    };
  }

  // Fallback to lazily-loaded ZXing BrowserMultiFormatReader (universal browser coverage)
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 180,
    delayBetweenScanSuccess: 900,
  });

  let controls: IScannerControls | null = null;
  let stopped = false;

  try {
    controls = await reader.decodeFromStream(stream, videoEl, (result, _error, ctrl) => {
      if (stopped) {
        ctrl?.stop();
        return;
      }
      if (result) {
        emitIfFresh(result.getText());
      }
    });
  } catch {
    // Keep camera video open cleanly even if stream decoder init had an error
  }

  return {
    engineName: 'ZXing',
    hasTorch,
    setTorch,
    stop: () => {
      stopped = true;
      try {
        controls?.stop();
      } catch {
        // ignore
      }
      stream.getTracks().forEach(t => t.stop());
      if (videoEl.srcObject === stream) {
        videoEl.srcObject = null;
      }
    },
  };
}
