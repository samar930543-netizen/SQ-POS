import express from 'express';
import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';

import sharp from 'sharp';

dotenv.config();
process.env.DISABLE_HMR = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// High body size limit to accept photos / camera images
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Initialize GoogleGenAI SDK per gemini-api guidelines
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Helper to sanitize and robustly parse JSON from Gemini (handling possible markdown blocks)
function extractJsonFromGeminiResponse(rawText: string): any {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Fall through to throw
      }
    }
    throw new Error('Failed to parse structured JSON from OCR output: ' + (err as Error).message);
  }
}

// Helper: Run a promise with a strict timeout so nothing ever hangs indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(timeoutMessage);
      (err as any).code = 'TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// Helper: Classify Gemini / network errors into actionable HTTP statuses and retryability
function classifyOcrError(
  err: any,
  context?: { clientDisconnected?: boolean; attemptTimedOut?: boolean }
): { status: number; message: string; retryable: boolean; code: string } {
  const rawMsg = String(err?.message || err || 'Unknown OCR error');
  const lowerMsg = rawMsg.toLowerCase();
  const errStatus = err?.status || err?.statusCode || err?.error?.code;

  if (context?.clientDisconnected) {
    return {
      status: 499,
      message: 'Scan was cancelled.',
      retryable: false,
      code: 'ABORTED',
    };
  }

  if (
    context?.attemptTimedOut ||
    err?.code === 'TIMEOUT' ||
    err?.name === 'AbortError' ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('aborted')
  ) {
    return {
      status: 504,
      message: 'OCR scan timed out while waiting for AI Vision. Please tap Retry or try a clearer, cropped photo.',
      retryable: true,
      code: 'TIMEOUT',
    };
  }

  if (errStatus === 403 || lowerMsg.includes('permission_denied') || lowerMsg.includes('permission denied')) {
    return {
      status: 403,
      message: 'Gemini API permission denied. Please verify your API key in the Settings > Secrets panel.',
      retryable: false,
      code: 'PERMISSION_DENIED',
    };
  }

  if (
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('invalid api key')
  ) {
    return {
      status: 400,
      message: 'Invalid Gemini API key. Please check your key in the Settings > Secrets panel.',
      retryable: false,
      code: 'API_KEY_INVALID',
    };
  }

  if (errStatus === 429 || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('quota') || lowerMsg.includes('rate limit')) {
    return {
      status: 429,
      message: 'AI Vision rate limit or quota reached. Please wait a few seconds and retry, or check your quota in Settings > Secrets.',
      retryable: true,
      code: 'RESOURCE_EXHAUSTED',
    };
  }

  if (errStatus === 404 || lowerMsg.includes('not_found') || lowerMsg.includes('is not found')) {
    return {
      status: 404,
      message: 'Requested OCR model is unavailable. Please contact support or retry shortly.',
      retryable: false,
      code: 'NOT_FOUND',
    };
  }

  if (
    lowerMsg.includes('unable to process input image') ||
    lowerMsg.includes('base64') ||
    lowerMsg.includes('mime') ||
    lowerMsg.includes('image')
  ) {
    return {
      status: 400,
      message: 'The uploaded image could not be read. Please capture a clear JPG or PNG photo of the bill.',
      retryable: false,
      code: 'INVALID_IMAGE',
    };
  }

  const isTransient =
    errStatus >= 500 ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('internal');

  return {
    status: errStatus >= 400 && errStatus < 600 ? errStatus : 500,
    message: rawMsg || 'An unexpected error occurred during bill OCR scanning.',
    retryable: isTransient,
    code: 'OCR_FAILED',
  };
}

const MAX_DECODED_BYTES = 15 * 1024 * 1024; // 15MB decoded cap
const PER_ATTEMPT_TIMEOUT_MS = 35_000;
const TOTAL_OCR_DEADLINE_MS = 55_000;

async function prepareOcrMedia(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<
  | { ok: true; cleanBase64: string; targetMimeType: string }
  | { ok: false; status: number; error: string; code: string }
> {
  const isSvg =
    imageBase64.includes('image/svg+xml') ||
    imageBase64.trim().startsWith('<svg') ||
    mimeType === 'image/svg+xml';

  const isPdf =
    mimeType === 'application/pdf' ||
    imageBase64.startsWith('data:application/pdf');

  let declaredMime = mimeType || 'image/jpeg';
  if (imageBase64.startsWith('data:')) {
    const mimeMatch = imageBase64.match(/^data:([^;,]+)/);
    if (mimeMatch?.[1]) {
      declaredMime = mimeMatch[1];
    }
  }

  let rawBuffer: Buffer;
  if (isSvg) {
    let svgString = '';
    if (imageBase64.includes(';base64,')) {
      svgString = Buffer.from(imageBase64.split(';base64,')[1], 'base64').toString('utf-8');
    } else if (imageBase64.startsWith('data:image/svg+xml;utf8,')) {
      svgString = decodeURIComponent(imageBase64.replace('data:image/svg+xml;utf8,', ''));
    } else if (imageBase64.includes(',')) {
      svgString = decodeURIComponent(imageBase64.split(',')[1]);
    } else {
      svgString = imageBase64;
    }
    rawBuffer = Buffer.from(svgString, 'utf-8');
  } else if (imageBase64.includes('base64,')) {
    rawBuffer = Buffer.from(imageBase64.split('base64,')[1].trim(), 'base64');
  } else {
    rawBuffer = Buffer.from(imageBase64.trim(), 'base64');
  }

  if (!rawBuffer || rawBuffer.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Uploaded file appears empty or corrupted. Please choose a valid image.',
      code: 'EMPTY_FILE',
    };
  }

  if (rawBuffer.length > MAX_DECODED_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'File is too large (max 15 MB). Please capture or upload a smaller photo.',
      code: 'FILE_TOO_LARGE',
    };
  }

  if (isPdf || rawBuffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return {
      ok: true,
      cleanBase64: rawBuffer.toString('base64'),
      targetMimeType: 'application/pdf',
    };
  }

  try {
    const processedBuffer = await withTimeout(
      sharp(rawBuffer, { failOn: 'none', limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
        .normalise()
        .jpeg({ quality: 78, mozjpeg: false })
        .toBuffer(),
      6_000,
      'Image preprocessing timed out.'
    );
    return {
      ok: true,
      cleanBase64: processedBuffer.toString('base64'),
      targetMimeType: 'image/jpeg',
    };
  } catch (sharpErr) {
    console.warn('Sharp preprocessing fallback:', (sharpErr as Error)?.message);
    if (isSvg) {
      return {
        ok: false,
        status: 400,
        error: 'Failed to rasterize SVG image for OCR. Please upload a PNG or JPG photo.',
        code: 'SVG_RASTER_FAILED',
      };
    }
    const supportedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    return {
      ok: true,
      cleanBase64: rawBuffer.toString('base64'),
      targetMimeType: supportedMimes.includes(declaredMime) ? declaredMime : 'image/jpeg',
    };
  }
}

// OCR Scan Bill Endpoint with fast Sharp preprocessing, PDF pass-through, and timeout-protected Gemini Vision
app.post('/api/ocr/scan-bill', async (req, res) => {
  const startedAt = Date.now();
  const requestAbortController = new AbortController();
  let clientDisconnected = false;

  // Cancel in-flight upstream AI call ONLY if the HTTP connection closes before response finishes
  res.on('close', () => {
    if (!res.writableFinished && !res.writableEnded) {
      clientDisconnected = true;
      requestAbortController.abort(new Error('Client closed connection'));
    }
  });

  try {
    const {
      imageBase64,
      mimeType = 'image/jpeg',
      existingProducts = [],
      mode = 'invoice',
    } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'No image or PDF data provided for OCR analysis.',
        code: 'MISSING_INPUT',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please configure it in the Settings > Secrets panel.',
        code: 'MISSING_API_KEY',
      });
    }

    // 1. Detect MIME & decode payload buffer safely
    const isSvg =
      imageBase64.includes('image/svg+xml') ||
      imageBase64.trim().startsWith('<svg') ||
      mimeType === 'image/svg+xml';

    const isPdf =
      mimeType === 'application/pdf' ||
      imageBase64.startsWith('data:application/pdf');

    let declaredMime = mimeType || 'image/jpeg';
    if (imageBase64.startsWith('data:')) {
      const mimeMatch = imageBase64.match(/^data:([^;,]+)/);
      if (mimeMatch?.[1]) {
        declaredMime = mimeMatch[1];
      }
    }

    let rawBuffer: Buffer;
    if (isSvg) {
      let svgString = '';
      if (imageBase64.includes(';base64,')) {
        svgString = Buffer.from(imageBase64.split(';base64,')[1], 'base64').toString('utf-8');
      } else if (imageBase64.startsWith('data:image/svg+xml;utf8,')) {
        svgString = decodeURIComponent(imageBase64.replace('data:image/svg+xml;utf8,', ''));
      } else if (imageBase64.includes(',')) {
        svgString = decodeURIComponent(imageBase64.split(',')[1]);
      } else {
        svgString = imageBase64;
      }
      rawBuffer = Buffer.from(svgString, 'utf-8');
    } else if (imageBase64.includes('base64,')) {
      rawBuffer = Buffer.from(imageBase64.split('base64,')[1].trim(), 'base64');
    } else {
      rawBuffer = Buffer.from(imageBase64.trim(), 'base64');
    }

    if (!rawBuffer || rawBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Uploaded file appears empty or corrupted. Please choose a valid bill image.',
        code: 'EMPTY_FILE',
      });
    }

    if (rawBuffer.length > MAX_DECODED_BYTES) {
      return res.status(413).json({
        success: false,
        error: 'File is too large (max 15 MB). Please capture or upload a smaller bill photo.',
        code: 'FILE_TOO_LARGE',
      });
    }

    // 2. Fast Image Preprocessing (skip Sharp for PDFs)
    let cleanBase64 = '';
    let targetMimeType = 'image/jpeg';

    if (isPdf || rawBuffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      cleanBase64 = rawBuffer.toString('base64');
      targetMimeType = 'application/pdf';
    } else {
      try {
        // Fast OCR optimization: 1280px max edge, auto-EXIF orientation, mild contrast normalization, baseline JPEG 78
        const processedBuffer = await withTimeout(
          sharp(rawBuffer, { failOn: 'none', limitInputPixels: 40_000_000 })
            .rotate()
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .normalise()
            .jpeg({ quality: 78, mozjpeg: false })
            .toBuffer(),
          6_000,
          'Image preprocessing timed out.'
        );
        cleanBase64 = processedBuffer.toString('base64');
        targetMimeType = 'image/jpeg';
      } catch (sharpErr) {
        console.warn('Sharp preprocessing fallback:', (sharpErr as Error)?.message);
        if (isSvg) {
          return res.status(400).json({
            success: false,
            error: 'Failed to rasterize SVG image for OCR. Please upload a PNG or JPG photo.',
            code: 'SVG_RASTER_FAILED',
          });
        }
        const supportedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        targetMimeType = supportedMimes.includes(declaredMime) ? declaredMime : 'image/jpeg';
        cleanBase64 = rawBuffer.toString('base64');
      }
    }

    if (clientDisconnected) return;

    // 3. Compact catalogue context (keeps prompt small and inference fast)
    const catalogContext =
      Array.isArray(existingProducts) && existingProducts.length > 0
        ? existingProducts
            .slice(0, 60)
            .map((p: any) => `${p.name} (${p.bundleUnitName || 'Bdl'}=${p.bundlePieces || 1}p)`)
            .join(', ')
        : 'None';

    const systemInstruction = `Bilingual Indian wholesale & kirana OCR (English + Hindi Devanagari/Hinglish, printed or handwritten slips).
Extract line items into strict JSON:
- Read handwritten cursive English, Hindi Devanagari (e.g. चीनी, तेल, साबुन, चाय पत्ती, बिस्कुट, आटा), and Hindi/English numerals as Western numbers. Ignore crossed-out lines.
- If Hindi, put original slip text in "originalText" and clean bilingual/English+Hindi label in "productName".
- unitType: "bundle" (Peti/पेटी, Bundle/बंडल, Carton/कार्टन, Box, Dozen, Bora/बोरा, Tin, Tray) or "piece" (Piece, Nag/नग, Pkt/पैकेट, Kg/किलो, Ltr, Gm).
- Calculate missing unitPrice = totalPrice/quantity or totalPrice = quantity*unitPrice.
- Skip totals/tax rows (Subtotal, Total, कुल, बाकी, Balance, CGST/SGST).
- Extract top/bottom metadata when visible: customerName (party name after नाम/Party/To/M/s), customerPhone (10-digit mobile after Mob/Ph), vendorName, invoiceNumber, invoiceDate, totalAmount (grand total after कुल/Total), amountPaid (cash paid after जमा/Paid), detectedLanguage ("english"|"hindi"|"bilingual"), isHandwritten.
Catalog: ${catalogContext}`;

    const promptText =
      mode === 'restock'
        ? `Extract purchased items, quantities, units, piece multipliers, rates, and vendor metadata.`
        : `Extract customer details, items (EN/HI), quantities, units, rates, line totals, and paid amount.`;

    // 4. Primary OCR via gemini-3.1-flash-lite (ThinkingLevel.MINIMAL = zero thinking delay),
    //    with gemini-4-hydrogen (ThinkingLevel.LOW) fallback on retry if transient timeout/error occurs
    let geminiResponse: any = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (clientDisconnected) return;

      const usePrimaryLite = attempt === 1;
      const targetModel = usePrimaryLite ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
      const targetThinking = usePrimaryLite ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

      const elapsed = Date.now() - startedAt;
      const remainingBudget = TOTAL_OCR_DEADLINE_MS - elapsed;
      if (remainingBudget <= 2_000) {
        const deadlineErr = new Error('OCR request exceeded maximum processing time.');
        (deadlineErr as any).code = 'TIMEOUT';
        throw deadlineErr;
      }

      const attemptTimeout = Math.min(usePrimaryLite ? 20_000 : PER_ATTEMPT_TIMEOUT_MS, remainingBudget);
      const attemptController = new AbortController();
      let attemptTimedOut = false;
      const onParentAbort = () => attemptController.abort(requestAbortController.signal.reason);
      requestAbortController.signal.addEventListener('abort', onParentAbort, { once: true });

      const timeoutHandle = setTimeout(() => {
        attemptTimedOut = true;
        const err = new Error(`AI Vision attempt ${attempt} timed out after ${Math.round(attemptTimeout / 1000)}s`);
        (err as any).code = 'TIMEOUT';
        attemptController.abort(err);
      }, attemptTimeout);

      try {
        geminiResponse = await withTimeout(
          ai.models.generateContent({
            model: targetModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: targetMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: promptText,
                },
              ],
            },
            config: {
              abortSignal: attemptController.signal,
              thinkingConfig: { thinkingLevel: targetThinking },
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vendorName: { type: Type.STRING, description: 'Supplier or vendor name if printed/written' },
                  customerName: { type: Type.STRING, description: 'Customer or buyer name written on manual bill/slip' },
                  customerPhone: { type: Type.STRING, description: 'Customer phone/mobile number if visible' },
                  invoiceNumber: { type: Type.STRING, description: 'Invoice, slip, or challan number' },
                  invoiceDate: { type: Type.STRING, description: 'Date on the bill or slip' },
                  totalAmount: { type: Type.NUMBER, description: 'Grand total on the bill' },
                  amountPaid: { type: Type.NUMBER, description: 'Cash/amount already paid or jama written on bill' },
                  detectedLanguage: { type: Type.STRING, description: 'english, hindi, or bilingual' },
                  isHandwritten: { type: Type.BOOLEAN, description: 'True if handwritten or manual paper slip' },
                  items: {
                    type: Type.ARRAY,
                    description: 'List of detected line items with quantities, units, and prices',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        productName: { type: Type.STRING, description: 'Clean product name (include English+Hindi if Hindi)' },
                        originalText: { type: Type.STRING, description: 'Original raw text from the slip if Hindi or handwritten' },
                        quantity: { type: Type.NUMBER, description: 'Quantity as a positive number' },
                        unitType: { type: Type.STRING, description: 'bundle or piece' },
                        unitName: { type: Type.STRING, description: 'Unit label like Bundle, Peti, Carton, Kg, Pkt, Piece, नग' },
                        bundlePieces: { type: Type.NUMBER, description: 'Pieces per bundle/carton if bundle, or 1 for loose pieces' },
                        unitPrice: { type: Type.NUMBER, description: 'Rate per unit in INR' },
                        totalPrice: { type: Type.NUMBER, description: 'Total line amount in INR' },
                        confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
                      },
                      required: ['productName', 'quantity', 'unitType', 'bundlePieces'],
                    },
                  },
                },
                required: ['items'],
              },
            },
          }),
          attemptTimeout + 500,
          `AI Vision timed out after ${Math.round(attemptTimeout / 1000)}s.`
        );

        if (geminiResponse) break;
      } catch (apiErr: any) {
        const classified = classifyOcrError(apiErr, { clientDisconnected, attemptTimedOut });

        if (!classified.retryable || attempt >= maxAttempts || clientDisconnected) {
          console.warn(`Gemini OCR attempt ${attempt}/${maxAttempts} failed (${classified.code}):`, classified.message);
          throw apiErr;
        }

        console.info(`Retrying Gemini OCR after attempt ${attempt}/${maxAttempts} (${classified.code})...`);

        // Brief exponential backoff with jitter before retry
        const backoffMs = Math.min(400 * attempt + Math.floor(Math.random() * 200), 1_200);
        if (Date.now() - startedAt + backoffMs + 3_000 >= TOTAL_OCR_DEADLINE_MS) {
          throw apiErr;
        }
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } finally {
        clearTimeout(timeoutHandle);
        requestAbortController.signal.removeEventListener('abort', onParentAbort);
      }
    }

    if (clientDisconnected || res.writableEnded) return;

    const responseText = geminiResponse?.text || '{}';
    const parsedData = extractJsonFromGeminiResponse(responseText);

    if (!parsedData || !Array.isArray(parsedData.items)) {
      return res.status(422).json({
        success: false,
        error: 'OCR read the document but found no product line items. Try a clearer, well-lit photo of the bill or paper slip.',
        code: 'NO_ITEMS_FOUND',
      });
    }

    // Reconcile missing unitPrice / totalPrice math & sanitize phone digits
    parsedData.items = parsedData.items.map((item: any) => {
      const qty = Math.max(0.01, Number(item.quantity) || 1);
      const rawUnit = Number(item.unitPrice);
      const rawTotal = Number(item.totalPrice);

      let unitPrice = Number.isFinite(rawUnit) && rawUnit >= 0 ? rawUnit : 0;
      let totalPrice = Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : 0;

      if (unitPrice === 0 && totalPrice > 0) {
        unitPrice = Math.round((totalPrice / qty) * 100) / 100;
      } else if (totalPrice === 0 && unitPrice > 0) {
        totalPrice = Math.round(qty * unitPrice * 100) / 100;
      }

      return {
        ...item,
        quantity: qty,
        unitType: item.unitType === 'bundle' ? 'bundle' : 'piece',
        bundlePieces: Math.max(1, Number(item.bundlePieces) || 1),
        unitPrice,
        totalPrice,
        confidence: Math.min(1, Math.max(0.1, Number(item.confidence) || 0.9)),
      };
    });

    if (parsedData.customerPhone) {
      const digits = String(parsedData.customerPhone).replace(/\D/g, '');
      parsedData.customerPhone = digits.length > 10 ? digits.slice(-10) : digits;
    }

    const processingTimeMs = Date.now() - startedAt;
    return res.json({
      success: true,
      data: parsedData,
      processingTimeMs,
    });
  } catch (err: any) {
    if (clientDisconnected || res.writableEnded) return;
    const classified = classifyOcrError(err, { clientDisconnected });
    console.error('OCR scan bill error:', classified.code, classified.message);
    return res.status(classified.status === 499 ? 408 : classified.status).json({
      success: false,
      error: classified.message,
      code: classified.code,
      retryable: classified.retryable,
    });
  }
});

