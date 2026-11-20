import React, { useEffect, useRef, useState } from 'react';
import {
  Bill,
  ReceiptTemplateType,
  PaperWidthType,
  ReceiptDesignConfig,
  ReceiptSettings,
  SavedCustomReceiptPreset,
  StoreProfile,
  PrinterConnectionType,
} from '../types';
import {
  buildWhatsAppBillText,
  buildUdharWhatsAppText,
  buildUdharSMSText,
  launchWhatsApp,
  launchSMS,
} from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import {
  getStoredReceiptSettings,
  saveReceiptSettings,
  getStoredStoreProfile,
  resolvePrinterConnectionsConfig,
} from '../utils/storage';
import {
  buildEscPosReceiptBytes,
  consumeThermalPaperRoll,
  dispatchEscPosPayload,
  getEnabledHardwarePrinters,
  getRemainingPaperMeters,
  isThermalPaperLow,
  PRINTER_TYPE_LABELS,
} from '../utils/printerManager';
import { RECEIPT_PRESET_DESIGNS, resolveReceiptDesign } from '../utils/receiptPresets';
import { ThermalReceiptPaper } from './ThermalReceiptPaper';
import {
  Printer,
  Share2,
  CheckCircle2,
  X,
  Copy,
  SlidersHorizontal,
  Zap,
  Boxes,
  MessageSquare,
  Send,
  Bell,
  ReceiptText,
  BookmarkCheck,
  Eye,
  Gauge,
  Bluetooth,
  Usb,
  Network,
  Wifi,
  AlertCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface ReceiptModalProps {
  bill: Bill;
  onClose: () => void;
  onOpenSettings?: () => void;
  storeProfile?: StoreProfile;
  receiptSettings?: ReceiptSettings;
  onUpdateReceiptSettings?: (settings: ReceiptSettings) => void;
  enableLiveReceiptRendering?: boolean;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  bill,
  onClose,
  onOpenSettings,
  storeProfile,
  receiptSettings: propReceiptSettings,
  onUpdateReceiptSettings,
  enableLiveReceiptRendering = true,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [showFullThermal, setShowFullThermal] = useState<boolean>(enableLiveReceiptRendering);

  // Initialize with stored preferences & store branding
  const activeProfile = storeProfile || getStoredStoreProfile();

  const storedSettings = propReceiptSettings || getStoredReceiptSettings();
  const printersConfig = resolvePrinterConnectionsConfig(storedSettings.printers);
  const enabledHardwarePrinters = getEnabledHardwarePrinters(printersConfig);

  const [template, setTemplate] = useState<ReceiptTemplateType>(storedSettings.template);
  const [paperWidth, setPaperWidth] = useState<PaperWidthType>(storedSettings.paperWidth);
  const [design, setDesign] = useState<ReceiptDesignConfig>(() => resolveReceiptDesign(storedSettings));
  const [activeCustomPresetId, setActiveCustomPresetId] = useState<string | undefined>(
    storedSettings.activeCustomPresetId
  );
  const savedCustomPresets = storedSettings.savedCustomPresets || [];
  const [autoSendWhatsApp, setAutoSendWhatsApp] = useState<boolean>(storedSettings.autoSendWhatsApp ?? false);
  const [selectedPrintTarget, setSelectedPrintTarget] = useState<PrinterConnectionType | 'browser'>(
    () => printersConfig.preferredType || 'browser'
  );
  const [isPrintingHardware, setIsPrintingHardware] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setShowFullThermal(enableLiveReceiptRendering);
  }, [bill.id, enableLiveReceiptRendering]);

  useEffect(() => {
    if (!propReceiptSettings) return;
    setTemplate(propReceiptSettings.template);
    setPaperWidth(propReceiptSettings.paperWidth);
    setDesign(resolveReceiptDesign(propReceiptSettings));
    setActiveCustomPresetId(propReceiptSettings.activeCustomPresetId);
    setAutoSendWhatsApp(propReceiptSettings.autoSendWhatsApp ?? false);
    const nextPrinters = resolvePrinterConnectionsConfig(propReceiptSettings.printers);
    setSelectedPrintTarget(prev => {
      if (prev === 'browser') return nextPrinters.preferredType || 'browser';
      const enabledList = getEnabledHardwarePrinters(nextPrinters);
      return enabledList.includes(prev) ? prev : nextPrinters.preferredType || 'browser';
    });
  }, [propReceiptSettings]);

  const persistSettingsUpdate = (nextSettings: ReceiptSettings) => {
    if (onUpdateReceiptSettings) {
      onUpdateReceiptSettings(nextSettings);
    } else {
      saveReceiptSettings(nextSettings);
    }
  };

  // Handle preset template toggle and persist choice
  const handleSwitchTemplate = (newTemplate: ReceiptTemplateType) => {
    soundManager.playMechanicalClick();
    const nextDesign = { ...RECEIPT_PRESET_DESIGNS[newTemplate] };
    setTemplate(newTemplate);
    setDesign(nextDesign);
    setActiveCustomPresetId(undefined);
    persistSettingsUpdate({
      ...storedSettings,
      template: newTemplate,
      paperWidth,
      autoSendWhatsApp,
      design: nextDesign,
      activeCustomPresetId: undefined,
    });
  };

  const handleSelectCustomPreset = (preset: SavedCustomReceiptPreset) => {
    soundManager.playMechanicalClick();
    setTemplate(preset.baseTemplate);
    setPaperWidth(preset.paperWidth);
    setDesign({ ...preset.design });
    setActiveCustomPresetId(preset.id);
    persistSettingsUpdate({
      ...storedSettings,
      template: preset.baseTemplate,
      paperWidth: preset.paperWidth,
      autoSendWhatsApp,
      design: preset.design,
      activeCustomPresetId: preset.id,
    });
  };

  const handleSwitchPaperWidth = (newWidth: PaperWidthType) => {
    soundManager.playMechanicalClick();
    setPaperWidth(newWidth);
    persistSettingsUpdate({
      ...storedSettings,
      template,
      paperWidth: newWidth,
      autoSendWhatsApp,
      design,
      activeCustomPresetId,
    });
  };

  const handleToggleAutoWhatsApp = () => {
    soundManager.playMechanicalClick();
    const nextVal = !autoSendWhatsApp;
    setAutoSendWhatsApp(nextVal);
    persistSettingsUpdate({
      ...storedSettings,
      template,
      paperWidth,
      autoSendWhatsApp: nextVal,
      design,
      activeCustomPresetId,
    });
  };

  const paperMetrics = getRemainingPaperMeters(printersConfig);
  const paperIsLow = isThermalPaperLow(printersConfig);
  const paperRemainingPct = Math.round(paperMetrics.remainingPct);

  const handleResetPaperRoll = () => {
    soundManager.playCheckoutSuccess();
    const nextPrinters = {
      ...printersConfig,
      paperRoll: {
        ...printersConfig.paperRoll!,
        estimatedRemainingPct: 100,
        usedMetersSinceReset: 0,
        billsPrintedSinceReset: 0,
        lastResetAt: new Date().toISOString(),
      },
    };
    persistSettingsUpdate({
      ...storedSettings,
      template,
      paperWidth,
      autoSendWhatsApp,
      design,
      activeCustomPresetId,
      printers: nextPrinters,
    });
  };

  const recordReceiptPaperUsed = (effectiveSettings: ReceiptSettings): boolean => {
    const wasLow = isThermalPaperLow(printersConfig);
    const nextPrinters = consumeThermalPaperRoll(printersConfig, bill, design);
    persistSettingsUpdate({
      ...effectiveSettings,
      printers: nextPrinters,
    });
    const triggeredAlert =
      !wasLow &&
      isThermalPaperLow(nextPrinters) &&
      nextPrinters.paperRoll?.alertSoundOnLowPaper !== false;
    if (triggeredAlert) {
      soundManager.playAlertSound();
    }
    return triggeredAlert;
  };

  const triggerBrowserPrint = () => {
    if (!showFullThermal) {
      setShowFullThermal(true);
      setTimeout(() => window.print(), 60);
      return;
    }
    window.print();
  };

  const handlePrint = async () => {
    setPrintFeedback(null);
    const effectiveSettings: ReceiptSettings = {
      ...storedSettings,
      template,
      paperWidth,
      autoSendWhatsApp,
      design,
      activeCustomPresetId,
      printers: printersConfig,
    };

    if (selectedPrintTarget === 'browser') {
      recordReceiptPaperUsed(effectiveSettings);
      triggerBrowserPrint();
      return;
    }

    setIsPrintingHardware(true);
    try {
      const escPosBytes = buildEscPosReceiptBytes(bill, activeProfile, effectiveSettings);
      const res = await dispatchEscPosPayload(
        selectedPrintTarget,
        escPosBytes,
        printersConfig,
        triggerBrowserPrint
      );
      const alertPlayed = recordReceiptPaperUsed(effectiveSettings);
      if (!alertPlayed) {
        soundManager.playCheckoutSuccess();
      }
      setPrintFeedback({ ok: true, text: res.message });
    } catch (err: any) {
      setPrintFeedback({
        ok: false,
        text: err?.message || `Failed to print on ${PRINTER_TYPE_LABELS[selectedPrintTarget]}.`,
      });
    } finally {
      setIsPrintingHardware(false);
    }
  };

  const handleWhatsApp = () => {
    const text = buildWhatsAppBillText(bill, activeProfile);
    const cleanPhone = bill.customerPhone ? bill.customerPhone.replace(/\D/g, '') : '';
    const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const url = targetPhone
      ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCopy = () => {
    const text = buildWhatsAppBillText(bill, activeProfile);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendUdharWhatsApp = () => {
    soundManager.playMechanicalClick();
    const newCreditAdded =
      bill.remainingBalance > bill.previousBalance
        ? bill.remainingBalance - bill.previousBalance
        : bill.amountReceived < bill.itemsTotal
          ? bill.itemsTotal - bill.amountReceived
          : bill.remainingBalance;
    const text = buildUdharWhatsAppText(
      {
        customerName: bill.customerName,
        billNumber: bill.billNumber,
        formattedDateTime: bill.formattedDateTime,
        newCreditAdded: Math.max(0, newCreditAdded),
        totalRemainingBalance: bill.remainingBalance,
      },
      activeProfile
    );
    launchWhatsApp(bill.customerPhone, text);
  };

  const handleSendUdharSMS = () => {
    soundManager.playMechanicalClick();
    const newCreditAdded =
      bill.remainingBalance > bill.previousBalance
        ? bill.remainingBalance - bill.previousBalance
        : bill.amountReceived < bill.itemsTotal
          ? bill.itemsTotal - bill.amountReceived
          : bill.remainingBalance;
    const text = buildUdharSMSText(
      {
        customerName: bill.customerName,
        billNumber: bill.billNumber,
        formattedDateTime: bill.formattedDateTime,
        newCreditAdded: Math.max(0, newCreditAdded),
        totalRemainingBalance: bill.remainingBalance,
      },
      activeProfile
    );
    launchSMS(bill.customerPhone, text);
  };

  const activePresetName = activeCustomPresetId
    ? savedCustomPresets.find(p => p.id === activeCustomPresetId)?.name || 'CUSTOM'
    : template.toUpperCase().replace('_', ' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-sm sm:max-w-md my-auto bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[96vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">

        {/* Header Bar */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">RECEIPT</h3>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                    bill.isGstBill
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {bill.isGstBill ? `GST Tax Invoice (${bill.gstRate || 18}%)` : 'Non-GST'}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">Bill #{bill.billNumber}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onOpenSettings && (
              <button
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOpenSettings();
                }}
                className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                title="Open Receipt Settings & Customizer"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition ml-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Template, Custom Design & Paper Switcher Bar */}
        <div className="px-3 py-2 bg-slate-900/95 border-b border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">

          {/* Template & Saved Custom Design buttons */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 max-w-full scrollbar-none">
            <button
              onClick={() => handleSwitchTemplate('minimalist')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                template === 'minimalist' && !activeCustomPresetId
                  ? 'bg-amber-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Zap className="w-3 h-3" /> Minimalist
            </button>
            <button
              onClick={() => handleSwitchTemplate('wholesale_bulk')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                template === 'wholesale_bulk' && !activeCustomPresetId
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Boxes className="w-3 h-3" /> Bulk FMCG
            </button>
            <button
              onClick={() => handleSwitchTemplate('compact')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                template === 'compact' && !activeCustomPresetId
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Compact
            </button>
            <button
              onClick={() => handleSwitchTemplate('standard')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                template === 'standard' && !activeCustomPresetId
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Standard
            </button>
            <button
              onClick={() => handleSwitchTemplate('detailed')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                template === 'detailed' && !activeCustomPresetId
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Detailed
            </button>
            <button
              onClick={() => handleSwitchTemplate('clean_bill')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                template === 'clean_bill' && !activeCustomPresetId
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ReceiptText className="w-3 h-3" /> Clean Bill
            </button>
            <button
              onClick={() => handleSwitchTemplate('express_total')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                template === 'express_total' && !activeCustomPresetId
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ReceiptText className="w-3 h-3" /> Express Total
            </button>
            <button
              onClick={() => handleSwitchTemplate('express_units')}
              className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                template === 'express_units' && !activeCustomPresetId
                  ? 'bg-violet-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ReceiptText className="w-3 h-3" /> Express Units
            </button>
            {savedCustomPresets.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleSelectCustomPreset(preset)}
                className={`px-2 py-1 rounded-lg font-bold transition whitespace-nowrap flex items-center gap-1 ${
                  activeCustomPresetId === preset.id
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
                title={`Load saved custom design: ${preset.name}`}
              >
                <BookmarkCheck className="w-3 h-3" /> {preset.name}
              </button>
            ))}
          </div>

          {/* Roll Width Toggle */}
          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 font-semibold flex-shrink-0">
            <button
              onClick={() => handleSwitchPaperWidth('58mm')}
              className={`px-1.5 py-0.5 rounded transition ${
                paperWidth === '58mm' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              58mm
            </button>
            <button
              onClick={() => handleSwitchPaperWidth('80mm')}
              className={`px-1.5 py-0.5 rounded transition ${
                paperWidth === '80mm' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              80mm
            </button>
          </div>

          {/* Quick Auto-WhatsApp Messaging Dynamic Toggle */}
          <button
            onClick={handleToggleAutoWhatsApp}
            className={`px-2 py-0.5 rounded font-bold transition flex items-center gap-1 text-[10px] ${
              autoSendWhatsApp
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title="Toggle Automatic WhatsApp Receipt Dispatch"
          >
            <Share2 className="w-3 h-3 text-emerald-400" />
            <span>
              Auto-WhatsApp:{' '}
              <strong className={autoSendWhatsApp ? 'text-emerald-300' : 'text-slate-400'}>
                {autoSendWhatsApp ? 'ON' : 'OFF'}
              </strong>
            </span>
          </button>
        </div>

        {/* Dynamic Status Notification Strip if Auto-WhatsApp is active */}
        {bill.customerPhone && autoSendWhatsApp && (
          <div className="px-3 py-1 bg-emerald-950/60 border-b border-emerald-800/40 text-[10px] text-emerald-300 flex items-center justify-between font-medium">
            <span className="flex items-center gap-1.5 truncate">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span>Auto-WhatsApp active for {bill.customerPhone}</span>
            </span>
            <button
              onClick={handleWhatsApp}
              className="text-emerald-400 font-bold underline hover:text-emerald-200 flex-shrink-0 ml-2"
            >
              Re-send Bill
            </button>
          </div>
        )}

        {/* Printable Thermal Receipt Container */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 bg-slate-950 flex justify-center">
          {showFullThermal ? (
            <div ref={receiptRef} className="w-full flex flex-col items-center gap-2">
              {!enableLiveReceiptRendering && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setShowFullThermal(false);
                  }}
                  className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 underline print:hidden"
                >
                  Switch back to Fast Summary View
                </button>
              )}
              <ThermalReceiptPaper
                id="printable-receipt"
                bill={bill}
                storeProfile={activeProfile}
                design={design}
                paperWidth={paperWidth}
                thankYouFallback={storedSettings.thankYouMessage}
                autoCutPreview={
                  printersConfig.autoCutPaper ? printersConfig.autoCutMode || 'partial' : false
                }
              />
            </div>
          ) : (
            <div className="w-full max-w-sm space-y-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-amber-500/35 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Gauge className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <div className="text-[11px] min-w-0">
                    <div className="font-bold text-white">Fast Summary Mode</div>
                    <div className="text-slate-400 truncate">
                      Live thermal DOM paused · Print auto-renders paper
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setShowFullThermal(true);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Render Thermal
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <div className="font-bold text-white">{bill.customerName}</div>
                    {bill.customerPhone && (
                      <div className="text-[11px] text-slate-400 font-mono">{bill.customerPhone}</div>
                    )}
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-slate-200">#{bill.billNumber}</div>
                    <div className="text-[10px] text-slate-400">{bill.formattedDateTime}</div>
                  </div>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {bill.items.map((item, idx) => (
                    <div key={`${item.productId}_${idx}`} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-200 truncate block">
                          {item.productName}
                        </span>
                        <span className="text-[10px] text-slate-400 tabular-nums">
                          {item.quantity} {item.unit === 'bundle' ? item.bundleUnitName : 'Pcs'} &times; ₹{item.unitPrice}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-white tabular-nums flex-shrink-0">
                        ₹{item.itemTotal.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px] font-mono tabular-nums">
                  <div className="flex justify-between text-slate-300">
                    <span>Items Total ({bill.items.length})</span>
                    <span>₹{bill.itemsTotal.toFixed(2)}</span>
                  </div>
                  {bill.isGstBill && (bill.totalGstAmount || 0) > 0 && (
                    <div className="flex justify-between text-emerald-300">
                      <span>GST ({bill.gstRate || 18}%)</span>
                      <span>₹{(bill.totalGstAmount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-white pt-1 border-t border-slate-800/80">
                    <span>Grand Total</span>
                    <span>₹{bill.grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400">
                    <span>Paid</span>
                    <span>₹{bill.amountReceived.toFixed(2)}</span>
                  </div>
                  {bill.remainingBalance > 0 && (
                    <div className="flex justify-between text-rose-400 font-bold">
                      <span>Pending Udhar</span>
                      <span>₹{bill.remainingBalance.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Udhar Notification Quick-Action Bar if pending balance exists */}
        {bill.remainingBalance > 0 && (
          <div className="px-3 py-2 bg-amber-950/40 border-t border-amber-900/40 flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-amber-300 flex items-center gap-1">
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                Khata Udhar Due: ₹{bill.remainingBalance.toFixed(2)}
              </span>
              <span className="text-[10px] text-amber-200/80">
                {bill.customerPhone ? `Ph: ${bill.customerPhone}` : 'No phone linked'}
              </span>
            </div>
            {bill.customerPhone && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleSendUdharWhatsApp}
                  className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[10.5px] font-bold transition active:scale-95"
                >
                  <MessageSquare className="w-3 h-3 text-emerald-400" />
                  <span>WhatsApp Udhar</span>
                </button>
                <button
                  type="button"
                  onClick={handleSendUdharSMS}
                  className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[10.5px] font-bold transition active:scale-95"
                >
                  <Send className="w-3 h-3 text-blue-400" />
                  <span>Carrier SMS Udhar</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Low Thermal Paper Alert Banner */}
        {paperIsLow && (
          <div className="px-3 py-1.5 bg-amber-950/60 border-t border-amber-500/40 text-[10.5px] text-amber-200 flex items-center justify-between gap-2 tabular-nums">
            <span className="flex items-center gap-1.5 min-w-0 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="truncate">
                Low Thermal Paper ({paperMetrics.remainingMeters.toFixed(1)}m / {paperMetrics.totalMeters}m · {paperRemainingPct}% left)
              </span>
            </span>
            <button
              type="button"
              onClick={handleResetPaperRoll}
              className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold whitespace-nowrap flex-shrink-0 transition"
            >
              Loaded New Roll
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2">
          {/* Active Printer Target Selector (shown when any hardware printer is enabled) */}
          {enabledHardwarePrinters.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[10.5px]">
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSelectedPrintTarget('browser');
                  setPrintFeedback(null);
                }}
                className={`px-2 py-1 rounded-lg border font-semibold whitespace-nowrap flex items-center gap-1 transition ${
                  selectedPrintTarget === 'browser'
                    ? 'bg-blue-600/25 border-blue-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Printer className="w-3 h-3" />
                <span>System</span>
              </button>
              {enabledHardwarePrinters.map(type => {
                const IconComp =
                  type === 'bluetooth'
                    ? Bluetooth
                    : type === 'usb'
                      ? Usb
                      : type === 'network_ip'
                        ? Network
                        : Wifi;
                const shortLabel =
                  type === 'bluetooth'
                    ? 'Bluetooth'
                    : type === 'usb'
                      ? 'USB'
                      : type === 'network_ip'
                        ? 'Network IP'
                        : 'WiFi';
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setSelectedPrintTarget(type);
                      setPrintFeedback(null);
                    }}
                    className={`px-2 py-1 rounded-lg border font-semibold whitespace-nowrap flex items-center gap-1 transition ${
                      selectedPrintTarget === type
                        ? 'bg-emerald-600/25 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <IconComp className="w-3 h-3" />
                    <span>{shortLabel}</span>
                  </button>
                );
              })}
            </div>
          )}

          {printFeedback && (
            <div
              className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-medium flex items-center justify-between gap-2 ${
                printFeedback.ok
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {printFeedback.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                )}
                <span className="truncate">{printFeedback.text}</span>
              </span>
              {!printFeedback.ok && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-[10px] font-bold underline text-white flex-shrink-0"
                >
                  Printer Setup
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handlePrint}
              disabled={isPrintingHardware}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 font-bold text-white text-xs shadow-lg shadow-blue-900/40 transition active:scale-95"
            >
              {isPrintingHardware ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span className="truncate">
                {selectedPrintTarget === 'browser'
                  ? `Print (${activePresetName} • ${paperWidth})`
                  : `Print via ${
                      selectedPrintTarget === 'bluetooth'
                        ? 'Bluetooth'
                        : selectedPrintTarget === 'usb'
                          ? 'USB'
                          : selectedPrintTarget === 'network_ip'
                            ? 'Network IP'
                            : 'WiFi'
                    }`}
              </span>
            </button>
            <button
              onClick={handleWhatsApp}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-xs shadow-lg shadow-emerald-900/40 transition active:scale-95"
            >
              <Share2 className="w-4 h-4" />
              <span>WhatsApp</span>
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition"
            >
              <Copy className="w-3 h-3" />
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold border border-slate-700 transition"
            >
              Done / Next Bill
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
