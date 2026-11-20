import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioListMode,
  AudioTranscribedItem,
  CartItem,
  Product,
  SavedAudioItemList,
  UnitType,
} from '../types';
import {
  buildFormattedItemListText,
  buildItemListCsv,
  createEmptyAudioListItem,
  deleteSavedAudioList,
  formatAudioDuration,
  formatFileSize,
  getDefaultListTitleForMode,
  getStoredAudioLists,
  inferAudioMimeType,
  normalizeTranscribedItems,
  resolveUnitForMatchedProduct,
  upsertSavedAudioList,
} from '../utils/audioTranscribe';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { hasConfiguredBundleTier, hasConfiguredPieceTier } from '../utils/unitSpecs';
import {
  AlertCircle,
  BookmarkCheck,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  FileAudio,
  History,
  ListChecks,
  Loader2,
  Mic,
  Minus,
  PackageCheck,
  Pause,
  Play,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface AudioTranscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialMode?: AudioListMode;
  onLoadItemsToCart: (items: CartItem[]) => void;
  onApplyStockUpdate: (
    updates: Array<{ productId: string; addedPieces: number; productName: string }>
  ) => void;
  onCreateProductFromAudioItem?: (draft: {
    name: string;
    unitType: UnitType;
    unitPrice: number;
  }) => void;
}

const SUPPORTED_AUDIO_EXTENSIONS = '.mp3,.wav,.webm,.m4a,.ogg,.aac,.flac,.opus,audio/*';
const MAX_AUDIO_FILE_BYTES = 15 * 1024 * 1024;
const METER_BAR_COUNT = 20;