// OCR Scan Physical Expense Receipt Endpoint (English + Hindi, printed thermal slips or handwritten vouchers)
app.post('/api/ocr/scan-expense', async (req, res) => {
  const startedAt = Date.now();
  const requestAbortController = new AbortController();
  let clientDisconnected = false;

  res.on('close', () => {
    if (!res.writableFinished && !res.writableEnded) {
      clientDisconnected = true;
      requestAbortController.abort(new Error('Client closed connection'));
    }
  });

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'No receipt image or PDF provided for expense OCR.',
        code: 'MISSING_INPUT',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please configure it in the Settings > Secrets panel.',
        code: 'MISSING_API_KEY',
      });
    }

    const media = await prepareOcrMedia(imageBase64, mimeType);
    if (media.ok === false) {
      return res.status(media.status).json({
        success: false,
        error: media.error,
        code: media.code,
      });
    }

    if (clientDisconnected) return;

    const systemInstruction = `Indian retail/wholesale business expense receipt OCR (English + Hindi Devanagari/Hinglish, thermal receipts, fuel/freight slips, utility bills, or handwritten petty cash vouchers).
Extract structured JSON:
- suggestedCategory MUST be exactly one of: "Transport & Freight", "Staff Wages", "Rent & Utilities", "Packaging & Supplies", "Tea & Petty Cash", "Maintenance", "Other Expense".
- paymentMode MUST be one of: "cash", "upi", "bank" (detect UPI/GPay/PhonePe/Paytm/QR -> "upi"; NEFT/Card/Cheque -> "bank"; default -> "cash").
- receiptDate: Normalize date to YYYY-MM-DD if visible, otherwise empty string.
- title: Short 3-6 word clear description of the expense (in English, include merchant if helpful).
- totalAmount: Grand total paid in INR (Western digits).
- lineItems: Individual charge lines if multiple items are listed on the receipt (description, amount).`;

    let geminiResponse: any = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (clientDisconnected) return;

      const usePrimaryLite = attempt === 1;
      const targetModel = usePrimaryLite ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
      const targetThinking = usePrimaryLite ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

      const elapsed = Date.now() - startedAt;
      const remainingBudget = TOTAL_OCR_DEADLINE_MS - elapsed;
      if (remainingBudget <= 2_000) {
        const deadlineErr = new Error('Expense OCR exceeded maximum processing time.');
        (deadlineErr as any).code = 'TIMEOUT';
        throw deadlineErr;
      }

      const attemptTimeout = Math.min(usePrimaryLite ? 20_000 : PER_ATTEMPT_TIMEOUT_MS, remainingBudget);
      const attemptController = new AbortController();
      let attemptTimedOut = false;
      const onParentAbort = () => attemptController.abort(requestAbortController.signal.reason);
      requestAbortController.signal.addEventListener('abort', onParentAbort, { once: true });

      const timeoutHandle = setTimeout(() => {
        attemptTimedOut = true;
        const err = new Error(`AI Vision expense attempt ${attempt} timed out after ${Math.round(attemptTimeout / 1000)}s`);
        (err as any).code = 'TIMEOUT';
        attemptController.abort(err);
      }, attemptTimeout);

      try {
        geminiResponse = await withTimeout(
          ai.models.generateContent({
            model: targetModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: media.targetMimeType,
                    data: media.cleanBase64,
                  },
                },
                {
                  text: 'Extract merchant, date, receipt number, expense category, payment mode, total amount, and itemized charges from this receipt.',
                },
              ],
            },
            config: {
              abortSignal: attemptController.signal,
              thinkingConfig: { thinkingLevel: targetThinking },
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  merchantName: { type: Type.STRING },
                  receiptDate: { type: Type.STRING, description: 'YYYY-MM-DD if visible' },
                  receiptNumber: { type: Type.STRING },
                  paymentMode: { type: Type.STRING, description: 'cash, upi, or bank' },
                  suggestedCategory: {
                    type: Type.STRING,
                    description:
                      'One of: Transport & Freight, Staff Wages, Rent & Utilities, Packaging & Supplies, Tea & Petty Cash, Maintenance, Other Expense',
                  },
                  title: { type: Type.STRING },
                  totalAmount: { type: Type.NUMBER },
                  detectedLanguage: { type: Type.STRING },
                  isHandwritten: { type: Type.BOOLEAN },
                  notes: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  lineItems: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        description: { type: Type.STRING },
                        amount: { type: Type.NUMBER },
                      },
                      required: ['description', 'amount'],
                    },
                  },
                },
                required: ['title', 'totalAmount', 'suggestedCategory', 'paymentMode'],
              },
            },
          }),
          attemptTimeout + 500,
          `Expense OCR timed out after ${Math.round(attemptTimeout / 1000)}s.`
        );

        if (geminiResponse) break;
      } catch (apiErr: any) {
        const classified = classifyOcrError(apiErr, { clientDisconnected, attemptTimedOut });
        if (!classified.retryable || attempt >= maxAttempts || clientDisconnected) {
          console.warn(`Expense OCR attempt ${attempt}/${maxAttempts} failed (${classified.code}):`, classified.message);
          throw apiErr;
        }
        const backoffMs = Math.min(400 * attempt + Math.floor(Math.random() * 200), 1_200);
        if (Date.now() - startedAt + backoffMs + 3_000 >= TOTAL_OCR_DEADLINE_MS) {
          throw apiErr;
        }
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } finally {
        clearTimeout(timeoutHandle);
        requestAbortController.signal.removeEventListener('abort', onParentAbort);
      }
    }

    if (clientDisconnected || res.writableEnded) return;

    const parsed = extractJsonFromGeminiResponse(geminiResponse?.text || '{}');
    const validCategories = [
      'Transport & Freight',
      'Staff Wages',
      'Rent & Utilities',
      'Packaging & Supplies',
      'Tea & Petty Cash',
      'Maintenance',
      'Other Expense',
    ];

    const lineItems = Array.isArray(parsed?.lineItems)
      ? parsed.lineItems
          .map((li: any) => ({
            description: String(li?.description || 'Expense Item').trim(),
            amount: Math.max(0, Number(li?.amount) || 0),
          }))
          .filter((li: any) => li.amount > 0)
      : [];

    const lineSum = lineItems.reduce((s: number, li: any) => s + li.amount, 0);
    const totalAmount = Math.max(0, Number(parsed?.totalAmount) || lineSum || 0);

    if (totalAmount <= 0 && lineItems.length === 0) {
      return res.status(422).json({
        success: false,
        error: 'Could not detect a valid expense total on this receipt. Please try a clearer photo.',
        code: 'NO_AMOUNT_FOUND',
      });
    }

    const rawMode = String(parsed?.paymentMode || 'cash').toLowerCase();
    const paymentMode = rawMode === 'upi' ? 'upi' : rawMode === 'bank' ? 'bank' : 'cash';
    const suggestedCategory = validCategories.includes(parsed?.suggestedCategory)
      ? parsed.suggestedCategory
      : 'Other Expense';

    const cleanDate =
      typeof parsed?.receiptDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.receiptDate.trim())
        ? parsed.receiptDate.trim()
        : '';

    return res.json({
      success: true,
      data: {
        merchantName: parsed?.merchantName ? String(parsed.merchantName).trim() : '',
        receiptDate: cleanDate,
        receiptNumber: parsed?.receiptNumber ? String(parsed.receiptNumber).trim() : '',
        paymentMode,
        suggestedCategory,
        title: String(parsed?.title || parsed?.merchantName || suggestedCategory).trim(),
        totalAmount: Math.round(totalAmount * 100) / 100,
        detectedLanguage: parsed?.detectedLanguage || 'english',
        isHandwritten: Boolean(parsed?.isHandwritten),
        notes: parsed?.notes ? String(parsed.notes).trim() : '',
        lineItems,
        confidence: Math.min(1, Math.max(0.1, Number(parsed?.confidence) || 0.9)),
      },
      processingTimeMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    if (clientDisconnected || res.writableEnded) return;
    const classified = classifyOcrError(err, { clientDisconnected });
    console.error('OCR scan expense error:', classified.code, classified.message);
    return res.status(classified.status === 499 ? 408 : classified.status).json({
      success: false,
      error: classified.message,
      code: classified.code,
      retryable: classified.retryable,
    });
  }
});

// =========================================================================
// AUDIO TRANSCRIPTION (gemini-3.5-transcribe) & ITEM LIST PARSER
// =========================================================================
const AUDIO_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const AUDIO_LIST_PARSER_MODEL = 'gemini-4-hydrogen';
const MAX_AUDIO_DECODED_BYTES = 15 * 1024 * 1024; // 15 MB audio cap
const AUDIO_TRANSCRIBE_DEADLINE_MS = 60_000;

function normalizeAudioMimeType(rawMime: string | undefined, fileName?: string): string {
  const base = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'video/webm') return 'audio/webm';
  if (base === 'audio/mpeg') return 'audio/mp3';
  if (base.startsWith('audio/')) return base;

  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
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
      return 'audio/webm';
  }
}

function classifyAudioError(
  err: any,
  context?: { clientDisconnected?: boolean; attemptTimedOut?: boolean }
): { status: number; message: string; retryable: boolean; code: string } {
  const rawMsg = String(err?.message || err || 'Unknown audio transcription error');
  const lowerMsg = rawMsg.toLowerCase();
  const errStatus = err?.status || err?.statusCode || err?.error?.code;

  if (context?.clientDisconnected) {
    return {
      status: 499,
      message: 'Audio transcription was cancelled.',
      retryable: false,
      code: 'ABORTED',
    };
  }

  if (
    context?.attemptTimedOut ||
    err?.code === 'TIMEOUT' ||
    err?.name === 'AbortError' ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('aborted')
  ) {
    return {
      status: 504,
      message: 'Audio transcription timed out. Please try a shorter recording or tap Retry.',
      retryable: true,
      code: 'TIMEOUT',
    };
  }

  if (errStatus === 403 || lowerMsg.includes('permission_denied') || lowerMsg.includes('permission denied')) {
    return {
      status: 403,
      message: 'Gemini API permission denied. Please verify your API key in the Settings > Secrets panel.',
      retryable: false,
      code: 'PERMISSION_DENIED',
    };
  }

  if (
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('invalid api key')
  ) {
    return {
      status: 400,
      message: 'Invalid Gemini API key. Please check your key in the Settings > Secrets panel.',
      retryable: false,
      code: 'API_KEY_INVALID',
    };
  }

  if (errStatus === 429 || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('quota') || lowerMsg.includes('rate limit')) {
    return {
      status: 429,
      message: 'Gemini quota or rate limit reached. Please wait a few seconds and retry, or check Settings > Secrets.',
      retryable: true,
      code: 'RESOURCE_EXHAUSTED',
    };
  }

  if (errStatus === 404 || lowerMsg.includes('not_found') || lowerMsg.includes('is not found')) {
    return {
      status: 404,
      message: 'Requested transcription model (gemini-3.5-transcribe) is unavailable right now.',
      retryable: false,
      code: 'NOT_FOUND',
    };
  }

  if (
    lowerMsg.includes('unsupported mime') ||
    lowerMsg.includes('unable to process') ||
    lowerMsg.includes('invalid audio') ||
    lowerMsg.includes('base64')
  ) {
    return {
      status: 400,
      message: 'The audio file format could not be processed. Please upload an MP3, WAV, M4A, OGG, or WebM recording.',
      retryable: false,
      code: 'INVALID_AUDIO',
    };
  }

  const isTransient =
    errStatus >= 500 ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('internal');

  return {
    status: errStatus >= 400 && errStatus < 600 ? errStatus : 500,
    message: rawMsg || 'An unexpected error occurred during audio transcription.',
    retryable: isTransient,
    code: 'TRANSCRIBE_FAILED',
  };
}

async function parseTranscriptToItemList(
  transcript: string,
  existingProducts: any[] = [],
  mode: string = 'cart',
  signal?: AbortSignal
): Promise<{
  listTitle: string;
  detectedLanguage: string;
  items: Array<{
    productName: string;
    spokenText: string;
    quantity: number;
    unitType: 'bundle' | 'piece';
    unitName: string;
    bundlePieces: number;
    unitPrice: number;
    notes: string;
  }>;
}> {
  const catalogContext =
    Array.isArray(existingProducts) && existingProducts.length > 0
      ? existingProducts
          .slice(0, 80)
          .map(
            (p: any) =>
              `${p.name} [${p.bundleUnitName || 'Bundle'}=${p.bundlePieces || 1}pcs, Bdl₹${p.bundlePrice || 0}, Pcs₹${p.piecePrice || 0}]`
          )
          .join('; ')
      : 'None';

  const systemInstruction = `You convert spoken transcripts (English, Hindi, Hinglish, or grocery/FMCG wholesale/retail dictation) into a clean, structured item list.
Rules:
- Extract every product, supply, or item mentioned along with its quantity, unit, and optional spoken rate/price.
- Resolve Hindi/English number words (e.g., ek=1, do=2, teen=3, char=4, paanch=5, das=10, half dozen=6, one dozen=12) to numbers.
- Set unitType to "bundle" when the speaker specifies bulk packaging (bundle, peti, carton, box, case, bora, pack/pack-case matched to bundle) and "piece" for single/loose units (piece, pcs, nag, pkt, packet, kg, gm, liter, bottle, tin, bar).
- Prefer matching product names from the Catalog list when clearly referring to a catalog item, while preserving custom item names if not in catalog.
- Ignore filler chatter like "hello", "please send", "thank you", "total kitna hua".
- Suggest a short 2-5 word listTitle reflecting the transcript context (mode: ${mode}).
Catalog: ${catalogContext}`;

  const parseResponse = await withTimeout(
    ai.models.generateContent({
      model: AUDIO_LIST_PARSER_MODEL,
      contents: {
        parts: [
          {
            text: `Extract a structured item list from this spoken transcript:\n"""\n${transcript}\n"""`,
          },
        ],
      },
      config: {
        abortSignal: signal,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            listTitle: { type: Type.STRING, description: 'Short 2-5 word title for this item list' },
            detectedLanguage: { type: Type.STRING, description: 'english, hindi, or bilingual' },
            items: {
              type: Type.ARRAY,
              description: 'Ordered array of items mentioned in the transcript',
              items: {
                type: Type.OBJECT,
                properties: {
                  productName: { type: Type.STRING, description: 'Clean product or item name' },
                  spokenText: { type: Type.STRING, description: 'Original phrase from the transcript for this item' },
                  quantity: { type: Type.NUMBER, description: 'Positive numeric quantity (default 1 if omitted)' },
                  unitType: { type: Type.STRING, description: 'bundle or piece' },
                  unitName: { type: Type.STRING, description: 'Spoken unit label e.g. Bundle, Peti, Carton, Box, Packet, Piece, Kg' },
                  bundlePieces: { type: Type.NUMBER, description: 'Pieces per bundle if known, otherwise 1' },
                  unitPrice: { type: Type.NUMBER, description: 'Spoken unit rate in INR if mentioned, else 0' },
                  notes: { type: Type.STRING, description: 'Any brand variant, size, or instruction mentioned' },
                },
                required: ['productName', 'quantity', 'unitType', 'unitName'],
              },
            },
          },
          required: ['items'],
        },
      },
    }),
    22_000,
    'Item list extraction timed out.'
  );

  const parsed = extractJsonFromGeminiResponse(parseResponse?.text || '{}');
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

  return {
    listTitle: String(parsed?.listTitle || '').trim(),
    detectedLanguage: String(parsed?.detectedLanguage || 'english').trim().toLowerCase(),
    items: rawItems
      .map((item: any) => ({
        productName: String(item?.productName || '').trim(),
        spokenText: String(item?.spokenText || '').trim(),
        quantity: Math.max(1, Number(item?.quantity) || 1),
        unitType: (String(item?.unitType || '').toLowerCase() === 'bundle' ? 'bundle' : 'piece') as
          | 'bundle'
          | 'piece',
        unitName: String(item?.unitName || (item?.unitType === 'bundle' ? 'Bundle' : 'Piece')).trim(),
        bundlePieces: Math.max(1, Number(item?.bundlePieces) || 1),
        unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
        notes: String(item?.notes || '').trim(),
      }))
      .filter((i: any) => i.productName.length > 0),
  };
}

app.post('/api/audio/transcribe', async (req, res) => {
  const startedAt = Date.now();
  const requestAbortController = new AbortController();
  let clientDisconnected = false;

  res.on('close', () => {
    if (!res.writableFinished && !res.writableEnded) {
      clientDisconnected = true;
      requestAbortController.abort(new Error('Client closed connection'));
    }
  });

  try {
    const {
      audioBase64,
      mimeType,
      fileName,
      existingProducts = [],
      mode = 'cart',
    } = req.body || {};

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'No audio data provided for transcription.',
        code: 'MISSING_INPUT',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please configure it in the Settings > Secrets panel.',
        code: 'MISSING_API_KEY',
      });
    }

    let declaredMime = mimeType;
    if (!declaredMime && audioBase64.startsWith('data:')) {
      const m = audioBase64.match(/^data:([^;,]+)/);
      if (m?.[1]) declaredMime = m[1];
    }
    const cleanMimeType = normalizeAudioMimeType(declaredMime, fileName);

    const rawBase64 = audioBase64.includes('base64,')
      ? audioBase64.split('base64,')[1].trim()
      : audioBase64.trim();

    const audioBuffer = Buffer.from(rawBase64, 'base64');
    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'The uploaded or recorded audio is empty. Please record again or choose another file.',
        code: 'EMPTY_FILE',
      });
    }

    if (audioBuffer.length > MAX_AUDIO_DECODED_BYTES) {
      return res.status(413).json({
        success: false,
        error: 'Audio file exceeds the 15 MB limit. Please upload a shorter or compressed audio clip.',
        code: 'FILE_TOO_LARGE',
      });
    }

    const cleanBase64 = audioBuffer.toString('base64');

    // Step 1: Transcribe audio using gemini-3.5-transcribe
    let transcribeResponse: any = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (clientDisconnected) return;

      const elapsed = Date.now() - startedAt;
      const remaining = AUDIO_TRANSCRIBE_DEADLINE_MS - elapsed;
      if (remaining <= 2_000) {
        const timeoutErr = new Error('Audio transcription exceeded processing deadline.');
        (timeoutErr as any).code = 'TIMEOUT';
        throw timeoutErr;
      }

      const attemptTimeout = Math.min(35_000, remaining);
      const attemptController = new AbortController();
      let attemptTimedOut = false;
      const onParentAbort = () => attemptController.abort(requestAbortController.signal.reason);
      requestAbortController.signal.addEventListener('abort', onParentAbort, { once: true });

      const timer = setTimeout(() => {
        attemptTimedOut = true;
        const err = new Error(`Audio transcription timed out after ${Math.round(attemptTimeout / 1000)}s`);
        (err as any).code = 'TIMEOUT';
        attemptController.abort(err);
      }, attemptTimeout);

      try {
        transcribeResponse = await withTimeout(
          ai.models.generateContent({
            model: AUDIO_TRANSCRIBE_MODEL,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: 'Transcribe this audio accurately. Preserve all product names, brand names, quantities, unit words (bundle, peti, carton, box, packet, piece, kg, liter, dozen), numbers, and prices as spoken.',
                },
              ],
            },
            config: {
              abortSignal: attemptController.signal,
            },
          }),
          attemptTimeout + 500,
          `Audio transcription timed out after ${Math.round(attemptTimeout / 1000)}s.`
        );

        if (transcribeResponse) break;
      } catch (apiErr: any) {
        const classified = classifyAudioError(apiErr, { clientDisconnected, attemptTimedOut });
        if (!classified.retryable || attempt >= maxAttempts || clientDisconnected) {
          console.warn(
            `Gemini transcribe attempt ${attempt}/${maxAttempts} failed (${classified.code}):`,
            classified.message
          );
          throw apiErr;
        }
        const backoffMs = Math.min(500 * attempt, 1_200);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } finally {
        clearTimeout(timer);
        requestAbortController.signal.removeEventListener('abort', onParentAbort);
      }
    }

    if (clientDisconnected || res.writableEnded) return;

    const transcript = (transcribeResponse?.text || '').trim();
    if (!transcript) {
      return res.status(422).json({
        success: false,
        error: 'No speech was detected in this audio. Please try speaking closer to the microphone or uploading a clearer recording.',
        code: 'EMPTY_TRANSCRIPT',
      });
    }

    // Step 2: Convert transcript into structured item list entries
    let parsedList: {
      listTitle: string;
      detectedLanguage: string;
      items: any[];
    } = {
      listTitle: '',
      detectedLanguage: 'english',
      items: [],
    };
    let parseWarning: string | undefined;

    try {
      parsedList = await parseTranscriptToItemList(
        transcript,
        existingProducts,
        mode,
        requestAbortController.signal
      );
    } catch (parseErr: any) {
      console.warn('Transcript item-list extraction warning:', parseErr?.message || parseErr);
      parseWarning =
        'Audio transcribed cleanly, but automatic item extraction had a hiccup. You can edit the text and tap Re-Extract List.';
    }

    if (clientDisconnected || res.writableEnded) return;

    return res.json({
      success: true,
      model: AUDIO_TRANSCRIBE_MODEL,
      transcript,
      listTitle: parsedList.listTitle,
      detectedLanguage: parsedList.detectedLanguage,
      items: parsedList.items,
      parseWarning,
      processingTimeMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    if (clientDisconnected || res.writableEnded) return;
    const classified = classifyAudioError(err, { clientDisconnected });
    console.error('Audio transcribe error:', classified.code, classified.message);
    return res.status(classified.status === 499 ? 408 : classified.status).json({
      success: false,
      error: classified.message,
      code: classified.code,
      retryable: classified.retryable,
    });
  }
});

app.post('/api/audio/parse-list', async (req, res) => {
  const requestAbortController = new AbortController();
  let clientDisconnected = false;

  res.on('close', () => {
    if (!res.writableFinished && !res.writableEnded) {
      clientDisconnected = true;
      requestAbortController.abort(new Error('Client closed connection'));
    }
  });

  try {
    const { transcript, existingProducts = [], mode = 'cart' } = req.body || {};
    const cleanTranscript = typeof transcript === 'string' ? transcript.trim() : '';

    if (!cleanTranscript) {
      return res.status(400).json({
        success: false,
        error: 'Please enter or transcribe some text before extracting items.',
        code: 'MISSING_TRANSCRIPT',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please configure it in the Settings > Secrets panel.',
        code: 'MISSING_API_KEY',
      });
    }

    const parsedList = await parseTranscriptToItemList(
      cleanTranscript,
      existingProducts,
      mode,
      requestAbortController.signal
    );

    if (clientDisconnected || res.writableEnded) return;

    return res.json({
      success: true,
      listTitle: parsedList.listTitle,
      detectedLanguage: parsedList.detectedLanguage,
      items: parsedList.items,
    });
  } catch (err: any) {
    if (clientDisconnected || res.writableEnded) return;
    const classified = classifyAudioError(err, { clientDisconnected });
    console.error('Audio parse-list error:', classified.code, classified.message);
    return res.status(classified.status === 499 ? 408 : classified.status).json({
      success: false,
      error: classified.message,
      code: classified.code,
      retryable: classified.retryable,
    });
  }
});

// =========================================================================
// OFFLINE MODE & BACKGROUND SYNC SERVER STORE
// =========================================================================
const SYNC_STORE_PATH = path.resolve(__dirname, '.sq-sync-store.json');

interface ServerSyncStore {
  revision: number;
  lastSyncedAt: string | null;
  syncedOperationIds: string[];
  bills: any[];
  khata: any[];
  customers: any[];
  products: any[];
  suppliers: any[];
  purchaseOrders: any[];
  cashFlowEntries: any[];
  openingCashMap: Record<string, number>;
  loyaltyTransactions: any[];
  staffMembers: any[];
  attendanceRecords: any[];
  storeProfile?: any;
  whatsappConfig: {
    enabled: boolean;
    autoConfirmOrders: boolean;
    autoDeductStock: boolean;
    autoReplyInquiries: boolean;
    defaultOrderPaymentMode: 'cash' | 'credit';
    businessPhoneNumberId: string;
    businessAccountId?: string;
    verifyToken: string;
    greetingTemplate?: string;
    lastWebhookAt?: string;
  };
  whatsappMessages: any[];
  externalApiConfig?: {
    enabled: boolean;
  };
  externalInventoryAdjustments?: any[];
  multiBranchConfig?: {
    enabled: boolean;
    activeBranchId: string;
    syncCatalogAcrossBranches: boolean;
    syncInventoryTransfers: boolean;
    syncCustomersAndKhata: boolean;
    autoSyncIntervalSec: number;
    lastBranchSyncAt?: string;
    lastBranchSyncNote?: string;
  };
  branches?: any[];
  branchSnapshots?: Record<string, any>;
  branchTransfers?: any[];
}