export const AudioTranscribeModal: React.FC<AudioTranscribeModalProps> = ({
  isOpen,
  onClose,
  products,
  initialMode = 'cart',
  onLoadItemsToCart,
  onApplyStockUpdate,
  onCreateProductFromAudioItem,
}) => {
  const [activeView, setActiveView] = useState<'workspace' | 'saved'>('workspace');
  const [inputTab, setInputTab] = useState<'microphone' | 'upload'>('microphone');
  const [listMode, setListMode] = useState<AudioListMode>(initialMode);
  const [autoTranscribeOnStop, setAutoTranscribeOnStop] = useState<boolean>(true);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(() =>
    Array.from({ length: METER_BAR_COUNT }, () => 0.12)
  );
  const [micError, setMicError] = useState<string | null>(null);

  // Active audio payload (from either recording or file upload)
  const [audioSourceType, setAudioSourceType] = useState<'microphone' | 'upload' | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [audioFileSize, setAudioFileSize] = useState<number>(0);
  const [audioMimeType, setAudioMimeType] = useState<string>('');
  const [audioBase64, setAudioBase64] = useState<string>('');
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Transcription & item list state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isReparsing, setIsReparsing] = useState(false);
  const [transcribeElapsedSec, setTranscribeElapsedSec] = useState(0);
  const [transcribeDurationMs, setTranscribeDurationMs] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string>('');
  const [listTitle, setListTitle] = useState<string>(() => getDefaultListTitleForMode(initialMode));
  const [items, setItems] = useState<AudioTranscribedItem[]>([]);
  const [activeSavedListId, setActiveSavedListId] = useState<string | null>(null);
  const [savedLists, setSavedLists] = useState<SavedAudioItemList[]>(() => getStoredAudioLists());

  // Feedback & errors
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedList, setCopiedList] = useState(false);

  // Refs for cleanup
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const micSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined';

  // Sync mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setListMode(initialMode);
      setSavedLists(getStoredAudioLists());
      if (!transcript && items.length === 0) {
        setListTitle(getDefaultListTitleForMode(initialMode));
      }
    }
  }, [isOpen, initialMode]);

  // Elapsed timer while transcribing
  useEffect(() => {
    if (!isTranscribing) {
      setTranscribeElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setTranscribeElapsedSec(prev => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isTranscribing]);

  const stopRecordingHardware = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (analyserRafRef.current !== null) {
      cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setAudioLevels(Array.from({ length: METER_BAR_COUNT }, () => 0.12));
  };

  // Cleanup when modal closes or unmounts
  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsTranscribing(false);
        setIsReparsing(false);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.onstop = null;
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      stopRecordingHardware();
      setIsRecording(false);
      setIsPaused(false);
    }
    return () => {
      if (!isOpen) return;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      stopRecordingHardware();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
    }, 3600);
  };

  const replaceObjectUrl = (nextUrl: string | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = nextUrl;
    setAudioObjectUrl(nextUrl);
  };

  // Metrics derived from items
  const selectedItems = useMemo(
    () => items.filter(i => i.enabled && i.productName.trim().length > 0),
    [items]
  );

  const matchedSelectedItems = useMemo(
    () =>
      selectedItems.filter(
        i => i.selectedProductId && i.selectedProductId !== 'CUSTOM' && i.selectedProductId !== 'SKIP'
      ),
    [selectedItems]
  );

  const customSelectedCount = selectedItems.length - matchedSelectedItems.length;

  const listSummary = useMemo(() => {
    let totalPieces = 0;
    let estimatedValue = 0;
    for (const item of selectedItems) {
      const pcs =
        item.unitType === 'bundle'
          ? item.quantity * Math.max(1, item.bundlePieces || 1)
          : item.quantity;
      totalPieces += pcs;
      estimatedValue += item.quantity * (item.unitPrice || 0);
    }
    return {
      totalPieces: Math.round(totalPieces * 100) / 100,
      estimatedValue: Math.round(estimatedValue * 100) / 100,
    };
  }, [selectedItems]);

  if (!isOpen) return null;

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Could not read audio data.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed reading audio bytes.'));
      reader.readAsDataURL(blob);
    });

  const runAudioTranscription = async (
    payloadBase64: string,
    mimeType: string,
    fileName?: string
  ) => {
    if (!payloadBase64) return;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranscribing(true);
    setErrorMsg(null);
    setWarningMsg(null);

    try {
      const compactCatalog = products.slice(0, 80).map(p => ({
        id: p.id,
        name: p.name,
        bundleUnitName: p.bundleUnitName,
        bundlePieces: p.bundlePieces,
        bundlePrice: p.bundlePrice,
        piecePrice: p.piecePrice,
        category: p.category,
      }));

      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          audioBase64: payloadBase64,
          mimeType,
          fileName,
          existingProducts: compactCatalog,
          mode: listMode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Transcription failed (HTTP ${res.status}).`);
      }

      soundManager.playCheckoutSuccess();
      setTranscript(data.transcript || '');
      setDetectedLanguage(data.detectedLanguage || '');
      setTranscribeDurationMs(typeof data.processingTimeMs === 'number' ? data.processingTimeMs : null);
      if (data.listTitle) {
        setListTitle(data.listTitle);
      }
      if (data.parseWarning) {
        setWarningMsg(data.parseWarning);
      }

      const normalized = normalizeTranscribedItems(data.items || [], products);
      setItems(normalized);
      setActiveSavedListId(null);

      if (normalized.length > 0) {
        showToast(`Transcribed ${normalized.length} item${normalized.length === 1 ? '' : 's'} with Gemini 3.5`);
      } else {
        setWarningMsg('Transcript generated, but no specific item lines were detected. You can add rows manually or edit the transcript and tap Re-Extract.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setErrorMsg('Transcription cancelled.');
      } else {
        soundManager.playAlertSound();
        setErrorMsg(err?.message || 'Failed to transcribe audio.');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsTranscribing(false);
    }
  };

  const handleReparseTranscript = async () => {
    const cleanText = transcript.trim();
    if (!cleanText) {
      setErrorMsg('Transcript text is empty. Enter or transcribe audio text first.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsReparsing(true);
    setErrorMsg(null);
    setWarningMsg(null);

    try {
      const compactCatalog = products.slice(0, 80).map(p => ({
        id: p.id,
        name: p.name,
        bundleUnitName: p.bundleUnitName,
        bundlePieces: p.bundlePieces,
        bundlePrice: p.bundlePrice,
        piecePrice: p.piecePrice,
        category: p.category,
      }));

      const res = await fetch('/api/audio/parse-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          transcript: cleanText,
          existingProducts: compactCatalog,
          mode: listMode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not extract item list from text.');
      }

      const normalized = normalizeTranscribedItems(data.items || [], products);
      setItems(normalized);
      if (data.listTitle && (!listTitle || listTitle.startsWith('Voice Order') || listTitle.startsWith('Audio Item List'))) {
        setListTitle(data.listTitle);
      }
      soundManager.playCheckoutSuccess();
      showToast(`Extracted ${normalized.length} item${normalized.length === 1 ? '' : 's'} from transcript`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        soundManager.playAlertSound();
        setErrorMsg(err?.message || 'Failed to extract item list from text.');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsReparsing(false);
    }
  };

  // Start microphone recording
  const handleStartRecording = async () => {
    setMicError(null);
    setErrorMsg(null);
    if (!micSupported) {
      setMicError('Microphone recording is not supported in this browser. Please upload an audio file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredMimes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenMime = preferredMimes.find(m =>
        typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(m) : false
      );

      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const mime = recorder.mimeType || chosenMime || 'audio/webm';
        const recordedBlob = new Blob(audioChunksRef.current, { type: mime });
        stopRecordingHardware();
        setIsRecording(false);
        setIsPaused(false);

        if (recordedBlob.size === 0) {
          setMicError('Recorded audio was empty. Please speak for at least 1 second.');
          return;
        }

        if (recordedBlob.size > MAX_AUDIO_FILE_BYTES) {
          setMicError('Recording exceeds the 15 MB limit. Please record a shorter clip.');
          return;
        }

        const cleanMime = mime.split(';')[0] || 'audio/webm';
        const ext = cleanMime.includes('mp4') ? 'm4a' : cleanMime.includes('ogg') ? 'ogg' : 'webm';
        const generatedName = `voice-recording-${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.${ext}`;

        try {
          const dataUrl = await blobToDataUrl(recordedBlob);
          const url = URL.createObjectURL(recordedBlob);
          replaceObjectUrl(url);
          setAudioSourceType('microphone');
          setAudioFileName(generatedName);
          setAudioFileSize(recordedBlob.size);
          setAudioMimeType(cleanMime);
          setAudioBase64(dataUrl);

          if (autoTranscribeOnStop) {
            void runAudioTranscription(dataUrl, cleanMime, generatedName);
          }
        } catch (err: any) {
          setErrorMsg(err?.message || 'Could not process recorded audio.');
        }
      };

      // Live level visualizer via AudioContext
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateMeter = () => {
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
            if (mediaRecorderRef.current.state === 'paused') {
              analyserRafRef.current = requestAnimationFrame(updateMeter);
              return;
            }
            analyser.getByteFrequencyData(dataArray);
            const bars: number[] = [];
            for (let i = 0; i < METER_BAR_COUNT; i++) {
              const idx = Math.min(dataArray.length - 1, Math.floor((i / METER_BAR_COUNT) * dataArray.length));
              const normalized = Math.max(0.12, Math.min(1, dataArray[idx] / 180));
              bars.push(normalized);
            }
            setAudioLevels(bars);
            analyserRafRef.current = requestAnimationFrame(updateMeter);
          };
          analyserRafRef.current = requestAnimationFrame(updateMeter);
        }
      } catch {
        // Visualizer is optional; recording continues cleanly
      }

      setRecordingSec(0);
      setIsRecording(true);
      setIsPaused(false);
      soundManager.playScannerBeep();
      recorder.start(250);

      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      stopRecordingHardware();
      setIsRecording(false);
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicError('Microphone access was blocked. Allow microphone permission in your browser or upload an audio file.');
      } else if (name === 'NotFoundError') {
        setMicError('No microphone detected on this device. You can upload an audio file instead.');
      } else {
        setMicError(err?.message || 'Could not start microphone recording.');
      }
    }
  };

  const handleTogglePauseRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    soundManager.playMechanicalClick();
    if (rec.state === 'recording') {
      rec.pause();
      setIsPaused(true);
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
    } else if (rec.state === 'paused') {
      rec.resume();
      setIsPaused(false);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec(prev => prev + 1);
      }, 1000);
    }
  };

  const handleStopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      soundManager.playMechanicalClick();
      rec.stop();
    }
  };

  // Handle uploaded audio file
  const handleSelectAudioFile = async (file: File) => {
    setErrorMsg(null);
    setMicError(null);

    if (!file) return;
    if (file.size === 0) {
      setErrorMsg('Selected audio file is empty.');
      return;
    }
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      setErrorMsg('Audio file exceeds 15 MB. Please choose a smaller recording.');
      return;
    }

    const inferredMime = inferAudioMimeType(file);
    try {
      const dataUrl = await blobToDataUrl(file);
      const url = URL.createObjectURL(file);
      replaceObjectUrl(url);
      setInputTab('upload');
      setAudioSourceType('upload');
      setAudioFileName(file.name);
      setAudioFileSize(file.size);
      setAudioMimeType(inferredMime);
      setAudioBase64(dataUrl);
      soundManager.playMechanicalClick();
      void runAudioTranscription(dataUrl, inferredMime, file.name);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to read selected audio file.');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleSelectAudioFile(file);
    }
    e.target.value = '';
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleSelectAudioFile(file);
    }
  };

  // Item row mutations
  const updateItem = (itemId: string, patch: Partial<AudioTranscribedItem>) => {
    setItems(prev => prev.map(it => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const handleChangeSkuMatch = (itemId: string, nextProductId: string) => {
    soundManager.playMechanicalClick();
    if (nextProductId === 'CUSTOM' || nextProductId === 'SKIP') {
      updateItem(itemId, { selectedProductId: nextProductId });
      return;
    }
    const matched = products.find(p => p.id === nextProductId);
    if (!matched) return;

    setItems(prev =>
      prev.map(it => {
        if (it.id !== itemId) return it;
        const unitType = resolveUnitForMatchedProduct(matched, it.unitType);
        const unitPrice = unitType === 'bundle' ? matched.bundlePrice : matched.piecePrice;
        return {
          ...it,
          selectedProductId: matched.id,
          productName: matched.name,
          unitType,
          unitName: unitType === 'bundle' ? matched.bundleUnitName : 'Piece',
          bundlePieces: matched.bundlePieces,
          unitPrice,
          enabled: true,
        };
      })
    );
  };

  const handleSwitchItemUnit = (itemId: string, nextUnit: UnitType) => {
    soundManager.playMechanicalClick();
    setItems(prev =>
      prev.map(it => {
        if (it.id !== itemId) return it;
        const matched = products.find(p => p.id === it.selectedProductId);
        if (matched) {
          const unitPrice = nextUnit === 'bundle' ? matched.bundlePrice : matched.piecePrice;
          return {
            ...it,
            unitType: nextUnit,
            unitName: nextUnit === 'bundle' ? matched.bundleUnitName : 'Piece',
            bundlePieces: matched.bundlePieces,
            unitPrice,
          };
        }
        return {
          ...it,
          unitType: nextUnit,
          unitName: nextUnit === 'bundle' ? 'Bundle' : 'Piece',
        };
      })
    );
  };

  const handleRemoveItem = (itemId: string) => {
    soundManager.playMechanicalClick();
    setItems(prev => prev.filter(it => it.id !== itemId));
  };

  const handleAddBlankItem = () => {
    soundManager.playMechanicalClick();
    setItems(prev => [...prev, createEmptyAudioListItem()]);
  };

  const handleToggleAllItems = (checked: boolean) => {
    soundManager.playMechanicalClick();
    setItems(prev => prev.map(it => ({ ...it, enabled: checked })));
  };

  const handleClearWorkspace = () => {
    soundManager.playMechanicalClick();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    replaceObjectUrl(null);
    setAudioSourceType(null);
    setAudioFileName('');
    setAudioFileSize(0);
    setAudioMimeType('');
    setAudioBase64('');
    setTranscript('');
    setDetectedLanguage('');
    setTranscribeDurationMs(null);
    setItems([]);
    setActiveSavedListId(null);
    setListTitle(getDefaultListTitleForMode(listMode));
    setErrorMsg(null);
    setWarningMsg(null);
    setMicError(null);
  };

  // List actions: Save, Copy, Download CSV, Add to Cart, Restock
  const handleSaveCurrentList = () => {
    if (!transcript.trim() && items.length === 0) {
      setErrorMsg('Transcribe audio or add at least one item before saving the list.');
      return;
    }
    const nowIso = new Date().toISOString();
    const listId = activeSavedListId || `audio_list_${Date.now()}`;
    const existing = savedLists.find(l => l.id === listId);
    const payload: SavedAudioItemList = {
      id: listId,
      title: listTitle.trim() || getDefaultListTitleForMode(listMode),
      mode: listMode,
      sourceType: audioSourceType || 'upload',
      sourceFileName: audioFileName || undefined,
      transcript: transcript.trim(),
      detectedLanguage: detectedLanguage || undefined,
      items,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    const next = upsertSavedAudioList(payload);
    setSavedLists(next);
    setActiveSavedListId(listId);
    soundManager.playCheckoutSuccess();
    showToast('Saved item list to Audio Lists history');
  };

  const handleCopyTranscript = async () => {
    if (!transcript.trim()) return;
    try {
      await navigator.clipboard.writeText(transcript.trim());
      soundManager.playMechanicalClick();
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1800);
    } catch {
      setErrorMsg('Clipboard access blocked. Select and copy the transcript manually.');
    }
  };

  const handleCopyFormattedList = async () => {
    if (selectedItems.length === 0) return;
    const text = buildFormattedItemListText(listTitle, items, true);
    try {
      await navigator.clipboard.writeText(text);
      soundManager.playMechanicalClick();
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 1800);
      showToast('Item list copied to clipboard');
    } catch {
      setErrorMsg('Clipboard access blocked by browser.');
    }
  };

  const handleExportCsv = () => {
    if (selectedItems.length === 0) return;
    const csv = buildItemListCsv(listTitle, items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeSlug = (listTitle || 'audio-item-list')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    link.href = url;
    link.download = `${safeSlug || 'audio-item-list'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    soundManager.playMechanicalClick();
    showToast('Downloaded CSV item list');
  };

  const handleLoadToCart = () => {
    if (matchedSelectedItems.length === 0) {
      setErrorMsg(
        'Match at least one checked item to a Store Catalog SKU (or click "+ Save SKU") before adding to the Billing Cart.'
      );
      return;
    }

    const cartItems: CartItem[] = [];
    for (const item of matchedSelectedItems) {
      const product = products.find(p => p.id === item.selectedProductId);
      if (!product) continue;
      const unit = resolveUnitForMatchedProduct(product, item.unitType);
      const unitPrice =
        item.unitPrice > 0
          ? item.unitPrice
          : unit === 'bundle'
          ? product.bundlePrice
          : product.piecePrice;
      const totalPieces =
        unit === 'bundle' ? item.quantity * product.bundlePieces : item.quantity;

      cartItems.push({
        productId: product.id,
        productName: product.name,
        unit,
        bundleUnitName: product.bundleUnitName,
        bundlePieces: product.bundlePieces,
        quantity: item.quantity,
        unitPrice,
        totalPieces,
        itemTotal: Math.round(item.quantity * unitPrice * 100) / 100,
      });
    }

    if (cartItems.length === 0) return;
    soundManager.playCheckoutSuccess();
    onLoadItemsToCart(cartItems);
    onClose();
  };

  const handleApplyRestock = () => {
    if (matchedSelectedItems.length === 0) {
      setErrorMsg('Match at least one checked item to a Store Catalog SKU to restock inventory.');
      return;
    }

    const updates = matchedSelectedItems
      .map(item => {
        const product = products.find(p => p.id === item.selectedProductId);
        if (!product) return null;
        const addedPieces =
          item.unitType === 'bundle'
            ? item.quantity * Math.max(1, product.bundlePieces)
            : item.quantity;
        return {
          productId: product.id,
          productName: product.name,
          addedPieces: Math.max(1, Math.round(addedPieces)),
        };
      })
      .filter((u): u is { productId: string; addedPieces: number; productName: string } => Boolean(u));

    if (updates.length === 0) return;
    soundManager.playCheckoutSuccess();
    onApplyStockUpdate(updates);
    showToast(`Restocked ${updates.length} catalog SKU${updates.length === 1 ? '' : 's'}!`);
  };

  const handleLoadSavedList = (saved: SavedAudioItemList) => {
    soundManager.playMechanicalClick();
    setActiveSavedListId(saved.id);
    setListMode(saved.mode);
    setListTitle(saved.title);
    setTranscript(saved.transcript);
    setDetectedLanguage(saved.detectedLanguage || '');
    setItems(saved.items || []);
    setAudioFileName(saved.sourceFileName || '');
    setAudioSourceType(saved.sourceType);
    setErrorMsg(null);
    setWarningMsg(null);
    setActiveView('workspace');
  };

  const handleDeleteSavedList = (id: string) => {
    soundManager.playMechanicalClick();
    const next = deleteSavedAudioList(id);
    setSavedLists(next);
    if (activeSavedListId === id) {
      setActiveSavedListId(null);
    }
  };

  const allChecked = items.length > 0 && items.every(i => i.enabled);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-transcribe-modal-title"
    >
      <div className="bg-slate-900 border border-slate-800 w-full max-w-6xl h-[94vh] sm:h-[90vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2
              id="audio-transcribe-modal-title"
              className="text-base font-bold text-white flex items-center gap-2"
            >
              <Mic className="w-4 h-4 text-sky-400 flex-shrink-0" />
              <span className="truncate">Audio Transcribe &amp; Item List Builder</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              Record microphone audio or upload MP3/WAV/M4A files using Gemini 3.5 Transcribe
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Workspace vs Saved Lists Switcher */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setActiveView('workspace');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                  activeView === 'workspace'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>Transcribe</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSavedLists(getStoredAudioLists());
                  setActiveView('saved');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap tabular-nums transition ${
                  activeView === 'saved'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Saved Lists ({savedLists.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onClose();
              }}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
              aria-label="Close Audio Transcribe Modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast Notification */}
        {toastMsg && (
          <div className="mx-4 mt-3 px-3.5 py-2 rounded-xl bg-emerald-950/70 border border-emerald-700/60 text-emerald-200 text-xs font-semibold flex items-center justify-between gap-2 flex-shrink-0">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{toastMsg}</span>
            </span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="text-emerald-300 hover:text-white p-1"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        {activeView === 'saved' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {savedLists.length === 0 ? (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center bg-slate-950/50 border border-slate-800 rounded-2xl p-6">
                <History className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-sm font-semibold text-white">No saved audio item lists yet</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Record a voice note or upload an audio file in the Transcribe tab, then click Save List to store it here for quick reuse.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveView('workspace')}
                  className="mt-4 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition"
                >
                  Create Item List from Audio
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {savedLists.map(saved => {
                  const enabledCount = saved.items.filter(i => i.enabled).length;
                  const estTotal = saved.items
                    .filter(i => i.enabled)
                    .reduce((sum, i) => sum + i.quantity * (i.unitPrice || 0), 0);
                  return (
                    <div
                      key={saved.id}
                      className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-slate-700 transition"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-white leading-snug line-clamp-1">
                            {saved.title}
                          </h3>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedList(saved.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition"
                            aria-label={`Delete saved list ${saved.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                          <span>{saved.sourceType === 'microphone' ? 'Microphone' : 'Audio File'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{enabledCount} items</span>
                          {estTotal > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400 font-semibold">
                                {formatCurrency(estTotal)}
                              </span>
                            </>
                          )}
                        </div>

                        {saved.transcript && (
                          <p className="text-xs text-slate-400 line-clamp-3 bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 leading-relaxed">
                            {saved.transcript}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {new Date(saved.updatedAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleLoadSavedList(saved)}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition"
                        >
                          Open &amp; Edit
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
            {/* LEFT PANEL: Audio Input (Microphone + Upload) + Verbatim Transcript */}
            <div className="lg:col-span-5 lg:overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-900/60">
              {/* Target Purpose & Input Source Switcher */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-300">Audio Source</span>
                  <div className="flex items-center gap-1 p-0.5 rounded-xl bg-slate-950 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setInputTab('microphone');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                        inputTab === 'microphone'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>Microphone</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setInputTab('upload');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                        inputTab === 'upload'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload File</span>
                    </button>
                  </div>
                </div>

                {/* Microphone Recorder Surface */}
                {inputTab === 'microphone' && (
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-white">
                          {isRecording
                            ? isPaused
                              ? 'Recording Paused'
                              : 'Listening to Microphone'
                            : 'Dictate Order or Supply List'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Speak items &amp; quantities naturally (English / Hindi)
                        </p>
                      </div>
                      <span
                        className={`font-mono text-sm font-bold tabular-nums px-2.5 py-1 rounded-lg border ${
                          isRecording && !isPaused
                            ? 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                            : 'bg-slate-900 border-slate-800 text-slate-300'
                        }`}
                      >
                        {formatAudioDuration(recordingSec)}
                      </span>
                    </div>

                    {/* Live Level Bars */}
                    <div
                      className="h-12 px-3 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-1"
                      aria-hidden="true"
                    >
                      {audioLevels.map((lvl, idx) => (
                        <div
                          key={`meter_bar_${idx}`}
                          className={`flex-1 rounded-full transition-all duration-75 ${
                            isRecording && !isPaused
                              ? 'bg-sky-400'
                              : isPaused
                              ? 'bg-amber-400/60'
                              : 'bg-slate-700'
                          }`}
                          style={{ height: `${Math.round(lvl * 100)}%` }}
                        />
                      ))}
                    </div>

                    {micError && (
                      <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-700/50 text-rose-200 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <span>{micError}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {!isRecording ? (
                        <button
                          type="button"
                          onClick={() => void handleStartRecording()}
                          disabled={isTranscribing}
                          className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition active:scale-[0.98]"
                        >
                          <Mic className="w-4 h-4" />
                          <span>{audioBase64 ? 'Record New Audio' : 'Start Recording'}</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleTogglePauseRecording}
                            className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            {isPaused ? (
                              <>
                                <Play className="w-4 h-4 text-emerald-400" />
                                <span>Resume</span>
                              </>
                            ) : (
                              <>
                                <Pause className="w-4 h-4 text-amber-400" />
                                <span>Pause</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleStopRecording}
                            className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition active:scale-[0.98]"
                          >
                            <Square className="w-3.5 h-3.5 fill-white" />
                            <span>Stop &amp; Transcribe</span>
                          </button>
                        </>
                      )}
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoTranscribeOnStop}
                        onChange={e => setAutoTranscribeOnStop(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                      />
                      <span>Automatically transcribe with Gemini 3.5 when recording stops</span>
                    </label>
                  </div>
                )}

                {/* Audio File Upload Surface */}
                {inputTab === 'upload' && (
                  <div
                    onDragOver={e => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDropFile}
                    className={`p-5 rounded-2xl border-2 border-dashed text-center transition ${
                      isDragOver
                        ? 'border-sky-500 bg-sky-950/30'
                        : 'border-slate-700 bg-slate-950 hover:border-slate-600'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={SUPPORTED_AUDIO_EXTENSIONS}
                      onChange={handleFileInputChange}
                      className="hidden"
                    />
                    <FileAudio className="w-9 h-9 text-sky-400 mx-auto mb-2.5 stroke-[1.6]" />
                    <p className="text-xs font-semibold text-white">
                      Drop an audio file here or browse from device
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Supports MP3, WAV, M4A, WebM, OGG, AAC, FLAC · Max 15 MB
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isTranscribing}
                      className="mt-3.5 min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 transition active:scale-[0.98]"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Choose Audio File</span>
                    </button>
                  </div>
                )}

                {/* Active Audio Clip Preview & Transcribe Trigger */}
                {audioBase64 && (
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">
                          {audioFileName || 'Recorded Audio'}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 tabular-nums mt-0.5">
                          <span>{audioSourceType === 'microphone' ? 'Microphone' : 'Uploaded'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{audioMimeType.replace('audio/', '').toUpperCase()}</span>
                          {audioFileSize > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{formatFileSize(audioFileSize)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearWorkspace}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition"
                        title="Clear audio & list"
                        aria-label="Clear audio and list"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>

                    {audioObjectUrl && (
                      <audio
                        controls
                        src={audioObjectUrl}
                        className="w-full h-9 rounded-lg"
                      />
                    )}

                    <div className="flex items-center gap-2">
                      {isTranscribing ? (
                        <>
                          <div className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-sky-950/60 border border-sky-700/50 text-sky-200 text-xs font-semibold flex items-center justify-center gap-2 tabular-nums">
                            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                            <span>Transcribing via Gemini 3.5 ({transcribeElapsedSec}s)...</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => abortControllerRef.current?.abort()}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void runAudioTranscription(audioBase64, audioMimeType, audioFileName)
                          }
                          className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition active:scale-[0.98]"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span>
                            {transcript ? 'Re-Transcribe Audio' : 'Transcribe & Create Item List'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Error & Warning Messages */}
                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-700/60 text-rose-200 text-xs flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                    {audioBase64 && !isTranscribing && (
                      <button
                        type="button"
                        onClick={() =>
                          void runAudioTranscription(audioBase64, audioMimeType, audioFileName)
                        }
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold whitespace-nowrap flex-shrink-0"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}

                {warningMsg && (
                  <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-700/60 text-amber-200 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span>{warningMsg}</span>
                  </div>
                )}

                {/* Verbatim Transcript Editor */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-white">Transcript</span>
                      {(detectedLanguage || transcribeDurationMs !== null) && (
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {detectedLanguage ? detectedLanguage : ''}
                          {detectedLanguage && transcribeDurationMs !== null ? ' · ' : ''}
                          {transcribeDurationMs !== null
                            ? `${(transcribeDurationMs / 1000).toFixed(1)}s`
                            : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyTranscript}
                        disabled={!transcript.trim()}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition"
                      >
                        {copiedTranscript ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReparseTranscript()}
                        disabled={!transcript.trim() || isReparsing || isTranscribing}
                        className="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 disabled:opacity-40 text-sky-300 border border-sky-500/40 text-[11px] font-semibold flex items-center gap-1 transition"
                      >
                        {isReparsing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        <span>Extract List</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    rows={5}
                    placeholder="Transcribed speech appears here. You can also paste or edit text and tap Extract List..."
                    className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 leading-relaxed focus:outline-none focus:border-sky-500 resize-y"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Interactive Item List Builder & POS Actions */}
            <div className="lg:col-span-7 flex flex-col lg:overflow-hidden bg-slate-950/60">
              {/* List Header & Purpose Mode Selector */}
              <div className="p-4 border-b border-slate-800 bg-slate-900/50 space-y-3 flex-shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex-1 min-w-0">
                    <label htmlFor="audio-list-title-input" className="sr-only">
                      Item List Title
                    </label>
                    <input
                      id="audio-list-title-input"
                      type="text"
                      value={listTitle}
                      onChange={e => setListTitle(e.target.value)}
                      placeholder="Item List Name (e.g. Morning Wholesale Order)"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-bold text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 self-start sm:self-auto">
                    {(
                      [
                        { id: 'cart', label: 'Billing Cart' },
                        { id: 'restock', label: 'Restock' },
                        { id: 'list', label: 'General List' },
                      ] as const
                    ).map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setListMode(m.id);
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${
                          listMode === m.id
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* List Summary Strip & Select All */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-3">
                    {items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleToggleAllItems(!allChecked)}
                        className="flex items-center gap-1.5 text-slate-300 hover:text-white font-semibold"
                      >
                        {allChecked ? (
                          <CheckSquare className="w-4 h-4 text-sky-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                        <span>{allChecked ? 'Uncheck All' : 'Select All'}</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5 text-slate-400 tabular-nums">
                      <span>{selectedItems.length} selected</span>
                      <span aria-hidden="true">·</span>
                      <span>{listSummary.totalPieces} total pcs</span>
                      {listSummary.estimatedValue > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400 font-bold">
                            {formatCurrency(listSummary.estimatedValue)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddBlankItem}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </button>
                </div>
              </div>

              {/* Scrollable Item List Rows */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {items.length === 0 ? (
                  <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                    <ListChecks className="w-10 h-10 text-slate-600 mb-2.5 stroke-[1.5]" />
                    <p className="text-sm font-semibold text-slate-200">
                      Your transcribed item list will appear here
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
                      Record with your microphone or upload an audio file on the left (for example: &ldquo;5 bundles Gold Flake, 10 packets Parle G, 2 cartons Dettol soap&rdquo;), or add rows manually.
                    </p>
                  </div>
                ) : (
                  items.map(item => {
                    const matchedProduct = products.find(p => p.id === item.selectedProductId) || null;
                    const hasBundleOption = matchedProduct ? hasConfiguredBundleTier(matchedProduct) : true;
                    const hasPieceOption = matchedProduct ? hasConfiguredPieceTier(matchedProduct) : true;
                    const lineTotal = Math.round(item.quantity * (item.unitPrice || 0) * 100) / 100;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border transition ${
                          item.enabled
                            ? 'bg-slate-900 border-slate-800'
                            : 'bg-slate-950/60 border-slate-800/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              updateItem(item.id, { enabled: !item.enabled });
                            }}
                            className="mt-1 p-1 rounded-lg text-slate-300 hover:text-white flex-shrink-0"
                            aria-label={`Toggle ${item.productName || 'item'}`}
                          >
                            {item.enabled ? (
                              <CheckSquare className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500" />
                            )}
                          </button>

                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Name & Spoken Hint */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <input
                                type="text"
                                value={item.productName}
                                onChange={e => updateItem(item.id, { productName: e.target.value })}
                                placeholder="Item / Product name"
                                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                              />

                              <select
                                value={item.selectedProductId}
                                onChange={e => handleChangeSkuMatch(item.id, e.target.value)}
                                aria-label={`Match catalog SKU for ${item.productName}`}
                                className={`sm:w-52 px-2.5 py-1.5 rounded-lg border text-xs font-semibold focus:outline-none focus:border-sky-500 ${
                                  matchedProduct
                                    ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
                                    : 'bg-slate-950 border-slate-800 text-slate-300'
                                }`}
                              >
                                <option value="CUSTOM">Custom Item (Unlinked)</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>
                                    SKU: {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {item.spokenText && (
                              <p className="text-[11px] text-slate-400 truncate">
                                Spoken: &ldquo;{item.spokenText}&rdquo;
                                {item.notes ? ` · ${item.notes}` : ''}
                              </p>
                            )}

                            {/* Quantity, Unit, Rate & Remove Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                {/* Quantity Stepper */}
                                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      soundManager.playMechanicalClick();
                                      updateItem(item.id, {
                                        quantity: Math.max(1, item.quantity - 1),
                                      });
                                    }}
                                    className="px-2 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                                    aria-label="Decrease quantity"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    step="any"
                                    value={item.quantity}
                                    onChange={e => {
                                      const val = parseFloat(e.target.value);
                                      updateItem(item.id, {
                                        quantity: Number.isFinite(val) && val > 0 ? val : 1,
                                      });
                                    }}
                                    aria-label="Item quantity"
                                    className="w-12 py-1 bg-transparent text-center text-xs font-bold text-white tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      soundManager.playMechanicalClick();
                                      updateItem(item.id, { quantity: item.quantity + 1 });
                                    }}
                                    className="px-2 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                                    aria-label="Increase quantity"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Unit Switcher */}
                                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px]">
                                  {hasBundleOption && (
                                    <button
                                      type="button"
                                      onClick={() => handleSwitchItemUnit(item.id, 'bundle')}
                                      className={`px-2 py-1 rounded-md font-semibold whitespace-nowrap transition ${
                                        item.unitType === 'bundle'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-400 hover:text-white'
                                      }`}
                                    >
                                      {matchedProduct ? matchedProduct.bundleUnitName : 'Bundle'}
                                    </button>
                                  )}
                                  {hasPieceOption && (
                                    <button
                                      type="button"
                                      onClick={() => handleSwitchItemUnit(item.id, 'piece')}
                                      className={`px-2 py-1 rounded-md font-semibold whitespace-nowrap transition ${
                                        item.unitType === 'piece'
                                          ? 'bg-amber-700 text-white'
                                          : 'text-slate-400 hover:text-white'
                                      }`}
                                    >
                                      Piece
                                    </button>
                                  )}
                                </div>

                                {/* Unit Rate */}
                                <div className="relative w-24">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                    ₹
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={item.unitPrice || ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const val = parseFloat(e.target.value);
                                      updateItem(item.id, {
                                        unitPrice: Number.isFinite(val) && val >= 0 ? val : 0,
                                      });
                                    }}
                                    aria-label="Unit rate in INR"
                                    className="w-full pl-5 pr-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-right text-white tabular-nums focus:outline-none focus:border-sky-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {lineTotal > 0 && (
                                  <span className="text-xs font-bold text-white tabular-nums">
                                    {formatCurrency(lineTotal)}
                                  </span>
                                )}

                                {!matchedProduct &&
                                  item.productName.trim().length > 0 &&
                                  onCreateProductFromAudioItem && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onCreateProductFromAudioItem({
                                          name: item.productName.trim(),
                                          unitType: item.unitType,
                                          unitPrice: item.unitPrice,
                                        })
                                      }
                                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
                                      title="Create a new Store Catalog SKU from this transcribed item"
                                    >
                                      <PlusCircle className="w-3 h-3" />
                                      <span>Save SKU</span>
                                    </button>
                                  )}

                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.id)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-950 transition"
                                  aria-label={`Remove ${item.productName || 'item'}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer Action Bar */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2.5 flex-shrink-0">
                {customSelectedCount > 0 && (listMode === 'cart' || listMode === 'restock') && (
                  <p className="text-[11px] text-amber-300">
                    {customSelectedCount} checked item{customSelectedCount === 1 ? ' is' : 's are'} unlinked to a Store SKU — link via the SKU dropdown or save/export the list below.
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* List Management & Export Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveCurrentList}
                      disabled={!transcript.trim() && items.length === 0}
                      className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      <BookmarkCheck className="w-4 h-4 text-sky-400" />
                      <span>{activeSavedListId ? 'Update List' : 'Save List'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyFormattedList}
                      disabled={selectedItems.length === 0}
                      className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      {copiedList ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy List</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleExportCsv}
                      disabled={selectedItems.length === 0}
                      className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      <Download className="w-4 h-4" />
                      <span>CSV</span>
                    </button>
                  </div>

                  {/* POS Fulfillment CTAs */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApplyRestock}
                      disabled={matchedSelectedItems.length === 0}
                      className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-40 ${
                        listMode === 'restock'
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                          : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>Restock ({matchedSelectedItems.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleLoadToCart}
                      disabled={matchedSelectedItems.length === 0}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition active:scale-[0.98]"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      <span>Add to Cart ({matchedSelectedItems.length})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