function createEmptySyncStore(): ServerSyncStore {
  const nowIso = new Date().toISOString();
  return {
    revision: 0,
    lastSyncedAt: null,
    syncedOperationIds: [],
    bills: [],
    khata: [],
    customers: [],
    products: [],
    suppliers: [],
    purchaseOrders: [],
    cashFlowEntries: [],
    openingCashMap: {},
    loyaltyTransactions: [],
    staffMembers: [],
    attendanceRecords: [],
    storeProfile: undefined,
    whatsappConfig: {
      enabled: true,
      autoConfirmOrders: false,
      autoDeductStock: true,
      autoReplyInquiries: true,
      defaultOrderPaymentMode: 'credit',
      businessPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      businessAccountId: '',
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'sq_pos_whatsapp_verify',
      greetingTemplate: 'Namaste! Welcome to SQ Enterprises. Send your wholesale order or rate inquiry.',
    },
    whatsappMessages: [],
    externalApiConfig: {
      enabled: true,
    },
    externalInventoryAdjustments: [],
    multiBranchConfig: {
      enabled: true,
      activeBranchId: 'branch_hq',
      syncCatalogAcrossBranches: true,
      syncInventoryTransfers: true,
      syncCustomersAndKhata: true,
      autoSyncIntervalSec: 30,
    },
    branches: [
      {
        id: 'branch_hq',
        code: 'HQ-01',
        name: 'SQ ENTERPRISES (Main HQ)',
        city: 'Main Depot',
        isHeadquarters: true,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    branchSnapshots: {},
    branchTransfers: [],
  };
}

let cachedSyncStore: ServerSyncStore | null = null;

function readSyncStore(): ServerSyncStore {
  if (cachedSyncStore) return cachedSyncStore;
  try {
    if (fs.existsSync(SYNC_STORE_PATH)) {
      const raw = fs.readFileSync(SYNC_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      cachedSyncStore = { ...createEmptySyncStore(), ...parsed };
      return cachedSyncStore!;
    }
  } catch (err) {
    console.warn('Could not read sync store, initializing clean store:', (err as Error).message);
  }
  cachedSyncStore = createEmptySyncStore();
  return cachedSyncStore;
}

function writeSyncStore(store: ServerSyncStore): void {
  cachedSyncStore = store;
  try {
    fs.writeFileSync(SYNC_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist sync store:', err);
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  if (!item || !item.id) return list;
  const idx = list.findIndex(x => x.id === item.id);
  if (idx > -1) {
    const next = [...list];
    next[idx] = { ...next[idx], ...item };
    return next;
  }
  return [item, ...list];
}

app.get('/api/sync/status', (_req, res) => {
  const store = readSyncStore();
  res.json({
    reachable: true,
    serverTime: new Date().toISOString(),
    totalSyncedBills: store.bills.length,
    totalSyncedOperations: store.syncedOperationIds.length,
    totalSyncedProducts: store.products.length,
    totalSyncedCustomers: store.customers.length,
    externalApiAuthConfigured: Boolean((process.env.EXTERNAL_API_KEY || '').trim()),
    externalApiEnabled: store.externalApiConfig?.enabled !== false,
    lastSyncedAt: store.lastSyncedAt || undefined,
    revision: store.revision,
  });
});

app.get('/api/sync/snapshot', (_req, res) => {
  const store = readSyncStore();
  res.json({
    success: true,
    revision: store.revision,
    lastSyncedAt: store.lastSyncedAt,
    syncedOperationIds: store.syncedOperationIds,
    snapshot: {
      bills: store.bills,
      khata: store.khata,
      customers: store.customers,
      products: store.products,
      suppliers: store.suppliers,
      purchaseOrders: store.purchaseOrders,
      cashFlowEntries: store.cashFlowEntries,
      openingCashMap: store.openingCashMap,
      loyaltyTransactions: store.loyaltyTransactions,
      staffMembers: store.staffMembers,
      attendanceRecords: store.attendanceRecords,
      storeProfile: store.storeProfile,
      whatsappConfig: store.whatsappConfig,
      whatsappMessages: store.whatsappMessages,
    },
  });
});

app.post('/api/sync/batch', (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      const store = readSyncStore();
      return res.json({
        success: true,
        syncedIds: [],
        failedIds: [],
        serverSyncedAt: new Date().toISOString(),
        totalSyncedBills: store.bills.length,
        totalSyncedOperations: store.syncedOperationIds.length,
        revision: store.revision,
      });
    }

    const store = readSyncStore();
    const seenOps = new Set(store.syncedOperationIds);
    const syncedIds: string[] = [];
    const failedIds: Array<{ id: string; error: string }> = [];
    const nowIso = new Date().toISOString();

    for (const op of items) {
      if (!op || !op.id || !op.entityType) {
        if (op?.id) failedIds.push({ id: op.id, error: 'Malformed sync payload' });
        continue;
      }

      if (seenOps.has(op.id)) {
        syncedIds.push(op.id);
        continue;
      }

      const payload = op.payload || {};
      try {
        switch (op.entityType) {
          case 'bill': {
            if (payload.bill) {
              store.bills = upsertById(store.bills, {
                ...payload.bill,
                syncStatus: 'synced',
                syncedAt: nowIso,
              });
            }
            if (payload.updatedCustomer) {
              store.customers = upsertById(store.customers, payload.updatedCustomer);
            }
            if (Array.isArray(payload.updatedProducts)) {
              for (const prod of payload.updatedProducts) {
                store.products = upsertById(store.products, prod);
              }
            }
            if (Array.isArray(payload.loyaltyTransactions)) {
              for (const ltx of payload.loyaltyTransactions) {
                store.loyaltyTransactions = upsertById(store.loyaltyTransactions, ltx);
              }
            }
            break;
          }
          case 'khata_payment': {
            if (payload.tx) store.khata = upsertById(store.khata, payload.tx);
            if (payload.updatedCustomer) {
              store.customers = upsertById(store.customers, payload.updatedCustomer);
            }
            break;
          }
          case 'customer': {
            if (payload.customer) {
              store.customers = upsertById(store.customers, payload.customer);
            }
            break;
          }
          case 'inventory': {
            if (payload.product) {
              store.products = upsertById(store.products, payload.product);
            }
            if (Array.isArray(payload.products)) {
              for (const prod of payload.products) {
                store.products = upsertById(store.products, prod);
              }
            }
            if (payload.deletedProductId) {
              store.products = store.products.filter(
                (p: any) => p.id !== payload.deletedProductId
              );
            }
            break;
          }
          case 'cashflow': {
            if (payload.entry) {
              store.cashFlowEntries = upsertById(store.cashFlowEntries, payload.entry);
            }
            break;
          }
          case 'loyalty': {
            if (payload.tx) {
              store.loyaltyTransactions = upsertById(store.loyaltyTransactions, payload.tx);
            }
            if (payload.customer) {
              store.customers = upsertById(store.customers, payload.customer);
            }
            break;
          }
          case 'attendance': {
            if (payload.record) {
              store.attendanceRecords = upsertById(store.attendanceRecords, payload.record);
            }
            if (payload.staff) {
              store.staffMembers = upsertById(store.staffMembers, payload.staff);
            }
            break;
          }
          case 'purchase_order': {
            if (payload.po) {
              store.purchaseOrders = upsertById(store.purchaseOrders, payload.po);
            }
            break;
          }
          case 'supplier': {
            if (payload.supplier) {
              store.suppliers = upsertById(store.suppliers, payload.supplier);
            }
            break;
          }
          case 'store_profile': {
            if (payload.storeProfile && typeof payload.storeProfile === 'object') {
              store.storeProfile = payload.storeProfile;
              if (payload.storeProfile.whatsappConfig) {
                store.whatsappConfig = {
                  ...store.whatsappConfig,
                  ...payload.storeProfile.whatsappConfig,
                };
              }
              if (payload.storeProfile.externalApiConfig) {
                store.externalApiConfig = {
                  enabled: payload.storeProfile.externalApiConfig.enabled !== false,
                };
              }
            }
            break;
          }
          default:
            break;
        }

        seenOps.add(op.id);
        syncedIds.push(op.id);
      } catch (opErr: any) {
        failedIds.push({ id: op.id, error: opErr?.message || 'Sync write failed' });
      }
    }

    // Cap stored operation IDs to last 2000 for bounded JSON growth while preserving bills
    const opIdArray = Array.from(seenOps);
    store.syncedOperationIds = opIdArray.slice(-2000);
    store.revision += syncedIds.length > 0 ? 1 : 0;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    return res.json({
      success: true,
      syncedIds,
      failedIds,
      serverSyncedAt: nowIso,
      totalSyncedBills: store.bills.length,
      totalSyncedOperations: store.syncedOperationIds.length,
      revision: store.revision,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Batch sync failed',
    });
  }
});

app.post('/api/sync/snapshot', (req, res) => {
  try {
    const body = req.body || {};
    const store = readSyncStore();
    const nowIso = new Date().toISOString();

    if (Array.isArray(body.products)) store.products = body.products;
    if (Array.isArray(body.customers)) store.customers = body.customers;
    if (Array.isArray(body.bills)) {
      store.bills = body.bills.map((b: any) => ({
        ...b,
        syncStatus: 'synced',
        syncedAt: b.syncedAt || nowIso,
      }));
    }
    if (Array.isArray(body.khata)) store.khata = body.khata;
    if (Array.isArray(body.suppliers)) store.suppliers = body.suppliers;
    if (Array.isArray(body.purchaseOrders)) store.purchaseOrders = body.purchaseOrders;
    if (Array.isArray(body.cashFlowEntries)) store.cashFlowEntries = body.cashFlowEntries;
    if (body.openingCashMap && typeof body.openingCashMap === 'object') {
      store.openingCashMap = body.openingCashMap;
    }
    if (Array.isArray(body.loyaltyTransactions)) store.loyaltyTransactions = body.loyaltyTransactions;
    if (Array.isArray(body.staffMembers)) store.staffMembers = body.staffMembers;
    if (Array.isArray(body.attendanceRecords)) store.attendanceRecords = body.attendanceRecords;
    if (body.storeProfile && typeof body.storeProfile === 'object') {
      store.storeProfile = body.storeProfile;
      if (body.storeProfile.whatsappConfig) {
        store.whatsappConfig = {
          ...store.whatsappConfig,
          ...body.storeProfile.whatsappConfig,
        };
      }
      if (body.storeProfile.externalApiConfig) {
        store.externalApiConfig = {
          enabled: body.storeProfile.externalApiConfig.enabled !== false,
        };
      }
    }
    if (body.externalApiConfig && typeof body.externalApiConfig === 'object') {
      store.externalApiConfig = {
        enabled: body.externalApiConfig.enabled !== false,
      };
    }
    if (body.whatsappConfig && typeof body.whatsappConfig === 'object') {
      store.whatsappConfig = {
        ...store.whatsappConfig,
        ...body.whatsappConfig,
      };
    }
    if (Array.isArray(body.whatsappMessages)) {
      store.whatsappMessages = body.whatsappMessages.slice(0, 200);
    }

    store.revision += 1;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    return res.json({
      success: true,
      serverSyncedAt: nowIso,
      totalSyncedBills: store.bills.length,
      totalSyncedOperations: store.syncedOperationIds.length,
      revision: store.revision,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Snapshot sync failed',
    });
  }
});

// =========================================================================
// WHATSAPP BUSINESS API & AUTOMATION ENDPOINTS
// =========================================================================

function normalizeWaPhone(phone?: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function deterministicParseWhatsAppMessage(params: {
  senderName: string;
  senderPhone: string;
  messageText: string;
  products: any[];
  customers: any[];
  storeName: string;
}) {
  const { senderName, senderPhone, messageText, products, customers, storeName } = params;
  const phone10 = normalizeWaPhone(senderPhone);
  const customer = Array.isArray(customers)
    ? customers.find((c: any) => normalizeWaPhone(c.phone) === phone10 && phone10.length >= 6) || null
    : null;

  const segments = String(messageText || '')
    .split(/[\n,;]+|\s+(?:and|aur|&|\+)\s+/i)
    .map(s => s.trim())
    .filter(Boolean);

  const stopWords = new Set([
    'hi', 'hello', 'namaste', 'bhai', 'bhaiya', 'ji', 'sir', 'please', 'pls',
    'send', 'order', 'bhej', 'bhejo', 'bhejdo', 'chahiye', 'dedo', 'pack',
    'rate', 'price', 'bhav', 'kitna', 'kya', 'hai', 'stock', 'available',
    'bundle', 'bundles', 'bdl', 'carton', 'cartons', 'peti', 'box', 'tray',
    'pc', 'pcs', 'piece', 'pieces', 'nag', 'pkt', 'packet',
  ]);

  const parsedItems: any[] = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const segLower = seg.toLowerCase();
    const tokens = segLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !stopWords.has(t) && !/^\d+$/.test(t));

    if (tokens.length === 0) continue;

    let bestProd: any = null;
    let bestScore = 0;
    for (const p of products || []) {
      const pLower = String(p.name || '').toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (pLower.includes(tok)) score += tok.length >= 4 ? 2.2 : 1.3;
      }
      if (p.barcode && segLower.includes(String(p.barcode).toLowerCase())) score += 5;
      if (score > bestScore) {
        bestScore = score;
        bestProd = p;
      }
    }

    if (!bestProd || bestScore < 1.8) continue;

    const isPieceHint = /\b(pc|pcs|piece|pieces|nag|pkt|packet)\b/i.test(segLower);
    const isBundleHint = /\b(bundle|bdl|carton|peti|box|tray|dozen)\b/i.test(segLower);
    const unit = isPieceHint && !isBundleHint && bestProd.piecePrice > 0
      ? 'piece'
      : bestProd.bundlePrice > 0
      ? 'bundle'
      : 'piece';

    const qtyMatch = seg.match(/\b(\d{1,3})\b/);
    let quantity = 1;
    if (qtyMatch?.[1]) {
      const n = parseInt(qtyMatch[1], 10);
      const isWeight = new RegExp(`\\b${n}(?:g|gm|ml|l|ltr|kg)\\b`, 'i').test(seg);
      if (!isWeight && n > 0 && n <= 500) quantity = n;
    }

    const bundlePieces = Math.max(1, Number(bestProd.bundlePieces) || 1);
    const totalPieces = unit === 'bundle' ? quantity * bundlePieces : quantity;
    const unitPrice = unit === 'bundle' ? Number(bestProd.bundlePrice) || 0 : Number(bestProd.piecePrice) || 0;
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    const availablePieces = Number(bestProd.stockPieces) || 0;

    parsedItems.push({
      id: `wa_item_${Date.now()}_${idx}`,
      rawText: seg,
      matchedProductId: bestProd.id,
      matchedProductName: bestProd.name,
      unit,
      bundleUnitName: bestProd.bundleUnitName || 'Bundle',
      bundlePieces,
      quantity,
      unitPrice,
      totalPieces,
      lineTotal,
      availablePieces,
      stockSufficient: availablePieces >= totalPieces,
      confidence: Math.min(0.95, 0.55 + bestScore * 0.1),
    });
  }

  const lower = String(messageText || '').toLowerCase();
  const hasInquiry = /(\?|rate|price|bhav|kitna|stock|available|balance|udhar|khata|due|baki)/i.test(lower);
  const hasOrder = /(order|send|bhej|bhejo|chahiye|dedo|pack|dispatch|bill)/i.test(lower);
  const hasPayment = /(paid|gpay|phonepe|paytm|upi|utr|transfer|jama)/i.test(lower);

  let intent: 'order' | 'inquiry' | 'payment' | 'other' = 'other';
  if (hasPayment && parsedItems.length === 0) intent = 'payment';
  else if (hasInquiry && !hasOrder) intent = 'inquiry';
  else if (parsedItems.length > 0 || hasOrder) intent = 'order';
  else if (hasInquiry) intent = 'inquiry';

  const estimatedTotal = Math.round(parsedItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  const greetingName = customer?.name || senderName || 'Valued Customer';
  let suggestedReply = `Namaste ${greetingName}, thank you for messaging ${storeName}.`;

  if (intent === 'inquiry' && parsedItems.length > 0) {
    const lines = parsedItems.map(i => {
      const prod = products.find((p: any) => p.id === i.matchedProductId);
      const stockTxt = (prod?.stockPieces || 0) > 0 ? `${prod.stockPieces} pcs in stock` : 'Out of stock';
      return `• ${i.matchedProductName}: ₹${i.unitPrice}/${i.unit === 'bundle' ? i.bundleUnitName : 'Pc'} (${stockTxt})`;
    });
    suggestedReply = `Namaste ${greetingName}, live rates & stock at ${storeName}:\n${lines.join('\n')}`;
  } else if (intent === 'order' && parsedItems.length > 0) {
    const lines = parsedItems.map(
      i => `• ${i.matchedProductName}: ${i.quantity} ${i.unit === 'bundle' ? i.bundleUnitName : 'Pc'} = ₹${i.lineTotal}`
    );
    suggestedReply = `Namaste ${greetingName}, order received at ${storeName}:\n${lines.join('\n')}\nEstimated Total: ₹${estimatedTotal}`;
  }

  return {
    intent,
    parsedItems,
    estimatedTotal,
    suggestedReply,
    customerId: customer?.id,
    resolvedSenderName: customer?.name || senderName || 'WhatsApp Customer',
  };
}

async function parseWhatsAppMessageWithGeminiOrFallback(params: {
  senderName: string;
  senderPhone: string;
  messageText: string;
  products: any[];
  customers: any[];
  storeName: string;
}) {
  const fallback = deterministicParseWhatsAppMessage(params);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || !Array.isArray(params.products) || params.products.length === 0) {
    return fallback;
  }

  try {
    const catalogLines = params.products
      .slice(0, 60)
      .map(
        (p: any) =>
          `id="${p.id}" | name="${p.name}" | bundleUnit="${p.bundleUnitName || 'Bundle'}"(${p.bundlePieces} pcs) | bundleRate=${p.bundlePrice} | pieceRate=${p.piecePrice} | stockPcs=${p.stockPieces}`
      )
      .join('\n');

    const prompt = `You parse WhatsApp customer messages for an Indian wholesale FMCG store "${params.storeName}".
Customer: "${fallback.resolvedSenderName}" (${params.senderPhone})
Message: """${params.messageText}"""

Store Catalog:
${catalogLines}

Classify intent as "order", "inquiry", "payment", or "other".
Match any mentioned catalog items accurately to their exact product id, quantity (number), and unit ("bundle" or "piece").
Write a short, polite bilingual English/Hinglish suggestedReply quoting live stock/prices from the catalog when relevant.`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    productId: { type: Type.STRING },
                    rawText: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                  },
                  required: ['productId', 'quantity', 'unit'],
                },
              },
              suggestedReply: { type: Type.STRING },
            },
            required: ['intent', 'items', 'suggestedReply'],
          },
        },
      }),
      8_000,
      'WhatsApp message AI parse timed out'
    );

    const parsed = extractJsonFromGeminiResponse(response?.text || '{}');
    const validIntents = new Set(['order', 'inquiry', 'payment', 'other']);
    const intent = validIntents.has(parsed?.intent) ? parsed.intent : fallback.intent;

    const mappedItems: any[] = [];
    if (Array.isArray(parsed?.items)) {
      parsed.items.forEach((rawItem: any, idx: number) => {
        const prod = params.products.find((p: any) => p.id === rawItem.productId);
        if (!prod) return;
        const unit =
          String(rawItem.unit).toLowerCase() === 'piece' && prod.piecePrice > 0
            ? 'piece'
            : prod.bundlePrice > 0
            ? 'bundle'
            : 'piece';
        const quantity = Math.max(1, Math.round(Number(rawItem.quantity) || 1));
        const bundlePieces = Math.max(1, Number(prod.bundlePieces) || 1);
        const totalPieces = unit === 'bundle' ? quantity * bundlePieces : quantity;
        const unitPrice = unit === 'bundle' ? Number(prod.bundlePrice) || 0 : Number(prod.piecePrice) || 0;
        const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
        const availablePieces = Number(prod.stockPieces) || 0;

        mappedItems.push({
          id: `wa_ai_item_${Date.now()}_${idx}`,
          rawText: String(rawItem.rawText || `${quantity} ${unit} ${prod.name}`),
          matchedProductId: prod.id,
          matchedProductName: prod.name,
          unit,
          bundleUnitName: prod.bundleUnitName || 'Bundle',
          bundlePieces,
          quantity,
          unitPrice,
          totalPieces,
          lineTotal,
          availablePieces,
          stockSufficient: availablePieces >= totalPieces,
          confidence: 0.94,
        });
      });
    }

    const finalItems = mappedItems.length > 0 ? mappedItems : fallback.parsedItems;
    const estimatedTotal = Math.round(finalItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;

    return {
      intent,
      parsedItems: finalItems,
      estimatedTotal,
      suggestedReply: String(parsed?.suggestedReply || fallback.suggestedReply),
      customerId: fallback.customerId,
      resolvedSenderName: fallback.resolvedSenderName,
    };
  } catch {
    return fallback;
  }
}

app.get('/api/whatsapp/config', (_req, res) => {
  const store = readSyncStore();
  res.json({
    success: true,
    config: store.whatsappConfig,
    hasServerAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    webhookPath: '/api/whatsapp/webhook',
  });
});

app.post('/api/whatsapp/config', (req, res) => {
  try {
    const incoming = req.body?.config || req.body || {};
    const store = readSyncStore();
    store.whatsappConfig = {
      ...store.whatsappConfig,
      ...incoming,
    };
    if (store.storeProfile && typeof store.storeProfile === 'object') {
      store.storeProfile = {
        ...store.storeProfile,
        whatsappConfig: store.whatsappConfig,
      };
    }
    store.revision += 1;
    writeSyncStore(store);
    return res.json({
      success: true,
      config: store.whatsappConfig,
      hasServerAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save WhatsApp config' });
  }
});

app.get('/api/whatsapp/messages', (_req, res) => {
  const store = readSyncStore();
  res.json({
    success: true,
    messages: store.whatsappMessages || [],
    config: store.whatsappConfig,
  });
});

app.post('/api/whatsapp/messages', (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const store = readSyncStore();
    store.whatsappMessages = messages.slice(0, 200);
    store.revision += 1;
    writeSyncStore(store);
    return res.json({ success: true, count: store.whatsappMessages.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to sync WhatsApp messages' });
  }
});

app.post('/api/whatsapp/parse', async (req, res) => {
  try {
    const store = readSyncStore();
    const {
      senderName = 'WhatsApp Customer',
      senderPhone = '',
      messageText = '',
      products = store.products,
      customers = store.customers,
      storeName = store.storeProfile?.storeName || 'SQ ENTERPRISES',
      source = 'simulator',
      saveToInbox = false,
    } = req.body || {};

    if (!String(messageText).trim()) {
      return res.status(400).json({ success: false, error: 'Message text is required.' });
    }

    if (store.whatsappConfig && store.whatsappConfig.enabled === false) {
      return res.status(409).json({
        success: false,
        disabled: true,
        error: 'WhatsApp automation is currently disabled in Store Settings.',
      });
    }

    const result = await parseWhatsAppMessageWithGeminiOrFallback({
      senderName,
      senderPhone,
      messageText,
      products,
      customers,
      storeName,
    });

    const now = new Date();
    const messageRecord = {
      id: `wa_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
      senderName: result.resolvedSenderName,
      senderPhone: String(senderPhone).trim(),
      customerId: result.customerId,
      messageText: String(messageText).trim(),
      receivedAt: now.toISOString(),
      formattedTime: now.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
      intent: result.intent,
      status: 'pending_review',
      parsedItems: result.parsedItems,
      estimatedTotal: result.estimatedTotal,
      suggestedReply: result.suggestedReply,
      stockUpdated: false,
      source,
    };

    if (saveToInbox) {
      store.whatsappMessages = [messageRecord, ...(store.whatsappMessages || [])].slice(0, 200);
      store.revision += 1;
      writeSyncStore(store);
    }

    return res.json({ success: true, message: messageRecord });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'WhatsApp parse failed' });
  }
});

// Meta WhatsApp Business Cloud API Webhook Verification (GET)
app.get('/api/whatsapp/webhook', (req, res) => {
  const store = readSyncStore();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken =
    store.whatsappConfig?.verifyToken ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    'sq_pos_whatsapp_verify';

  if (mode === 'subscribe' && token === expectedToken && challenge) {
    return res.status(200).send(String(challenge));
  }
  return res.status(403).json({
    success: false,
    error: 'Invalid WhatsApp webhook verify_token or hub.mode',
  });
});

// Meta WhatsApp Business Cloud API Inbound Webhook (POST)
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const store = readSyncStore();
    const nowIso = new Date().toISOString();
    store.whatsappConfig = {
      ...store.whatsappConfig,
      lastWebhookAt: nowIso,
    };

    if (store.whatsappConfig?.enabled === false) {
      writeSyncStore(store);
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: 'WhatsApp automation integration is disabled in Settings.',
      });
    }

    const inboundList: Array<{ from: string; name: string; text: string; externalId?: string }> = [];
    const body = req.body || {};

    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry?.changes || []) {
          const val = change?.value || {};
          const contacts = Array.isArray(val.contacts) ? val.contacts : [];
          for (const msg of val.messages || []) {
            if (msg?.type === 'text' && msg?.text?.body) {
              const contact = contacts.find((c: any) => c.wa_id === msg.from);
              inboundList.push({
                from: String(msg.from || ''),
                name: String(contact?.profile?.name || 'WhatsApp Customer'),
                text: String(msg.text.body),
                externalId: msg.id,
              });
            }
          }
        }
      }
    } else if (body.text && (body.from || body.senderPhone)) {
      inboundList.push({
        from: String(body.from || body.senderPhone),
        name: String(body.name || body.senderName || 'WhatsApp Customer'),
        text: String(body.text || body.messageText),
        externalId: body.id,
      });
    }

    const created: any[] = [];
    for (const item of inboundList) {
      const parsed = await parseWhatsAppMessageWithGeminiOrFallback({
        senderName: item.name,
        senderPhone: item.from,
        messageText: item.text,
        products: store.products || [],
        customers: store.customers || [],
        storeName: store.storeProfile?.storeName || 'SQ ENTERPRISES',
      });

      const msgRecord = {
        id: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        externalMessageId: item.externalId,
        senderName: parsed.resolvedSenderName,
        senderPhone: normalizeWaPhone(item.from) || item.from,
        customerId: parsed.customerId,
        messageText: item.text,
        receivedAt: nowIso,
        formattedTime: new Date().toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        intent: parsed.intent,
        status: 'pending_review',
        parsedItems: parsed.parsedItems,
        estimatedTotal: parsed.estimatedTotal,
        suggestedReply: parsed.suggestedReply,
        stockUpdated: false,
        source: 'webhook',
      };
      created.push(msgRecord);
    }

    if (created.length > 0) {
      store.whatsappMessages = [...created, ...(store.whatsappMessages || [])].slice(0, 200);
      store.revision += 1;
    }
    writeSyncStore(store);

    return res.status(200).json({
      success: true,
      received: created.length,
      messages: created,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'WhatsApp webhook processing error',
    });
  }
});

// Send Outbound Reply via Meta Graph API v21.0 (if server access token configured) or return WhatsApp Web fallback
app.post('/api/whatsapp/send-reply', async (req, res) => {
  try {
    const store = readSyncStore();
    const { messageId, recipientPhone, replyText } = req.body || {};
    if (!recipientPhone || !replyText) {
      return res.status(400).json({
        success: false,
        error: 'recipientPhone and replyText are required.',
      });
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId =
      store.whatsappConfig?.businessPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

    let deliveryMode: 'cloud_api' | 'whatsapp_web' | 'local_log' = 'whatsapp_web';
    let apiResponseData: any = null;

    const digits = String(recipientPhone).replace(/\D/g, '');
    const e164 = digits.length === 10 ? `91${digits}` : digits;

    if (accessToken && phoneNumberId) {
      try {
        const graphRes = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: e164,
              type: 'text',
              text: { body: String(replyText) },
            }),
          }
        );
        apiResponseData = await graphRes.json().catch(() => null);
        if (graphRes.ok) {
          deliveryMode = 'cloud_api';
        }
      } catch {
        deliveryMode = 'whatsapp_web';
      }
    }

    if (messageId && Array.isArray(store.whatsappMessages)) {
      store.whatsappMessages = store.whatsappMessages.map((m: any) =>
        m.id === messageId
          ? {
              ...m,
              replyText: String(replyText),
              repliedAt: new Date().toISOString(),
              replyDeliveryMode: deliveryMode,
              status: m.status === 'pending_review' && m.intent === 'inquiry' ? 'replied' : m.status,
            }
          : m
      );
      writeSyncStore(store);
    }

    return res.json({
      success: true,
      deliveryMode,
      whatsappWebUrl: `https://wa.me/${e164}?text=${encodeURIComponent(String(replyText))}`,
      cloudApiResponse: apiResponseData,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to dispatch WhatsApp reply',
    });
  }
});

// =========================================================================
// EXTERNAL APP INTEGRATION REST API v1 (/api/v1/*)
// Sync Product Catalog, Real-time Inventory & Customer Orders
// =========================================================================

// Internal POS configuration endpoints for enabling/disabling External API v1
app.get('/api/external-api/config', (_req, res) => {
  const store = readSyncStore();
  return res.json({
    success: true,
    config: {
      enabled: store.externalApiConfig?.enabled !== false,
    },
    authConfigured: Boolean((process.env.EXTERNAL_API_KEY || '').trim()),
  });
});

app.post('/api/external-api/config', (req, res) => {
  try {
    const incoming = req.body?.config || req.body || {};
    const store = readSyncStore();
    const enabled = incoming.enabled !== false;
    store.externalApiConfig = { enabled };
    if (store.storeProfile && typeof store.storeProfile === 'object') {
      store.storeProfile = {
        ...store.storeProfile,
        externalApiConfig: store.externalApiConfig,
      };
    }
    store.revision += 1;
    writeSyncStore(store);
    return res.json({
      success: true,
      config: store.externalApiConfig,
      revision: store.revision,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to save External API configuration',
    });
  }
});

// CORS & Preflight support for external apps, storefronts, and ERP connectors
app.use('/api/v1', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Enforce External API enable/disable switch from Store Settings
app.use('/api/v1', (_req, res, next) => {
  const store = readSyncStore();
  if (store.externalApiConfig && store.externalApiConfig.enabled === false) {
    return res.status(403).json({
      success: false,
      disabled: true,
      enabled: false,
      error: 'External API integration is currently disabled in Store Settings.',
    });
  }
  next();
});

// Optional API key authentication when EXTERNAL_API_KEY is set on the server
app.use('/api/v1', (req, res, next) => {
  if (req.path === '/openapi.json' || req.path === '/docs') {
    return next();
  }
  const configuredKey = (process.env.EXTERNAL_API_KEY || '').trim();
  if (!configuredKey) {
    return next();
  }

  const authHeader = String(req.headers.authorization || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  const providedKey = bearerToken || headerKey;

  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Provide a valid Authorization: Bearer <key> or X-API-Key header.',
      authConfigured: true,
    });
  }
  next();
});

function formatExternalDateTime(date: Date): string {
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function normalizeExternalProductInput(input: any, existing?: any): any {
  const nowIso = new Date().toISOString();
  const bundlePieces = Math.max(
    1,
    Math.round(Number(input?.bundlePieces ?? existing?.bundlePieces ?? 1) || 1)
  );
  const bundlePrice = Math.max(
    0,
    Math.round((Number(input?.bundlePrice ?? existing?.bundlePrice ?? 0) || 0) * 100) / 100
  );
  const piecePrice = Math.max(
    0,
    Math.round((Number(input?.piecePrice ?? existing?.piecePrice ?? 0) || 0) * 100) / 100
  );
  const stockPieces = Math.max(
    0,
    Math.round(Number(input?.stockPieces ?? existing?.stockPieces ?? 0) || 0)
  );
  const lowStockThreshold = Math.max(
    0,
    Math.round(Number(input?.lowStockThreshold ?? existing?.lowStockThreshold ?? 10) || 0)
  );

  return {
    id:
      String(input?.id || existing?.id || '').trim() ||
      `prod_ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(input?.name ?? existing?.name ?? '').trim(),
    category: String(input?.category ?? existing?.category ?? 'General').trim() || 'General',
    barcode: input?.barcode !== undefined ? String(input.barcode || '').trim() || undefined : existing?.barcode,
    pieceBarcode:
      input?.pieceBarcode !== undefined
        ? String(input.pieceBarcode || '').trim() || undefined
        : existing?.pieceBarcode,
    bundleUnitName:
      String(input?.bundleUnitName ?? existing?.bundleUnitName ?? 'Bundle').trim() || 'Bundle',
    bundlePieces,
    bundlePrice,
    piecePrice,
    stockPieces,
    lowStockThreshold,
    imageUrl: input?.imageUrl !== undefined ? input.imageUrl : existing?.imageUrl,
    emoji: String(input?.emoji ?? existing?.emoji ?? '📦').trim() || '📦',
    color: String(input?.color ?? existing?.color ?? 'bg-slate-800').trim() || 'bg-slate-800',
    isFavorite:
      typeof input?.isFavorite === 'boolean' ? input.isFavorite : Boolean(existing?.isFavorite),
    updatedAt: nowIso,
  };
}

function formatInventoryRecord(p: any) {
  const bundlePieces = Math.max(1, Number(p?.bundlePieces) || 1);
  const stockPieces = Number(p?.stockPieces) || 0;
  const lowStockThreshold = Number(p?.lowStockThreshold) || 10;
  const bundlesAvailable = Math.floor(Math.max(0, stockPieces) / bundlePieces);
  const loosePieces = Math.max(0, stockPieces) % bundlePieces;
  const perPieceValue =
    Number(p?.piecePrice) > 0
      ? Number(p.piecePrice)
      : Number(p?.bundlePrice) > 0
      ? Number(p.bundlePrice) / bundlePieces
      : 0;

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    barcode: p.barcode || null,
    pieceBarcode: p.pieceBarcode || null,
    bundleUnitName: p.bundleUnitName || 'Bundle',
    bundlePieces,
    bundlePrice: Number(p.bundlePrice) || 0,
    piecePrice: Number(p.piecePrice) || 0,
    stockPieces,
    bundlesAvailable,
    loosePieces,
    lowStockThreshold,
    isLowStock: stockPieces <= lowStockThreshold,
    isOutOfStock: stockPieces <= 0,
    stockValueEstimate: Math.round(Math.max(0, stockPieces) * perPieceValue * 100) / 100,
    updatedAt: p.updatedAt || null,
  };
}

function findProductByIdOrBarcode(products: any[], identifier: string) {
  const key = String(identifier || '').trim();
  if (!key) return null;
  return (
    products.find(
      (p: any) =>
        p.id === key ||
        (p.barcode && String(p.barcode).trim() === key) ||
        (p.pieceBarcode && String(p.pieceBarcode).trim() === key)
    ) || null
  );
}

// 1. API Status & Discovery
app.get('/api/v1/status', (_req, res) => {
  const store = readSyncStore();
  const lowStockProducts = store.products.filter(
    (p: any) => (Number(p?.stockPieces) || 0) <= (Number(p?.lowStockThreshold) || 10)
  ).length;

  return res.json({
    success: true,
    service: store.storeProfile?.storeName || 'SQ Enterprises POS External API',
    version: 'v1',
    serverTime: new Date().toISOString(),
    revision: store.revision,
    lastSyncedAt: store.lastSyncedAt,
    authConfigured: Boolean((process.env.EXTERNAL_API_KEY || '').trim()),
    counts: {
      products: store.products.length,
      customers: store.customers.length,
      orders: store.bills.length,
      lowStockProducts,
    },
  });
});

function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'SQ Enterprises POS External Integration API',
      version: '1.0.0',
      description:
        'RESTful API v1 for bidirectional syncing of product catalog, real-time inventory, customer directory, and external orders.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer' },
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    paths: {
      '/status': {
        get: { summary: 'API status, sync revision, and entity counts' },
      },
      '/products': {
        get: {
          summary: 'List or filter product catalog',
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'barcode', in: 'query', schema: { type: 'string' } },
            { name: 'lowStockOnly', in: 'query', schema: { type: 'boolean' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
        },
        post: { summary: 'Create or bulk-upsert product SKUs' },
      },
      '/products/{id}': {
        get: { summary: 'Fetch single product by ID or barcode' },
        put: { summary: 'Replace/update product SKU' },
        patch: { summary: 'Partially update product SKU' },
        delete: { summary: 'Delete product SKU' },
      },
      '/inventory': {
        get: { summary: 'Get real-time stock levels and bundle/piece breakdown' },
      },
      '/inventory/adjust': {
        post: { summary: 'Apply relative delta or absolute stock adjustments' },
      },
      '/inventory/sync': {
        post: { summary: 'Bulk reconcile SKU stock levels and unit prices' },
      },
      '/customers': {
        get: { summary: 'Search or lookup customers by phone or name' },
        post: { summary: 'Upsert customer profile' },
      },
      '/orders': {
        get: { summary: 'List or filter POS, WhatsApp, OCR, and external orders' },
        post: { summary: 'Submit an external customer order with automatic stock deduction' },
      },
      '/orders/{id}': {
        get: { summary: 'Fetch single order by ID, billNumber, or externalOrderId' },
      },
      '/orders/{id}/status': {
        patch: { summary: 'Update external fulfillment status, payment, or notes on an order' },
      },
    },
  };
}

app.get('/api/v1/openapi.json', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return res.json(buildOpenApiSpec(`${proto}://${host}`));
});

app.get('/api/v1/docs', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return res.json({
    success: true,
    specUrl: `${proto}://${host}/api/v1/openapi.json`,
    endpoints: buildOpenApiSpec(`${proto}://${host}`).paths,
  });
});

// 2. Product Catalog Endpoints (/api/v1/products)
app.get('/api/v1/products', (req, res) => {
  const store = readSyncStore();
  let list = [...(store.products || [])];

  const category = String(req.query.category || '').trim().toLowerCase();
  const search = String(req.query.search || '').trim().toLowerCase();
  const barcode = String(req.query.barcode || '').trim();
  const lowStockOnly = String(req.query.lowStockOnly || '').toLowerCase() === 'true' || req.query.lowStockOnly === '1';
  const updatedSince = String(req.query.updatedSince || '').trim();

  if (category && category !== 'all') {
    list = list.filter((p: any) => String(p.category || '').toLowerCase() === category);
  }
  if (barcode) {
    list = list.filter(
      (p: any) =>
        String(p.barcode || '').trim() === barcode ||
        String(p.pieceBarcode || '').trim() === barcode
    );
  }
  if (search) {
    list = list.filter((p: any) => {
      const hay = `${p.id || ''} ${p.name || ''} ${p.category || ''} ${p.barcode || ''} ${p.pieceBarcode || ''}`.toLowerCase();
      return hay.includes(search);
    });
  }
  if (lowStockOnly) {
    list = list.filter(
      (p: any) => (Number(p.stockPieces) || 0) <= (Number(p.lowStockThreshold) || 10)
    );
  }
  if (updatedSince) {
    const sinceMs = Date.parse(updatedSince);
    if (!Number.isNaN(sinceMs)) {
      list = list.filter((p: any) => !p.updatedAt || Date.parse(p.updatedAt) >= sinceMs);
    }
  }

  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  const sliced = list.slice(offset, offset + limit);

  return res.json({
    success: true,
    total: list.length,
    count: sliced.length,
    limit,
    offset,
    revision: store.revision,
    products: sliced,
  });
});

app.get('/api/v1/products/:id', (req, res) => {
  const store = readSyncStore();
  const prod = findProductByIdOrBarcode(store.products || [], req.params.id);
  if (!prod) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }
  return res.json({ success: true, revision: store.revision, product: prod });
});

app.post('/api/v1/products', (req, res) => {
  try {
    const store = readSyncStore();
    const rawItems = Array.isArray(req.body?.products)
      ? req.body.products
      : Array.isArray(req.body)
      ? req.body
      : [req.body];

    if (rawItems.length === 0) {
      return res.status(400).json({ success: false, error: 'Product payload is required.' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const saved: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    rawItems.forEach((raw: any, index: number) => {
      if (!raw || !String(raw.name || '').trim()) {
        errors.push({ index, error: 'Product name is required.' });
        return;
      }

      const existing =
        (raw.id && store.products.find((p: any) => p.id === raw.id)) ||
        (raw.barcode && findProductByIdOrBarcode(store.products, raw.barcode)) ||
        null;

      const normalized = normalizeExternalProductInput(raw, existing);
      store.products = upsertById(store.products, normalized);
      if (existing) updatedCount += 1;
      else createdCount += 1;
      saved.push(normalized);
    });

    if (saved.length === 0) {
      return res.status(400).json({
        success: false,
        error: errors[0]?.error || 'No valid products supplied.',
        errors,
      });
    }

    const nowIso = new Date().toISOString();
    store.revision += 1;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    const status = createdCount > 0 ? 201 : 200;
    return res.status(status).json({
      success: true,
      createdCount,
      updatedCount,
      errors,
      revision: store.revision,
      ...(Array.isArray(req.body?.products) || Array.isArray(req.body)
        ? { products: saved }
        : { product: saved[0] }),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to save product(s).',
    });
  }
});

function handleUpdateProductV1(req: express.Request, res: express.Response) {
  try {
    const store = readSyncStore();
    const existing = findProductByIdOrBarcode(store.products || [], req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    const body = req.body || {};
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ success: false, error: 'Product name cannot be empty.' });
    }

    const updated = normalizeExternalProductInput({ ...body, id: existing.id }, existing);
    store.products = upsertById(store.products, updated);
    store.revision += 1;
    store.lastSyncedAt = new Date().toISOString();
    writeSyncStore(store);

    return res.json({ success: true, revision: store.revision, product: updated });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to update product.',
    });
  }
}

app.put('/api/v1/products/:id', handleUpdateProductV1);
app.patch('/api/v1/products/:id', handleUpdateProductV1);

app.delete('/api/v1/products/:id', (req, res) => {
  const store = readSyncStore();
  const existing = findProductByIdOrBarcode(store.products || [], req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }
  store.products = store.products.filter((p: any) => p.id !== existing.id);
  store.revision += 1;
  store.lastSyncedAt = new Date().toISOString();
  writeSyncStore(store);

  return res.json({
    success: true,
    deletedId: existing.id,
    revision: store.revision,
  });
});

// 3. Inventory & Real-Time Stock Sync Endpoints (/api/v1/inventory)
app.get('/api/v1/inventory', (req, res) => {
  const store = readSyncStore();
  let rows = (store.products || []).map(formatInventoryRecord);

  const category = String(req.query.category || '').trim().toLowerCase();
  const search = String(req.query.search || '').trim().toLowerCase();
  const barcode = String(req.query.barcode || '').trim();
  const lowStockOnly =
    String(req.query.lowStockOnly || '').toLowerCase() === 'true' || req.query.lowStockOnly === '1';

  if (category && category !== 'all') {
    rows = rows.filter(r => String(r.category || '').toLowerCase() === category);
  }
  if (barcode) {
    rows = rows.filter(r => r.barcode === barcode || r.pieceBarcode === barcode);
  }
  if (search) {
    rows = rows.filter(r =>
      `${r.id} ${r.name} ${r.category} ${r.barcode || ''} ${r.pieceBarcode || ''}`
        .toLowerCase()
        .includes(search)
    );
  }
  if (lowStockOnly) {
    rows = rows.filter(r => r.isLowStock);
  }

  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  const sliced = rows.slice(offset, offset + limit);

  const summary = {
    totalSkus: rows.length,
    totalPiecesInStock: rows.reduce((s, r) => s + Math.max(0, r.stockPieces), 0),
    lowStockCount: rows.filter(r => r.isLowStock).length,
    outOfStockCount: rows.filter(r => r.isOutOfStock).length,
    estimatedInventoryValue:
      Math.round(rows.reduce((s, r) => s + r.stockValueEstimate, 0) * 100) / 100,
  };

  return res.json({
    success: true,
    total: rows.length,
    count: sliced.length,
    revision: store.revision,
    lastSyncedAt: store.lastSyncedAt,
    summary,
    inventory: sliced,
  });
});

app.post('/api/v1/inventory/adjust', (req, res) => {
  try {
    const store = readSyncStore();
    const rawAdjustments = Array.isArray(req.body?.adjustments)
      ? req.body.adjustments
      : [req.body];

    if (rawAdjustments.length === 0 || !rawAdjustments[0]) {
      return res.status(400).json({
        success: false,
        error: 'Provide adjustment payload with productId or barcode and deltaPieces or setStockPieces.',
      });
    }

    const nowIso = new Date().toISOString();
    const results: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    rawAdjustments.forEach((adj: any, idx: number) => {
      const lookupKey = String(adj?.productId || adj?.id || adj?.barcode || '').trim();
      const target = findProductByIdOrBarcode(store.products || [], lookupKey);
      if (!target) {
        errors.push({ index: idx, error: `Product not found for identifier "${lookupKey}".` });
        return;
      }

      const prevStock = Number(target.stockPieces) || 0;
      let nextStock = prevStock;

      if (adj?.setStockPieces !== undefined && Number.isFinite(Number(adj.setStockPieces))) {
        nextStock = Math.max(0, Math.round(Number(adj.setStockPieces)));
      } else if (adj?.deltaPieces !== undefined && Number.isFinite(Number(adj.deltaPieces))) {
        nextStock = Math.max(0, prevStock + Math.round(Number(adj.deltaPieces)));
      } else if (adj?.deltaBundles !== undefined && Number.isFinite(Number(adj.deltaBundles))) {
        const bp = Math.max(1, Number(target.bundlePieces) || 1);
        nextStock = Math.max(0, prevStock + Math.round(Number(adj.deltaBundles)) * bp);
      } else {
        errors.push({
          index: idx,
          error: `Adjustment for "${target.name}" requires deltaPieces, deltaBundles, or setStockPieces.`,
        });
        return;
      }

      const updatedProd = {
        ...target,
        stockPieces: nextStock,
        updatedAt: nowIso,
      };
      store.products = upsertById(store.products, updatedProd);

      const auditEntry = {
        id: `ext_adj_${Date.now()}_${idx}`,
        timestamp: nowIso,
        productId: target.id,
        productName: target.name,
        previousStockPieces: prevStock,
        newStockPieces: nextStock,
        deltaPieces: nextStock - prevStock,
        reason: String(adj?.reason || 'external_api_adjustment'),
        reference: adj?.reference ? String(adj.reference) : undefined,
      };
      store.externalInventoryAdjustments = [
        auditEntry,
        ...(store.externalInventoryAdjustments || []),
      ].slice(0, 200);

      results.push({
        ...auditEntry,
        inventory: formatInventoryRecord(updatedProd),
      });
    });

    if (results.length === 0) {
      return res.status(400).json({
        success: false,
        error: errors[0]?.error || 'No valid inventory adjustments applied.',
        errors,
      });
    }

    store.revision += 1;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    return res.json({
      success: true,
      appliedCount: results.length,
      errors,
      revision: store.revision,
      results,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Inventory adjustment failed.',
    });
  }
});

app.post('/api/v1/inventory/sync', (req, res) => {
  try {
    const store = readSyncStore();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required.' });
    }

    const nowIso = new Date().toISOString();
    const updatedProducts: any[] = [];
    const unmatched: any[] = [];

    for (const item of items) {
      const key = String(item?.id || item?.productId || item?.barcode || '').trim();
      const existing = findProductByIdOrBarcode(store.products || [], key);
      if (!existing) {
        unmatched.push(item);
        continue;
      }

      const patched = normalizeExternalProductInput(
        {
          ...existing,
          ...(item.stockPieces !== undefined ? { stockPieces: item.stockPieces } : {}),
          ...(item.bundlePrice !== undefined ? { bundlePrice: item.bundlePrice } : {}),
          ...(item.piecePrice !== undefined ? { piecePrice: item.piecePrice } : {}),
          ...(item.lowStockThreshold !== undefined
            ? { lowStockThreshold: item.lowStockThreshold }
            : {}),
        },
        existing
      );
      store.products = upsertById(store.products, patched);
      updatedProducts.push(formatInventoryRecord(patched));
    }

    if (updatedProducts.length > 0) {
      store.revision += 1;
      store.lastSyncedAt = nowIso;
      writeSyncStore(store);
    }

    return res.json({
      success: true,
      matchedCount: updatedProducts.length,
      unmatchedCount: unmatched.length,
      revision: store.revision,
      updatedProducts,
      unmatched,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Inventory bulk sync failed.',
    });
  }
});

// 4. Customer Directory Lookup & Upsert (/api/v1/customers)
app.get('/api/v1/customers', (req, res) => {
  const store = readSyncStore();
  let list = [...(store.customers || [])];

  const phone = normalizeWaPhone(String(req.query.phone || ''));
  const search = String(req.query.search || '').trim().toLowerCase();

  if (phone) {
    list = list.filter((c: any) => normalizeWaPhone(c.phone).includes(phone));
  }
  if (search) {
    list = list.filter((c: any) =>
      `${c.name || ''} ${c.phone || ''} ${c.address || ''}`.toLowerCase().includes(search)
    );
  }

  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  const sliced = list.slice(offset, offset + limit);

  return res.json({
    success: true,
    total: list.length,
    count: sliced.length,
    revision: store.revision,
    customers: sliced,
  });
});

app.post('/api/v1/customers', (req, res) => {
  try {
    const store = readSyncStore();
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Customer name is required.' });
    }

    const phone10 = normalizeWaPhone(phone);
    const existing =
      (body.id && store.customers.find((c: any) => c.id === body.id)) ||
      (phone10.length >= 6 &&
        store.customers.find((c: any) => normalizeWaPhone(c.phone) === phone10)) ||
      null;

    const nowIso = new Date().toISOString();
    const nextCustomer = {
      id: existing?.id || String(body.id || `cust_ext_${Date.now()}`),
      name,
      phone: phone || existing?.phone || '',
      address: body.address !== undefined ? String(body.address) : existing?.address,
      currentBalance:
        body.currentBalance !== undefined && Number.isFinite(Number(body.currentBalance))
          ? Number(body.currentBalance)
          : Number(existing?.currentBalance) || 0,
      creditLimit:
        body.creditLimit !== undefined ? Number(body.creditLimit) : existing?.creditLimit,
      creditWarningPct:
        body.creditWarningPct !== undefined
          ? Number(body.creditWarningPct)
          : existing?.creditWarningPct ?? 80,
      pricingTier: body.pricingTier || existing?.pricingTier,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    store.customers = upsertById(store.customers, nextCustomer);
    store.revision += 1;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    return res.status(existing ? 200 : 201).json({
      success: true,
      created: !existing,
      revision: store.revision,
      customer: nextCustomer,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to upsert customer.',
    });
  }
});

// 5. Customer Orders Sync Endpoints (/api/v1/orders)
app.get('/api/v1/orders', (req, res) => {
  const store = readSyncStore();
  let list = [...(store.bills || [])];

  const since = String(req.query.since || '').trim();
  const customerId = String(req.query.customerId || '').trim();
  const phone = normalizeWaPhone(String(req.query.phone || ''));
  const source = String(req.query.source || '').trim().toLowerCase();
  const paymentMode = String(req.query.paymentMode || '').trim().toLowerCase();
  const externalStatus = String(req.query.externalStatus || '').trim().toLowerCase();

  if (since) {
    const sinceMs = Date.parse(since);
    if (!Number.isNaN(sinceMs)) {
      list = list.filter((b: any) => Date.parse(b.timestamp) >= sinceMs);
    }
  }
  if (customerId) {
    list = list.filter((b: any) => b.customerId === customerId);
  }
  if (phone) {
    list = list.filter((b: any) => normalizeWaPhone(b.customerPhone) === phone);
  }
  if (source) {
    list = list.filter((b: any) => String(b.source || 'pos').toLowerCase() === source);
  }
  if (paymentMode) {
    list = list.filter((b: any) => String(b.paymentMode || '').toLowerCase() === paymentMode);
  }
  if (externalStatus) {
    list = list.filter(
      (b: any) => String(b.externalStatus || '').toLowerCase() === externalStatus
    );
  }

  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  const sliced = list.slice(offset, offset + limit);

  return res.json({
    success: true,
    total: list.length,
    count: sliced.length,
    limit,
    offset,
    revision: store.revision,
    orders: sliced,
  });
});

app.get('/api/v1/orders/:id', (req, res) => {
  const store = readSyncStore();
  const key = req.params.id;
  const order = (store.bills || []).find(
    (b: any) => b.id === key || b.billNumber === key || b.externalOrderId === key
  );
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }
  return res.json({ success: true, revision: store.revision, order });
});

app.post('/api/v1/orders', (req, res) => {
  try {
    const store = readSyncStore();
    const body = req.body || {};

    // Idempotency guard via externalOrderId
    const externalOrderId = body.externalOrderId ? String(body.externalOrderId).trim() : undefined;
    if (externalOrderId) {
      const existingOrder = (store.bills || []).find(
        (b: any) => b.externalOrderId === externalOrderId
      );
      if (existingOrder) {
        return res.status(200).json({
          success: true,
          deduplicated: true,
          revision: store.revision,
          order: existingOrder,
        });
      }
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Order items array is required and must contain at least one item.',
      });
    }

    const deductStock = body.deductStock !== false;
    const allowNegativeStock = body.allowNegativeStock === true;
    const resolvedItems: any[] = [];
    const requestedPiecesByProduct = new Map<string, number>();

    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i] || {};
      const lookupKey = String(raw.productId || raw.barcode || '').trim();
      const matchedProduct = lookupKey
        ? findProductByIdOrBarcode(store.products || [], lookupKey)
        : null;

      if (!matchedProduct && !raw.productName) {
        return res.status(400).json({
          success: false,
          error: `Item at index ${i} could not be matched to a catalog SKU (${lookupKey || 'missing productId/barcode'}) and has no fallback productName.`,
        });
      }

      const unit: 'bundle' | 'piece' =
        String(raw.unit || '').toLowerCase() === 'piece' ? 'piece' : 'bundle';
      const quantity = Math.max(1, Number(raw.quantity) || 1);
      const bundleUnitName = String(
        raw.bundleUnitName || matchedProduct?.bundleUnitName || 'Bundle'
      );
      const bundlePieces = Math.max(
        1,
        Number(raw.bundlePieces ?? matchedProduct?.bundlePieces ?? 1) || 1
      );

      let unitPrice = Number(raw.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        if (matchedProduct) {
          unitPrice =
            unit === 'bundle'
              ? Number(matchedProduct.bundlePrice) || 0
              : Number(matchedProduct.piecePrice) || 0;
        } else {
          return res.status(400).json({
            success: false,
            error: `Item at index ${i} requires a valid numeric unitPrice.`,
          });
        }
      }

      const totalPieces =
        unit === 'bundle' ? Math.round(quantity * bundlePieces) : Math.round(quantity);
      const itemTotal = Math.round(quantity * unitPrice * 100) / 100;

      const resolvedProductId = matchedProduct?.id || String(raw.productId || `custom_ext_${i}`);
      if (matchedProduct) {
        requestedPiecesByProduct.set(
          matchedProduct.id,
          (requestedPiecesByProduct.get(matchedProduct.id) || 0) + totalPieces
        );
      }

      resolvedItems.push({
        productId: resolvedProductId,
        productName: String(matchedProduct?.name || raw.productName),
        unit,
        bundleUnitName,
        bundlePieces,
        quantity,
        unitPrice,
        totalPieces,
        itemTotal,
      });
    }

    // Verify stock availability when deductStock is enabled
    if (deductStock && !allowNegativeStock) {
      const shortages: Array<{
        productId: string;
        productName: string;
        requestedPieces: number;
        availablePieces: number;
      }> = [];

      requestedPiecesByProduct.forEach((reqPcs, prodId) => {
        const prod = store.products.find((p: any) => p.id === prodId);
        const avail = Number(prod?.stockPieces) || 0;
        if (prod && avail < reqPcs) {
          shortages.push({
            productId: prod.id,
            productName: prod.name,
            requestedPieces: reqPcs,
            availablePieces: avail,
          });
        }
      });

      if (shortages.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Insufficient stock for one or more requested SKUs.',
          shortages,
        });
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const formattedDateTime = formatExternalDateTime(now);

    // Resolve or upsert customer
    const reqPhone = String(body.customerPhone || '').trim();
    const reqPhone10 = normalizeWaPhone(reqPhone);
    let customer =
      (body.customerId && store.customers.find((c: any) => c.id === body.customerId)) ||
      (reqPhone10.length >= 6 &&
        store.customers.find((c: any) => normalizeWaPhone(c.phone) === reqPhone10)) ||
      null;

    const reqCustomerName = String(body.customerName || '').trim();
    if (
      !customer &&
      body.createCustomerIfMissing !== false &&
      reqCustomerName &&
      reqCustomerName.toLowerCase() !== 'walk-in customer'
    ) {
      customer = {
        id: `cust_ext_${now.getTime()}`,
        name: reqCustomerName,
        phone: reqPhone,
        address: body.customerAddress ? String(body.customerAddress) : undefined,
        currentBalance: 0,
        creditWarningPct: 80,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.customers = upsertById(store.customers, customer);
    }

    const itemsTotal =
      Math.round(resolvedItems.reduce((sum, item) => sum + item.itemTotal, 0) * 100) / 100;
    const isGstBill = Boolean(body.isGstBill);
    const gstRate = isGstBill ? Math.max(0, Number(body.gstRate ?? 18) || 0) : 0;
    const totalGstAmount = isGstBill
      ? Math.round(((itemsTotal * gstRate) / 100) * 100) / 100
      : 0;
    const cgstAmount = isGstBill ? Math.round((totalGstAmount / 2) * 100) / 100 : undefined;
    const sgstAmount = isGstBill ? Math.round((totalGstAmount / 2) * 100) / 100 : undefined;

    const previousBalance = Number(customer?.currentBalance) || 0;
    const grandTotal =
      Math.round((itemsTotal + totalGstAmount + previousBalance) * 100) / 100;

    const allowedModes = new Set(['cash', 'upi', 'credit', 'partial']);
    const paymentMode: 'cash' | 'upi' | 'credit' | 'partial' = allowedModes.has(
      String(body.paymentMode || '').toLowerCase()
    )
      ? (String(body.paymentMode).toLowerCase() as 'cash' | 'upi' | 'credit' | 'partial')
      : 'credit';

    let amountReceived = Number(body.amountReceived);
    if (!Number.isFinite(amountReceived) || amountReceived < 0) {
      amountReceived = paymentMode === 'cash' || paymentMode === 'upi' ? grandTotal : 0;
    }
    amountReceived = Math.round(amountReceived * 100) / 100;
    const remainingBalance = Math.max(
      0,
      Math.round((grandTotal - amountReceived) * 100) / 100
    );

    const billId = `bill_ext_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
    const billNumber =
      String(body.billNumber || '').trim() || `EXT-${now.getTime().toString().slice(-6)}`;

    const createdBill = {
      id: billId,
      billNumber,
      timestamp: nowIso,
      formattedDateTime,
      customerId: customer?.id,
      customerName: customer?.name || reqCustomerName || 'Walk-in Customer',
      customerPhone: customer?.phone || reqPhone,
      items: resolvedItems,
      itemsTotal,
      isGstBill,
      gstRate: isGstBill ? gstRate : undefined,
      cgstAmount,
      sgstAmount,
      totalGstAmount: isGstBill ? totalGstAmount : undefined,
      gstNumber: isGstBill ? store.storeProfile?.gstin || '07AABCS1429B1Z1' : undefined,
      previousBalance,
      grandTotal,
      amountReceived,
      remainingBalance,
      paymentMode,
      syncStatus: 'synced',
      syncedAt: nowIso,
      source: 'external',
      externalOrderId,
      externalStatus: String(body.externalStatus || 'confirmed'),
      notes: body.notes ? String(body.notes) : 'Synced via External Integration API v1',
    };

    // Deduct stock if enabled
    const inventoryUpdated: any[] = [];
    if (deductStock) {
      requestedPiecesByProduct.forEach((reqPcs, prodId) => {
        const prod = store.products.find((p: any) => p.id === prodId);
        if (!prod) return;
        const prevStock = Number(prod.stockPieces) || 0;
        const nextStock = Math.max(0, prevStock - reqPcs);
        const updatedProd = {
          ...prod,
          stockPieces: nextStock,
          updatedAt: nowIso,
        };
        store.products = upsertById(store.products, updatedProd);
        inventoryUpdated.push({
          productId: prod.id,
          productName: prod.name,
          deductedPieces: reqPcs,
          previousStockPieces: prevStock,
          newStockPieces: nextStock,
        });
      });
    }

    // Update customer balance & khata log if customer exists
    if (customer) {
      const updatedCustomer = {
        ...customer,
        currentBalance: remainingBalance,
        updatedAt: nowIso,
      };
      store.customers = upsertById(store.customers, updatedCustomer);

      if (remainingBalance !== previousBalance) {
        store.khata = [
          {
            id: `khata_ext_${now.getTime()}`,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone || '',
            timestamp: nowIso,
            formattedDateTime,
            type: 'BILL',
            billId: createdBill.id,
            amount: itemsTotal + totalGstAmount,
            previousBalance,
            newBalance: remainingBalance,
            description: `External Order #${billNumber}${externalOrderId ? ` (${externalOrderId})` : ''}`,
          },
          ...(store.khata || []),
        ];
      }
    }

    store.bills = [createdBill, ...(store.bills || [])];
    store.revision += 1;
    store.lastSyncedAt = nowIso;
    writeSyncStore(store);

    return res.status(201).json({
      success: true,
      revision: store.revision,
      order: createdBill,
      inventoryUpdated,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to create external order.',
    });
  }
});

app.patch('/api/v1/orders/:id/status', (req, res) => {
  try {
    const store = readSyncStore();
    const key = req.params.id;
    const idx = (store.bills || []).findIndex(
      (b: any) => b.id === key || b.billNumber === key || b.externalOrderId === key
    );
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const body = req.body || {};
    const existing = store.bills[idx];
    const nextOrder = {
      ...existing,
      ...(body.externalStatus !== undefined ? { externalStatus: String(body.externalStatus) } : {}),
      ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      ...(body.paymentMode !== undefined ? { paymentMode: body.paymentMode } : {}),
      ...(body.amountReceived !== undefined && Number.isFinite(Number(body.amountReceived))
        ? {
            amountReceived: Math.max(0, Number(body.amountReceived)),
            remainingBalance: Math.max(
              0,
              Math.round((Number(existing.grandTotal) - Number(body.amountReceived)) * 100) / 100
            ),
          }
        : {}),
      syncedAt: new Date().toISOString(),
    };

    const nextBills = [...store.bills];
    nextBills[idx] = nextOrder;
    store.bills = nextBills;
    store.revision += 1;
    store.lastSyncedAt = new Date().toISOString();
    writeSyncStore(store);

    return res.json({
      success: true,
      revision: store.revision,
      order: nextOrder,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to update order status.',
    });
  }
});

// =========================================================================
// ONLINE PRODUCT IMAGE SEARCH & CACHE FOR AUTO-FETCH PRODUCT VISUALS
// =========================================================================
interface OnlineProductImageCandidate {
  id: string;
  url: string;
  thumbnailUrl: string;
  title: string;
  source: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function searchBingImagesForProduct(query: string, limit = 12): Promise<OnlineProductImageCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const target = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=${limit + 6}&adlt=moderate`;
    const resp = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const matches = [...html.matchAll(/class="iusc"[^>]*m="([^"]+)"/g)];
    const out: OnlineProductImageCandidate[] = [];
    const seen = new Set<string>();

    for (const m of matches) {
      if (out.length >= limit) break;
      try {
        const meta = JSON.parse(decodeHtmlEntities(m[1]));
        const murl = typeof meta?.murl === 'string' ? meta.murl.trim() : '';
        const turl = typeof meta?.turl === 'string' ? meta.turl.trim() : '';
        const title = typeof meta?.t === 'string' ? meta.t.trim() : query;
        const primary = isSafePublicHttpUrl(murl) ? murl : isSafePublicHttpUrl(turl) ? turl : '';
        const thumb = isSafePublicHttpUrl(turl) ? turl : primary;
        if (!primary || seen.has(primary)) continue;
        seen.add(primary);
        let sourceHost = 'Web';
        try {
          sourceHost = new URL(primary).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
        out.push({
          id: `bing_${out.length}_${Buffer.from(primary).toString('base64').slice(0, 10)}`,
          url: primary,
          thumbnailUrl: thumb,
          title: title || query,
          source: sourceHost,
        });
      } catch {
        // skip malformed metadata entry
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikimediaImagesFallback(query: string, limit = 6): Promise<OnlineProductImageCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const target = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=${limit}&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json`;
    const resp = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SQEnterprisesPOS/1.0' },
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const out: OnlineProductImageCandidate[] = [];
    for (const page of pages) {
      const src = page?.thumbnail?.source;
      if (typeof src === 'string' && isSafePublicHttpUrl(src)) {
        out.push({
          id: `wiki_${page.pageid || out.length}`,
          url: src,
          thumbnailUrl: src,
          title: String(page?.title || query),
          source: 'wikipedia.org',
        });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/products/search-images', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Please enter at least 2 characters of the product name.',
      results: [],
    });
  }

  try {
    let results = await searchBingImagesForProduct(q, 12);
    let sourceLabel = 'Web Image Search';

    if (results.length === 0) {
      results = await searchWikimediaImagesFallback(q, 8);
      sourceLabel = 'Wikimedia Commons';
    }

    return res.json({
      success: true,
      query: q,
      source: sourceLabel,
      results,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to search online images.',
      results: [],
    });
  }
});

app.post('/api/products/cache-image', async (req, res) => {
  const rawUrl = String(req.body?.imageUrl || '').trim();
  const fallbackUrl = String(req.body?.fallbackUrl || '').trim();
  const candidates = [rawUrl, fallbackUrl].filter(u => u && isSafePublicHttpUrl(u));

  if (candidates.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'A valid HTTP/HTTPS image URL is required.',
    });
  }

  for (const candidateUrl of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(candidateUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      if (!resp.ok) continue;

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        continue;
      }

      const arrBuf = await resp.arrayBuffer();
      if (!arrBuf || arrBuf.byteLength === 0 || arrBuf.byteLength > 5 * 1024 * 1024) {
        continue;
      }

      const buffer = Buffer.from(arrBuf);
      const optimized = await sharp(buffer)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();

      const dataUrl = `data:image/jpeg;base64,${optimized.toString('base64')}`;
      return res.json({
        success: true,
        dataUrl,
        sourceUrl: candidateUrl,
      });
    } catch {
      // try fallback URL
    } finally {
      clearTimeout(timer);
    }
  }

  return res.status(422).json({
    success: false,
    error: 'Could not download or process the selected image.',
  });
});

// =========================================================================
// GEMINI 3.8 LIVE API — REAL-TIME VOICE CONVERSATION WEBSOCKET BRIDGE
// =========================================================================
const LIVE_VOICE_MODEL = 'gemini-3.8-live';
const ALLOWED_LIVE_VOICES = new Set(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir']);

const liveWss = new WebSocketServer({
  server: httpServer,
  path: '/api/live-voice',
});

function buildLiveSystemInstruction(storeContext: any): string {
  const storeName =
    typeof storeContext?.storeName === 'string' && storeContext.storeName.trim()
      ? storeContext.storeName.trim()
      : 'SQ Enterprises Wholesale POS';

  const lines: string[] = [
    `You are a friendly, sharp real-time voice assistant for "${storeName}", a wholesale & retail FMCG Point-of-Sale business.`,
    'Keep spoken responses natural, concise, and clear for a busy shop counter (usually 1-4 sentences unless more detail is requested).',
    'You understand and respond naturally in English, Hindi, or Hinglish matching the speaker.',
    'Currency is Indian Rupees (INR / ₹).',
  ];

  if (storeContext && typeof storeContext === 'object') {
    if (typeof storeContext.totalProducts === 'number') {
      lines.push(
        `Live Store Snapshot: ${storeContext.totalProducts} SKUs in catalog, ${Number(storeContext.lowStockCount || 0)} low-stock alerts, ${Number(storeContext.totalCustomers || 0)} customers, today's sales ₹${Number(storeContext.todaySales || 0).toLocaleString('en-IN')} across ${Number(storeContext.todayBillsCount || 0)} bills, total pending customer udhar ₹${Number(storeContext.totalPendingUdhar || 0).toLocaleString('en-IN')}.`
      );
    }
    if (Array.isArray(storeContext.lowStockSample) && storeContext.lowStockSample.length > 0) {
      lines.push(
        `Low Stock Items: ${storeContext.lowStockSample.slice(0, 15).join('; ')}.`
      );
    }
    if (Array.isArray(storeContext.catalogSample) && storeContext.catalogSample.length > 0) {
      lines.push(
        `Catalog Sample (Name | Prices | Stock): ${storeContext.catalogSample.slice(0, 45).join('; ')}.`
      );
    }
    if (Array.isArray(storeContext.topUdharSample) && storeContext.topUdharSample.length > 0) {
      lines.push(
        `Top Pending Udhar Balances: ${storeContext.topUdharSample.slice(0, 12).join('; ')}.`
      );
    }
  }

  return lines.join('\n');
}

function sendWsJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

liveWss.on('connection', (clientWs: WebSocket) => {
  let liveSession: any = null;
  let isConnecting = false;
  let isClosed = false;
  let readySent = false;

  const markReady = (voiceName: string) => {
    if (readySent || isClosed) return;
    readySent = true;
    sendWsJson(clientWs, {
      type: 'ready',
      model: LIVE_VOICE_MODEL,
      voiceName,
    });
  };

  const cleanupSession = () => {
    readySent = false;
    if (liveSession) {
      try {
        liveSession.close();
      } catch {
        // Ignore close errors
      }
      liveSession = null;
    }
  };

  clientWs.on('close', () => {
    isClosed = true;
    cleanupSession();
  });

  clientWs.on('error', () => {
    isClosed = true;
    cleanupSession();
  });

  clientWs.on('message', async (rawData) => {
    if (isClosed) return;

    let msg: any;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    if (msg?.type === 'start') {
      if (liveSession || isConnecting) return;

      if (!process.env.GEMINI_API_KEY) {
        sendWsJson(clientWs, {
          type: 'error',
          code: 'MISSING_API_KEY',
          error:
            'GEMINI_API_KEY is not configured on the server. Please configure it in the Settings > Secrets panel.',
        });
        return;
      }

      isConnecting = true;
      const requestedVoice = ALLOWED_LIVE_VOICES.has(msg.voiceName)
        ? msg.voiceName
        : 'Zephyr';
      const systemInstruction = buildLiveSystemInstruction(msg.storeContext);

      try {
        const session = await ai.live.connect({
          model: LIVE_VOICE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: requestedVoice },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              markReady(requestedVoice);
            },
            onmessage: (message: LiveServerMessage) => {
              if (isClosed) return;
              const content = message.serverContent;

              if (content?.inputTranscription?.text) {
                sendWsJson(clientWs, {
                  type: 'input_transcript',
                  text: content.inputTranscription.text,
                });
              }

              if (content?.outputTranscription?.text) {
                sendWsJson(clientWs, {
                  type: 'output_transcript',
                  text: content.outputTranscription.text,
                });
              }

              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  sendWsJson(clientWs, {
                    type: 'audio',
                    data: part.inlineData.data,
                  });
                }
              }

              if (content?.interrupted) {
                sendWsJson(clientWs, { type: 'interrupted' });
              }

              if (content?.turnComplete) {
                sendWsJson(clientWs, { type: 'turn_complete' });
              }
            },
            onerror: (err: any) => {
              if (isClosed) return;
              const rawMsg = String(err?.message || err || 'Live API connection error');
              const lower = rawMsg.toLowerCase();
              let friendly = rawMsg;
              if (lower.includes('permission') || lower.includes('403')) {
                friendly =
                  'Gemini Live API permission denied. Please verify your API key in the Settings > Secrets panel.';
              } else if (lower.includes('api_key') || lower.includes('invalid')) {
                friendly =
                  'Invalid Gemini API key. Please check your key in the Settings > Secrets panel.';
              } else if (lower.includes('quota') || lower.includes('429') || lower.includes('exhausted')) {
                friendly =
                  'Gemini Live API quota or rate limit reached. Please retry in a moment or check Settings > Secrets.';
              }
              sendWsJson(clientWs, {
                type: 'error',
                code: 'LIVE_API_ERROR',
                error: friendly,
              });
            },
            onclose: (event: any) => {
              liveSession = null;
              if (!isClosed) {
                sendWsJson(clientWs, {
                  type: 'closed',
                  reason: event?.reason || 'Live session closed',
                });
              }
            },
          },
        });

        if (isClosed) {
          try {
            session.close();
          } catch {
            // ignore
          }
          return;
        }

        liveSession = session;
        isConnecting = false;
        markReady(requestedVoice);
      } catch (err: any) {
        isConnecting = false;
        const rawMsg = String(err?.message || err || 'Failed to connect to Gemini Live API.');
        const lower = rawMsg.toLowerCase();
        let friendly = rawMsg;
        if (lower.includes('permission') || lower.includes('403')) {
          friendly =
            'Gemini Live API permission denied. Please verify your API key in the Settings > Secrets panel.';
        } else if (lower.includes('api_key') || lower.includes('api key')) {
          friendly =
            'Invalid Gemini API key. Please check your key in the Settings > Secrets panel.';
        } else if (lower.includes('not_found') || lower.includes('404')) {
          friendly =
            'Live model gemini-3.8-live was not found or is unavailable for this API key.';
        }
        sendWsJson(clientWs, {
          type: 'error',
          code: 'LIVE_CONNECT_FAILED',
          error: friendly,
        });
      }
      return;
    }

    if (msg?.type === 'audio' && typeof msg.data === 'string' && liveSession) {
      try {
        liveSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch {
        // Ignore transient send after close
      }
      return;
    }

    if (msg?.type === 'text' && typeof msg.text === 'string' && liveSession) {
      const trimmed = msg.text.trim();
      if (!trimmed) return;
      try {
        liveSession.sendRealtimeInput({ text: trimmed });
      } catch {
        // Ignore transient send after close
      }
      return;
    }

    if (msg?.type === 'stop') {
      cleanupSession();
      sendWsJson(clientWs, { type: 'closed', reason: 'Stopped by user' });
    }
  });
});

// =========================================================================
// NETWORK IP & WIFI RAW TCP THERMAL PRINTER BRIDGE (PORT 9100 / CUSTOM)
// =========================================================================
function validateTcpPrinterTarget(
  rawHost: unknown,
  rawPort: unknown,
  rawTimeoutMs?: unknown
): { host: string; port: number; timeoutMs: number } | { error: string } {
  const host = typeof rawHost === 'string' ? rawHost.trim() : '';
  if (!host || host.length > 253 || /[\s/\\?#]/.test(host)) {
    return { error: 'Please enter a valid printer IP address or hostname (e.g. 192.168.1.100).' };
  }

  const parsedPort = Number(rawPort ?? 9100);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return { error: 'Printer TCP port must be between 1 and 65535 (standard ESC/POS port is 9100).' };
  }

  const parsedTimeout = Number(rawTimeoutMs ?? 4000);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(10000, Math.max(1000, Math.round(parsedTimeout)))
    : 4000;

  return { host, port: parsedPort, timeoutMs };
}

function formatTcpSocketError(err: any, host: string, port: number): string {
  const code = String(err?.code || '').toUpperCase();
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT') {
    return `Connection to ${host}:${port} timed out. Ensure the printer is powered on and reachable from the server network.`;
  }
  if (code === 'ECONNREFUSED') {
    return `Connection refused by ${host}:${port}. Verify the port (default 9100) and RAW printing mode on the printer.`;
  }
  if (code === 'ENOTFOUND') {
    return `Hostname "${host}" could not be resolved. Check the IP address or local mDNS hostname.`;
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `Printer ${host}:${port} is unreachable from this host network.`;
  }
  return err?.message || `Failed to reach printer at ${host}:${port}.`;
}

app.post('/api/printers/tcp/test', async (req, res) => {
  const target = validateTcpPrinterTarget(req.body?.host, req.body?.port, req.body?.timeoutMs);
  if ('error' in target) {
    return res.status(400).json({ success: false, reachable: false, error: target.error });
  }

  const startedAt = Date.now();

  await new Promise<void>((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: target.host, port: target.port });
    socket.setTimeout(target.timeoutMs);

    const finish = (statusCode: number, payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      res.status(statusCode).json(payload);
      resolve();
    };

    socket.on('connect', () => {
      const latencyMs = Date.now() - startedAt;
      finish(200, {
        success: true,
        reachable: true,
        host: target.host,
        port: target.port,
        latencyMs,
      });
    });

    socket.on('timeout', () => {
      finish(504, {
        success: false,
        reachable: false,
        host: target.host,
        port: target.port,
        error: formatTcpSocketError({ code: 'ETIMEDOUT' }, target.host, target.port),
      });
    });

    socket.on('error', (err) => {
      finish(502, {
        success: false,
        reachable: false,
        host: target.host,
        port: target.port,
        error: formatTcpSocketError(err, target.host, target.port),
      });
    });
  });
});

app.post('/api/printers/tcp/print', async (req, res) => {
  const target = validateTcpPrinterTarget(req.body?.host, req.body?.port, req.body?.timeoutMs);
  if ('error' in target) {
    return res.status(400).json({ success: false, error: target.error });
  }

  const payloadBase64 = typeof req.body?.payloadBase64 === 'string' ? req.body.payloadBase64.trim() : '';
  if (!payloadBase64) {
    return res.status(400).json({ success: false, error: 'Missing print payload.' });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payloadBase64, 'base64');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid base64 print payload.' });
  }

  if (buffer.length === 0 || buffer.length > 512 * 1024) {
    return res.status(400).json({
      success: false,
      error: 'Print payload must be between 1 byte and 512 KB.',
    });
  }

  const startedAt = Date.now();

  await new Promise<void>((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: target.host, port: target.port });
    socket.setTimeout(target.timeoutMs);

    const finish = (statusCode: number, payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      res.status(statusCode).json(payload);
      resolve();
    };

    socket.on('connect', () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) {
          finish(502, {
            success: false,
            error: formatTcpSocketError(writeErr, target.host, target.port),
          });
          return;
        }
        socket.end(() => {
          finish(200, {
            success: true,
            host: target.host,
            port: target.port,
            bytesSent: buffer.length,
            latencyMs: Date.now() - startedAt,
          });
        });
      });
    });

    socket.on('timeout', () => {
      finish(504, {
        success: false,
        error: formatTcpSocketError({ code: 'ETIMEDOUT' }, target.host, target.port),
      });
    });

    socket.on('error', (err) => {
      finish(502, {
        success: false,
        error: formatTcpSocketError(err, target.host, target.port),
      });
    });
  });
});

// =========================================================================
// MULTI-STORE MANAGEMENT & MULTI-BRANCH SYNCHRONIZATION ARCHITECTURE
// =========================================================================
function ensureMultiBranchStoreState(store: ServerSyncStore) {
  const nowIso = new Date().toISOString();
  if (!store.multiBranchConfig) {
    store.multiBranchConfig = {
      enabled: true,
      activeBranchId: 'branch_hq',
      syncCatalogAcrossBranches: true,
      syncInventoryTransfers: true,
      syncCustomersAndKhata: true,
      autoSyncIntervalSec: 30,
    };
  }
  if (!Array.isArray(store.branches) || store.branches.length === 0) {
    store.branches = [
      {
        id: 'branch_hq',
        code: 'HQ-01',
        name: store.storeProfile?.storeName || 'SQ ENTERPRISES (Main HQ)',
        city: 'Main Depot',
        address: store.storeProfile?.address || '',
        phone: store.storeProfile?.contactNumber || '',
        isHeadquarters: true,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }
  if (!store.branchSnapshots || typeof store.branchSnapshots !== 'object') {
    store.branchSnapshots = {};
  }
  if (!Array.isArray(store.branchTransfers)) {
    store.branchTransfers = [];
  }
}

function summarizeBranchFromSnapshot(branch: any, snapshot: any) {
  if (!snapshot || typeof snapshot !== 'object') return branch;
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const bills = Array.isArray(snapshot.bills) ? snapshot.bills : [];
  const todayStr = new Date().toISOString().slice(0, 10);
  let stockPiecesTotal = 0;
  for (const p of products) {
    stockPiecesTotal += Number(p?.stockPieces) || 0;
  }
  let todaySales = 0;
  let totalSales = 0;
  for (const b of bills) {
    const amt = Number(b?.itemsTotal) || 0;
    totalSales += amt;
    if (typeof b?.timestamp === 'string' && b.timestamp.slice(0, 10) === todayStr) {
      todaySales += amt;
    }
  }
  return {
    ...branch,
    skuCount: products.length,
    stockPiecesTotal,
    todaySales,
    totalSales,
    billsCount: bills.length,
    lastSyncedAt: snapshot.updatedAt || branch.lastSyncedAt,
  };
}

app.get('/api/branches', (_req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const enriched = store.branches!.map(b =>
    summarizeBranchFromSnapshot(b, store.branchSnapshots?.[b.id])
  );
  res.json({
    success: true,
    config: store.multiBranchConfig,
    branches: enriched,
    transfers: store.branchTransfers || [],
    revision: store.revision,
  });
});

app.post('/api/branches/config', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const next = req.body?.config || req.body || {};
  store.multiBranchConfig = {
    ...store.multiBranchConfig!,
    enabled:
      typeof next.enabled === 'boolean' ? next.enabled : store.multiBranchConfig!.enabled,
    activeBranchId:
      typeof next.activeBranchId === 'string' && next.activeBranchId.trim()
        ? next.activeBranchId.trim()
        : store.multiBranchConfig!.activeBranchId,
    syncCatalogAcrossBranches:
      typeof next.syncCatalogAcrossBranches === 'boolean'
        ? next.syncCatalogAcrossBranches
        : store.multiBranchConfig!.syncCatalogAcrossBranches,
    syncInventoryTransfers:
      typeof next.syncInventoryTransfers === 'boolean'
        ? next.syncInventoryTransfers
        : store.multiBranchConfig!.syncInventoryTransfers,
    syncCustomersAndKhata:
      typeof next.syncCustomersAndKhata === 'boolean'
        ? next.syncCustomersAndKhata
        : store.multiBranchConfig!.syncCustomersAndKhata,
    autoSyncIntervalSec:
      typeof next.autoSyncIntervalSec === 'number'
        ? Math.max(10, Math.min(300, Math.round(next.autoSyncIntervalSec)))
        : store.multiBranchConfig!.autoSyncIntervalSec,
    lastBranchSyncNote:
      typeof next.enabled === 'boolean' && !next.enabled
        ? 'Multi-branch synchronization paused'
        : store.multiBranchConfig!.lastBranchSyncNote,
  };
  writeSyncStore(store);
  res.json({
    success: true,
    config: store.multiBranchConfig,
  });
});

app.post('/api/branches', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const body = req.body?.branch || req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!name || !code) {
    return res.status(400).json({
      success: false,
      error: 'Both Branch Name and Branch Code are required.',
    });
  }

  const nowIso = new Date().toISOString();
  const branchId =
    typeof body.id === 'string' && body.id.trim()
      ? body.id.trim()
      : `branch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const existingIdx = store.branches!.findIndex(b => b.id === branchId);
  const baseBranch = {
    id: branchId,
    code,
    name,
    city: typeof body.city === 'string' ? body.city.trim() : '',
    address: typeof body.address === 'string' ? body.address.trim() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    managerName: typeof body.managerName === 'string' ? body.managerName.trim() : '',
    isHeadquarters: existingIdx > -1 ? Boolean(store.branches![existingIdx].isHeadquarters) : false,
    active: body.active !== false,
    createdAt: existingIdx > -1 ? store.branches![existingIdx].createdAt : nowIso,
    updatedAt: nowIso,
  };

  if (existingIdx > -1) {
    store.branches![existingIdx] = {
      ...store.branches![existingIdx],
      ...baseBranch,
    };
  } else {
    store.branches!.push(baseBranch);
  }

  if (req.body?.initialSnapshot && typeof req.body.initialSnapshot === 'object') {
    store.branchSnapshots![branchId] = {
      ...req.body.initialSnapshot,
      branchId,
      updatedAt: nowIso,
    };
  }

  writeSyncStore(store);
  const enriched = store.branches!.map(b =>
    summarizeBranchFromSnapshot(b, store.branchSnapshots?.[b.id])
  );
  res.json({
    success: true,
    branch: summarizeBranchFromSnapshot(baseBranch, store.branchSnapshots?.[branchId]),
    branches: enriched,
  });
});

app.delete('/api/branches/:id', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const targetId = req.params.id;
  const target = store.branches!.find(b => b.id === targetId);
  if (!target) {
    return res.status(404).json({ success: false, error: 'Branch not found.' });
  }
  if (target.isHeadquarters || targetId === 'branch_hq') {
    return res.status(400).json({
      success: false,
      error: 'The Headquarters (Main Store) branch cannot be deleted.',
    });
  }

  store.branches = store.branches!.filter(b => b.id !== targetId);
  if (store.branchSnapshots) {
    delete store.branchSnapshots[targetId];
  }
  if (store.multiBranchConfig!.activeBranchId === targetId) {
    store.multiBranchConfig!.activeBranchId = 'branch_hq';
  }
  writeSyncStore(store);

  res.json({
    success: true,
    config: store.multiBranchConfig,
    branches: store.branches!.map(b =>
      summarizeBranchFromSnapshot(b, store.branchSnapshots?.[b.id])
    ),
  });
});

app.get('/api/branches/:id/snapshot', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const snap = store.branchSnapshots?.[req.params.id] || null;
  res.json({
    success: true,
    branchId: req.params.id,
    snapshot: snap,
  });
});

app.post('/api/branches/:id/snapshot', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);
  const branchId = req.params.id;
  const snapshot = req.body?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({ success: false, error: 'Missing branch snapshot payload.' });
  }
  const nowIso = new Date().toISOString();
  store.branchSnapshots![branchId] = {
    ...snapshot,
    branchId,
    updatedAt: nowIso,
  };
  writeSyncStore(store);
  res.json({
    success: true,
    branchId,
    updatedAt: nowIso,
  });
});

app.post('/api/branches/sync', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);

  if (!store.multiBranchConfig!.enabled) {
    return res.status(403).json({
      success: false,
      syncDisabled: true,
      error:
        'Multi-branch synchronization is disabled. Turn ON the Multi-Branch Sync toggle switch to synchronize branches.',
    });
  }

  const nowIso = new Date().toISOString();
  const activeBranchId =
    typeof req.body?.activeBranchId === 'string' && req.body.activeBranchId.trim()
      ? req.body.activeBranchId.trim()
      : store.multiBranchConfig!.activeBranchId;

  if (req.body?.activeSnapshot && typeof req.body.activeSnapshot === 'object') {
    store.branchSnapshots![activeBranchId] = {
      ...req.body.activeSnapshot,
      branchId: activeBranchId,
      updatedAt: nowIso,
    };
  }

  const activeSnap = store.branchSnapshots?.[activeBranchId];

  // Cross-branch catalog synchronization (shares new SKUs & pricing definitions while keeping each branch's own stockPieces)
  if (store.multiBranchConfig!.syncCatalogAcrossBranches && activeSnap && Array.isArray(activeSnap.products)) {
    const sourceProducts: any[] = activeSnap.products;
    for (const branch of store.branches!) {
      if (branch.id === activeBranchId || !branch.active) continue;
      const targetSnap = store.branchSnapshots![branch.id];
      if (!targetSnap || !Array.isArray(targetSnap.products)) continue;

      const existingMap = new Map<string, any>(
        targetSnap.products.map((p: any) => [p.id, p])
      );
      for (const srcProd of sourceProducts) {
        const existing = existingMap.get(srcProd.id);
        if (existing) {
          // Keep target branch's local stockPieces, sync catalog details & prices
          existingMap.set(srcProd.id, {
            ...srcProd,
            stockPieces: existing.stockPieces,
          });
        } else {
          // New SKU added at source branch -> propagate with 0 local stock to other branches
          existingMap.set(srcProd.id, {
            ...srcProd,
            stockPieces: 0,
          });
        }
      }
      targetSnap.products = Array.from(existingMap.values());
      targetSnap.updatedAt = nowIso;
    }
  }

  // Cross-branch customer & Khata synchronization
  if (store.multiBranchConfig!.syncCustomersAndKhata && activeSnap && Array.isArray(activeSnap.customers)) {
    const mergedCustomers = new Map<string, any>();
    for (const branch of store.branches!) {
      const snap = store.branchSnapshots?.[branch.id];
      if (!snap || !Array.isArray(snap.customers)) continue;
      for (const c of snap.customers) {
        const prev = mergedCustomers.get(c.id);
        if (!prev || String(c.updatedAt || '') > String(prev.updatedAt || '')) {
          mergedCustomers.set(c.id, c);
        }
      }
    }
    const unifiedCustomers = Array.from(mergedCustomers.values());
    for (const branch of store.branches!) {
      const snap = store.branchSnapshots?.[branch.id];
      if (snap) {
        snap.customers = unifiedCustomers;
      }
    }
  }

  store.multiBranchConfig!.lastBranchSyncAt = nowIso;
  store.multiBranchConfig!.lastBranchSyncNote = `Synced ${store.branches!.length} branch${
    store.branches!.length === 1 ? '' : 'es'
  }`;
  store.revision += 1;
  writeSyncStore(store);

  const enriched = store.branches!.map(b =>
    summarizeBranchFromSnapshot(b, store.branchSnapshots?.[b.id])
  );

  res.json({
    success: true,
    syncedAt: nowIso,
    revision: store.revision,
    config: store.multiBranchConfig,
    branches: enriched,
    transfers: store.branchTransfers || [],
    syncedActiveSnapshot: store.branchSnapshots?.[activeBranchId] || null,
  });
});

app.post('/api/branches/transfer', (req, res) => {
  const store = readSyncStore();
  ensureMultiBranchStoreState(store);

  if (!store.multiBranchConfig!.enabled) {
    return res.status(403).json({
      success: false,
      syncDisabled: true,
      error:
        'Multi-branch synchronization is disabled. Enable the Multi-Branch Sync toggle to transfer stock between branches.',
    });
  }

  const fromBranchId = String(req.body?.fromBranchId || '').trim();
  const toBranchId = String(req.body?.toBranchId || '').trim();
  const productId = String(req.body?.productId || '').trim();
  const pieces = Math.round(Number(req.body?.pieces || 0));
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const createdBy = typeof req.body?.createdBy === 'string' ? req.body.createdBy.trim() : '';

  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) {
    return res.status(400).json({
      success: false,
      error: 'Please select two different branches for stock transfer.',
    });
  }
  if (!productId || !Number.isFinite(pieces) || pieces <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Please choose a product and a valid positive piece quantity.',
    });
  }

  const fromBranch = store.branches!.find(b => b.id === fromBranchId);
  const toBranch = store.branches!.find(b => b.id === toBranchId);
  if (!fromBranch || !toBranch) {
    return res.status(404).json({ success: false, error: 'Source or destination branch not found.' });
  }

  const nowIso = new Date().toISOString();
  let productName = String(req.body?.productName || 'Product');

  const fromSnap = store.branchSnapshots?.[fromBranchId];
  const toSnap = store.branchSnapshots?.[toBranchId];

  if (fromSnap && Array.isArray(fromSnap.products)) {
    const srcProd = fromSnap.products.find((p: any) => p.id === productId);
    if (srcProd) {
      productName = srcProd.name || productName;
      if ((Number(srcProd.stockPieces) || 0) < pieces) {
        return res.status(409).json({
          success: false,
          error: `Insufficient stock in ${fromBranch.name}: available ${srcProd.stockPieces || 0} pcs.`,
        });
      }
      srcProd.stockPieces = Math.max(0, (Number(srcProd.stockPieces) || 0) - pieces);
      fromSnap.updatedAt = nowIso;

      if (toSnap && Array.isArray(toSnap.products)) {
        const destProd = toSnap.products.find((p: any) => p.id === productId);
        if (destProd) {
          destProd.stockPieces = (Number(destProd.stockPieces) || 0) + pieces;
        } else {
          toSnap.products.push({ ...srcProd, stockPieces: pieces });
        }
        toSnap.updatedAt = nowIso;
      }
    }
  }

  const transfer = {
    id: `trf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    transferNumber: `TRF-${String(Date.now()).slice(-6)}`,
    fromBranchId,
    fromBranchName: fromBranch.name,
    toBranchId,
    toBranchName: toBranch.name,
    productId,
    productName,
    pieces,
    note,
    status: 'completed' as const,
    timestamp: nowIso,
    createdBy,
  };

  store.branchTransfers = [transfer, ...(store.branchTransfers || [])].slice(0, 200);
  store.multiBranchConfig!.lastBranchSyncAt = nowIso;
  store.revision += 1;
  writeSyncStore(store);

  res.json({
    success: true,
    transfer,
    branches: store.branches!.map(b =>
      summarizeBranchFromSnapshot(b, store.branchSnapshots?.[b.id])
    ),
    transfers: store.branchTransfers,
  });
});

// =========================================================================
// APP LOCK FORGOT PIN: EMAIL VERIFICATION OTP DISPATCH & VERIFICATION
// =========================================================================
interface RecoveryOtpRecord {
  sessionId: string;
  email: string;
  codeHash: string;
  expiresAt: number;
  attemptsLeft: number;
  verified: boolean;
  resetToken?: string;
  createdAt: number;
}

const recoveryOtpStore = new Map<string, RecoveryOtpRecord>();
const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;

function pruneExpiredRecoveryOtps() {
  const now = Date.now();
  for (const [id, rec] of recoveryOtpStore.entries()) {
    if (rec.expiresAt <= now) {
      recoveryOtpStore.delete(id);
    }
  }
}

function maskRecoveryEmailServer(email: string): string {
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, Math.max(2, local.length - 2)))}${local.slice(-1)}@${domain}`;
}

app.post('/api/auth/recovery/send-code', async (req, res) => {
  pruneExpiredRecoveryOtps();
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const storeName =
    typeof req.body?.storeName === 'string' && req.body.storeName.trim()
      ? req.body.storeName.trim()
      : 'SQ ENTERPRISES POS';

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail)) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a valid recovery email address.',
    });
  }

  const otpCode = String(crypto.randomInt(100000, 1000000));
  const sessionId = `rec_${crypto.randomBytes(12).toString('hex')}`;
  const codeHash = crypto
    .createHash('sha256')
    .update(`${sessionId}:${otpCode}`)
    .digest('hex');

  const now = Date.now();
  recoveryOtpStore.set(sessionId, {
    sessionId,
    email: rawEmail,
    codeHash,
    expiresAt: now + RECOVERY_OTP_TTL_MS,
    attemptsLeft: 5,
    verified: false,
    createdAt: now,
  });

  const subject = `[${storeName}] Master PIN Recovery Verification Code: ${otpCode}`;
  const textBody = `Your 6-digit Master PIN recovery verification code for ${storeName} is ${otpCode}. It expires in 10 minutes. If you did not request a PIN reset, ignore this message.`;
  const htmlBody = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:12px;"><h2 style="margin:0 0 8px;color:#0f172a;">${storeName} · PIN Recovery</h2><p style="color:#475569;font-size:14px;">Enter this 6-digit verification code to reset your 4-digit Master PIN:</p><div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:14px 18px;background:#f8fafc;border-radius:10px;text-align:center;color:#0f172a;">${otpCode}</div><p style="color:#64748b;font-size:12px;margin-top:14px;">This code expires in 10 minutes.</p></div>`;

  // Dispatch via Resend if configured
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    try {
      const fromAddr =
        (process.env.RECOVERY_FROM_EMAIL || '').trim() || 'POS Security <onboarding@resend.dev>';
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [rawEmail],
          subject,
          text: textBody,
          html: htmlBody,
        }),
      });
      if (emailResp.ok) {
        return res.json({
          success: true,
          recoverySessionId: sessionId,
          maskedEmail: maskRecoveryEmailServer(rawEmail),
          expiresInMinutes: 10,
          deliveryChannel: 'resend_email',
        });
      }
    } catch (mailErr) {
      console.warn('Resend email dispatch fallback:', (mailErr as Error)?.message);
    }
  }

  // Dispatch via custom SMTP/Email webhook if configured
  const webhookUrl = (process.env.SMTP_WEBHOOK_URL || '').trim();
  if (webhookUrl) {
    try {
      const hookResp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: rawEmail,
          subject,
          text: textBody,
          html: htmlBody,
          code: otpCode,
          storeName,
        }),
      });
      if (hookResp.ok) {
        return res.json({
          success: true,
          recoverySessionId: sessionId,
          maskedEmail: maskRecoveryEmailServer(rawEmail),
          expiresInMinutes: 10,
          deliveryChannel: 'webhook_email',
        });
      }
    } catch (hookErr) {
      console.warn('Email webhook dispatch fallback:', (hookErr as Error)?.message);
    }
  }

  // Sandbox dispatch when external SMTP/Resend key is not configured
  return res.json({
    success: true,
    recoverySessionId: sessionId,
    maskedEmail: maskRecoveryEmailServer(rawEmail),
    expiresInMinutes: 10,
    deliveryChannel: 'sandbox_preview',
    previewCode: otpCode,
  });
});

app.post('/api/auth/recovery/verify-code', (req, res) => {
  pruneExpiredRecoveryOtps();
  const sessionId =
    typeof req.body?.recoverySessionId === 'string' ? req.body.recoverySessionId.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';

  if (!sessionId || !email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'Please enter the 6-digit verification code sent to your recovery email.',
    });
  }

  const record = recoveryOtpStore.get(sessionId);
  if (!record || record.expiresAt <= Date.now()) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'Verification code expired or not found. Please request a new code.',
    });
  }

  if (record.email !== email) {
    return res.status(403).json({
      success: false,
      verified: false,
      error: 'Email address does not match the verification request.',
    });
  }

  if (record.attemptsLeft <= 0) {
    recoveryOtpStore.delete(sessionId);
    return res.status(429).json({
      success: false,
      verified: false,
      attemptsLeft: 0,
      error: 'Too many invalid verification attempts. Request a new code.',
    });
  }

  const submittedHash = crypto
    .createHash('sha256')
    .update(`${sessionId}:${code}`)
    .digest('hex');

  if (submittedHash !== record.codeHash) {
    record.attemptsLeft = Math.max(0, record.attemptsLeft - 1);
    return res.status(401).json({
      success: false,
      verified: false,
      attemptsLeft: record.attemptsLeft,
      error:
        record.attemptsLeft > 0
          ? `Incorrect verification code (${record.attemptsLeft} attempt${
              record.attemptsLeft === 1 ? '' : 's'
            } remaining).`
          : 'Too many failed code attempts. Request a new verification code.',
    });
  }

  record.verified = true;
  record.resetToken = crypto.randomBytes(24).toString('hex');
  recoveryOtpStore.delete(sessionId);

  return res.json({
    success: true,
    verified: true,
    resetToken: record.resetToken,
  });
});

// Mount Vite middleware in dev or serve static files in production
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
