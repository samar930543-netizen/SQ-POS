import React, { useEffect, useState } from 'react';
import {
  ReceiptSettings,
  ReceiptTemplateType,
  PaperWidthType,
  StoreProfile,
  ViewportLayoutPreference,
  ReceiptDesignConfig,
  SavedCustomReceiptPreset,
  PerformanceSettings,
  PrinterConnectionsConfig,
} from '../types';
import { soundManager } from '../utils/soundEffects';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  getStoredStoreProfile,
  resolvePrinterConnectionsConfig,
} from '../utils/storage';
import {
  getEnabledHardwarePrinters,
  getRemainingPaperMeters,
  isThermalPaperLow,
} from '../utils/printerManager';
import { RECEIPT_PRESET_META, resolveReceiptDesign } from '../utils/receiptPresets';
import { ReceiptCustomizer } from './ReceiptCustomizer';
import { SettingsAccordion } from './SettingsAccordion';
import { PerformanceManagerPanel } from './PerformanceManagerPanel';
import { PrinterConnectionsPanel } from './PrinterConnectionsPanel';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  Sliders,
  Check,
  Sparkles,
  X,
  Smartphone,
  Tablet,
  Monitor,
  MessageSquare,
  Send,
  BellRing,
  Percent,
  ReceiptText,
  Building2,
  Share2,
  Palette,
  Printer,
  Zap,
  ChevronsDownUp,
  ChevronsUpDown,
  Gauge,
  Vibrate,
} from 'lucide-react';

interface ReceiptSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReceiptSettings;
  onSaveSettings: (settings: ReceiptSettings) => void;
  storeProfile?: StoreProfile;
  onOpenStoreProfile?: () => void;
  whatsappAutomationEnabled?: boolean;
  onToggleWhatsappAutomation?: (enabled: boolean) => void;
  showHeaderBranding?: boolean;
  onToggleHeaderBranding?: (show: boolean) => void;
  performanceSettings?: PerformanceSettings;
  onUpdatePerformanceSettings?: (settings: PerformanceSettings) => void;
}

type ModalAccordionKey =
  | 'receipt_customization'
  | 'printer_settings'
  | 'automation'
  | 'display_layout'
  | 'performance_manager';

const ALL_MODAL_KEYS: ModalAccordionKey[] = [
  'receipt_customization',
  'printer_settings',
  'automation',
  'display_layout',
  'performance_manager',
];

export const ReceiptSettingsModal: React.FC<ReceiptSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  storeProfile,
  onOpenStoreProfile,
  whatsappAutomationEnabled,
  onToggleWhatsappAutomation,
  showHeaderBranding = true,
  onToggleHeaderBranding,
  performanceSettings,
  onUpdatePerformanceSettings,
}) => {
  const [template, setTemplate] = useState<ReceiptTemplateType>(settings.template);
  const [paperWidth, setPaperWidth] = useState<PaperWidthType>(settings.paperWidth);
  const [design, setDesign] = useState<ReceiptDesignConfig>(() => resolveReceiptDesign(settings));
  const [savedCustomPresets, setSavedCustomPresets] = useState<SavedCustomReceiptPreset[]>(
    settings.savedCustomPresets || []
  );
  const [activeCustomPresetId, setActiveCustomPresetId] = useState<string | undefined>(
    settings.activeCustomPresetId
  );
  const [autoSendWhatsApp, setAutoSendWhatsApp] = useState<boolean>(settings.autoSendWhatsApp ?? false);
  const [autoUdharWhatsApp, setAutoUdharWhatsApp] = useState<boolean>(settings.autoUdharWhatsApp ?? true);
  const [autoUdharSMS, setAutoUdharSMS] = useState<boolean>(settings.autoUdharSMS ?? true);
  const [enableGst, setEnableGst] = useState<boolean>(settings.enableGst ?? false);
  const [gstRate, setGstRate] = useState<number>(settings.gstRate ?? 18);
  const [gstNumber, setGstNumber] = useState<string>(settings.gstNumber || '07AABCS1429B1Z1');
  const [thankYouMessage, setThankYouMessage] = useState(
    settings.thankYouMessage || 'Thank you for your business!'
  );
  const [printers, setPrinters] = useState<PrinterConnectionsConfig>(() =>
    resolvePrinterConnectionsConfig(settings.printers)
  );
  const [savedToast, setSavedToast] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(soundManager.isHapticsEnabled());
  const hapticsSupported = soundManager.isHapticsSupported();
  const [openSections, setOpenSections] = useState<Record<ModalAccordionKey, boolean>>({
    receipt_customization: false,
    printer_settings: false,
    automation: false,
    display_layout: false,
    performance_manager: false,
  });

  useEffect(() => {
    return soundManager.subscribeHapticsChange(setHapticsEnabled);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTemplate(settings.template);
    setPaperWidth(settings.paperWidth);
    setDesign(resolveReceiptDesign(settings));
    setSavedCustomPresets(settings.savedCustomPresets || []);
    setActiveCustomPresetId(settings.activeCustomPresetId);
    setAutoSendWhatsApp(settings.autoSendWhatsApp ?? false);
    setAutoUdharWhatsApp(settings.autoUdharWhatsApp ?? true);
    setAutoUdharSMS(settings.autoUdharSMS ?? true);
    setEnableGst(settings.enableGst ?? false);
    setGstRate(settings.gstRate ?? 18);
    setGstNumber(settings.gstNumber || '07AABCS1429B1Z1');
    setThankYouMessage(settings.thankYouMessage || 'Thank you for your business!');
    setPrinters(resolvePrinterConnectionsConfig(settings.printers));
    // Hide sub-settings by default whenever the settings modal opens
    setOpenSections({
      receipt_customization: false,
      printer_settings: false,
      automation: false,
      display_layout: false,
      performance_manager: false,
    });
  }, [isOpen, settings]);

  const {
    layoutPref,
    autoLayout,
    resolvedLayout,
    windowWidth,
    isMobileLayout,
    setLayoutPref,
  } = useViewportLayout();

  if (!isOpen) return null;

  const activeProfile = storeProfile || getStoredStoreProfile();
  const storeName = activeProfile.storeName?.trim() || 'SQ ENTERPRISES';
  const contactLine = [
    activeProfile.contactNumber?.trim() ? `Ph: ${activeProfile.contactNumber.trim()}` : '',
    activeProfile.email?.trim() || '',
  ]
    .filter(Boolean)
    .join(' | ');

  const toggleSection = (key: ModalAccordionKey) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const anyExpanded = ALL_MODAL_KEYS.some(k => openSections[k]);
  const handleToggleAll = () => {
    soundManager.playMechanicalClick();
    const nextState = !anyExpanded;
    setOpenSections({
      receipt_customization: nextState,
      printer_settings: nextState,
      automation: nextState,
      display_layout: nextState,
      performance_manager: nextState,
    });
  };

  const handleSave = () => {
    soundManager.playCheckoutSuccess();
    const updated: ReceiptSettings = {
      template,
      paperWidth,
      showPhone: design.showStorePhone,
      thankYouMessage:
        design.customFooterText.trim() || thankYouMessage.trim() || 'Thank you for your business!',
      autoSendWhatsApp,
      autoUdharWhatsApp,
      autoUdharSMS,
      enableGst,
      gstRate,
      gstNumber: gstNumber.trim(),
      design,
      savedCustomPresets,
      activeCustomPresetId,
      printers,
    };
    onSaveSettings(updated);
    setSavedToast(true);
    setTimeout(() => {
      setSavedToast(false);
      onClose();
    }, 800);
  };

  const activePresetLabel =
    activeCustomPresetId
      ? `${savedCustomPresets.find(p => p.id === activeCustomPresetId)?.name || 'Custom'} (Saved)`
      : RECEIPT_PRESET_META.find(p => p.id === template)?.label || template;

  const effectivePerf: PerformanceSettings = {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...(performanceSettings || activeProfile.performanceSettings || {}),
  };
  const activePerfCount = [
    effectivePerf.enablePredictiveAnalytics,
    effectivePerf.enableAutoCloudSync,
    effectivePerf.enableLiveReceiptRendering,
  ].filter(Boolean).length;

  const extraFeatures = [
    design.showBarcode ? 'Barcode' : '',
    design.showQrCode ? 'QR' : '',
    design.watermarkEnabled ? 'Watermark' : '',
  ].filter(Boolean);
  const receiptSummary = `${activePresetLabel} · ${design.fontSize.toUpperCase()}${
    extraFeatures.length > 0 ? ` · ${extraFeatures.join(' + ')}` : ''
  } · ${savedCustomPresets.length} custom saved`;
  const enabledPrinters = getEnabledHardwarePrinters(printers);
  const paperMetrics = getRemainingPaperMeters(printers);
  const paperLow = isThermalPaperLow(printers);
  const paperPct = Math.round(paperMetrics.remainingPct);
  const cutLabel = printers.autoCutPaper
    ? printers.autoCutMode === 'full'
      ? 'Full Cut'
      : 'Partial Cut'
    : 'Cut Off';
  const printerSummary = `${paperWidth} Roll · ${enabledPrinters.length}/4 Printers On · ${cutLabel} · ${
    paperLow
      ? `Low Paper (${paperMetrics.remainingMeters.toFixed(1)}m / ${paperMetrics.totalMeters}m · ${paperPct}%)`
      : `${paperMetrics.remainingMeters.toFixed(1)}m / ${paperMetrics.totalMeters}m (${paperPct}%)`
  } · ${enableGst ? `GST ${gstRate}% (${gstNumber || 'No GSTIN'})` : 'Non-GST Mode'}`;
  const automationSummary = `Auto-Receipt ${autoSendWhatsApp ? 'On' : 'Off'} · Udhar WA ${autoUdharWhatsApp ? 'On' : 'Off'} · SMS ${autoUdharSMS ? 'On' : 'Off'}`;
  const layoutSummary = `${resolvedLayout.charAt(0).toUpperCase() + resolvedLayout.slice(1)} (${layoutPref}) · Header Branding ${showHeaderBranding ? 'Visible' : 'Hidden'}`;
  const performanceSummary = `${activePerfCount}/3 active · Predictive ${effectivePerf.enablePredictiveAnalytics ? 'On' : 'Paused'} · Auto-Sync ${effectivePerf.enableAutoCloudSync ? 'On' : 'Paused'} · Live Receipt ${effectivePerf.enableLiveReceiptRendering ? 'On' : 'Paused'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-5xl my-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 flex-shrink-0">
              <Sliders className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-white tracking-wide truncate">
                Receipt &amp; Thermal Printer Settings
              </h3>
              <p className="text-xs text-slate-400 truncate">
                Select a configuration group below to customize templates, printer options, automation, and layout.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleToggleAll}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap transition"
            >
              {anyExpanded ? (
                <>
                  <ChevronsDownUp className="w-3.5 h-3.5 text-slate-400" />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
                  <span>Expand All</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Collapsible Accordion Groups Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3 text-xs">

          {/* 1. RECEIPT CUSTOMIZATION */}
          <SettingsAccordion
            id="modal-receipt-customizer"
            title="Receipt Customization"
            summary={receiptSummary}
            description="Design receipt templates, field toggles, font sizes, alignment, item layouts & custom presets"
            icon={<Palette className="w-4 h-4 text-cyan-400" />}
            isOpen={openSections.receipt_customization}
            onToggle={() => toggleSection('receipt_customization')}
          >
            <ReceiptCustomizer
              embedded
              enableLiveReceiptRendering={effectivePerf.enableLiveReceiptRendering}
              printers={printers}
              settings={{
                ...settings,
                template,
                paperWidth,
                enableGst,
                gstRate,
                gstNumber,
                thankYouMessage,
                design,
                savedCustomPresets,
                activeCustomPresetId,
              }}
              storeProfile={activeProfile}
              onSaveSettings={updated => {
                setTemplate(updated.template);
                setPaperWidth(updated.paperWidth);
                if (updated.design) setDesign(updated.design);
                if (updated.savedCustomPresets) setSavedCustomPresets(updated.savedCustomPresets);
                setActiveCustomPresetId(updated.activeCustomPresetId);
                onSaveSettings(updated);
              }}
              showSaveActions={false}
              onDraftChange={draft => {
                setTemplate(draft.template);
                setPaperWidth(draft.paperWidth);
                setDesign(draft.design);
                setSavedCustomPresets(draft.savedCustomPresets);
                setActiveCustomPresetId(draft.activeCustomPresetId);
                if (draft.design.customFooterText.trim()) {
                  setThankYouMessage(draft.design.customFooterText);
                }
              }}
            />
          </SettingsAccordion>

          {/* 2. PRINTER SETTINGS (PAPER WIDTH, HARDWARE CONNECTIONS, GST TAX INVOICE, FOOTER) */}
          <SettingsAccordion
            id="modal-printer-settings"
            title="Printer & Tax Settings"
            summary={printerSummary}
            description="Bluetooth, USB, Network IP & WiFi printer switches, paper width (58mm / 80mm) & GST mode"
            icon={<Printer className="w-4 h-4 text-emerald-400" />}
            isOpen={openSections.printer_settings}
            onToggle={() => toggleSection('printer_settings')}
          >
            <div className="space-y-4">
              <PrinterConnectionsPanel
                printers={printers}
                paperWidth={paperWidth}
                storeProfile={activeProfile}
                onChange={nextPrinters => setPrinters(nextPrinters)}
              />

              {/* Thermal Paper Roll Width & Default Footer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-emerald-400" />
                    Thermal Paper Roll Width
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Choose standard physical thermal printer roll size.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {(['58mm', '80mm'] as const).map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setPaperWidth(w);
                        }}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                          paperWidth === w
                            ? 'bg-emerald-600/25 border-emerald-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {w} Roll {w === '58mm' ? '(2 inch)' : '(3 inch)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-200 text-xs block">
                    Default Receipt Thank-You Message
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Printed at the bottom of thermal bills when custom template text is empty.
                  </p>
                  <input
                    type="text"
                    value={thankYouMessage}
                    onChange={e => setThankYouMessage(e.target.value)}
                    placeholder="Thank you for your business!"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Global GST Calculation & Tax Invoice Setting */}
              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <ReceiptText className="w-4 h-4 text-emerald-400" />
                    Global GST Calculation &amp; Tax Invoice Setting
                  </label>
                  <span className="text-[11px] font-semibold text-slate-300">
                    {enableGst ? 'GST Mode Active' : 'Non-GST Wholesale Mode'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <div>
                    <div className="font-bold text-white text-xs">
                      Enable GST Calculation on Bills
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Calculate GST (CGST + SGST) on bills and print Tax Invoices, or disable for Non-GST wholesale bills.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enableGst}
                    aria-label="Enable GST calculation on bills"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setEnableGst(!enableGst);
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      enableGst ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        enableGst ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {enableGst && (
                  <div className="pt-2 space-y-3 border-t border-slate-800/80">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                          <Percent className="w-3.5 h-3.5 text-blue-400" /> Default GST Rate Percentage
                        </label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[5, 12, 18, 28].map(rate => (
                            <button
                              key={rate}
                              type="button"
                              onClick={() => {
                                soundManager.playMechanicalClick();
                                setGstRate(rate);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-center font-bold text-xs transition border tabular-nums ${
                                gstRate === rate
                                  ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              {rate}%
                            </button>
                          ))}
                        </div>
                        <div className="text-[10px] text-slate-400 pt-0.5 tabular-nums">
                          Split: {(gstRate / 2).toFixed(1)}% CGST + {(gstRate / 2).toFixed(1)}% SGST
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-300">
                          Shop GSTIN / Tax Number
                        </label>
                        <input
                          type="text"
                          value={gstNumber}
                          onChange={e => setGstNumber(e.target.value.toUpperCase())}
                          placeholder="e.g. 07AABCS1429B1Z1"
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono uppercase focus:outline-none focus:border-blue-500"
                        />
                        <div className="text-[10px] text-slate-500">
                          Printed prominently on GST Tax Invoices
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SettingsAccordion>

          {/* 3. AUTOMATION (WHATSAPP RECEIPTS, ORDER BOT, UDHAR WHATSAPP & SMS) */}
          <SettingsAccordion
            id="modal-automation"
            title="Automation & Messaging"
            summary={automationSummary}
            description="Auto-send WhatsApp receipts, WhatsApp order bot & automated Khata Udhar WhatsApp/SMS alerts"
            icon={<Zap className="w-4 h-4 text-amber-400" />}
            isOpen={openSections.automation}
            onToggle={() => toggleSection('automation')}
          >
            <div className="space-y-3">
              {/* Automatic WhatsApp Receipt Sending */}
              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                      <Share2 className="w-4 h-4 text-emerald-400" />
                      Automatic WhatsApp Receipt Sending
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Automatically prepare and open WhatsApp with the formatted bill when a customer phone number is linked.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSendWhatsApp}
                    aria-label="Toggle automatic WhatsApp receipt sending"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setAutoSendWhatsApp(!autoSendWhatsApp);
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoSendWhatsApp ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        autoSendWhatsApp ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {onToggleWhatsappAutomation && whatsappAutomationEnabled !== undefined && (
                  <div className="pt-2.5 flex items-center justify-between gap-3 border-t border-slate-800/80">
                    <div>
                      <div className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                        WhatsApp Business Order &amp; Inquiry Automation
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Master switch to enable/disable inbound WhatsApp order intake, stock sync &amp; inquiry replies.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={whatsappAutomationEnabled}
                      aria-label="Enable or disable WhatsApp Business Automation"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onToggleWhatsappAutomation(!whatsappAutomationEnabled);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        whatsappAutomationEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          whatsappAutomationEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Customer Udhar (Credit) Auto-Alerts */}
              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <BellRing className="w-4 h-4 text-amber-400" />
                    Customer Udhar (Credit) Auto-Alerts
                  </label>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Khata Automation
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div
                    className={`p-3 rounded-xl border transition flex items-start justify-between gap-2.5 ${
                      autoUdharWhatsApp
                        ? 'bg-emerald-950/30 border-emerald-500/40'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`p-1.5 rounded-lg flex-shrink-0 ${
                          autoUdharWhatsApp
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-white text-xs">WhatsApp Udhar Alert</div>
                        <div className="text-[10px] text-slate-400">
                          Direct WhatsApp alert with bill info &amp; pending due
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoUdharWhatsApp}
                      aria-label="Toggle WhatsApp Udhar alert"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setAutoUdharWhatsApp(!autoUdharWhatsApp);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        autoUdharWhatsApp ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          autoUdharWhatsApp ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div
                    className={`p-3 rounded-xl border transition flex items-start justify-between gap-2.5 ${
                      autoUdharSMS
                        ? 'bg-blue-950/30 border-blue-500/40'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`p-1.5 rounded-lg flex-shrink-0 ${
                          autoUdharSMS
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        <Send className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-white text-xs">Standard SMS Udhar Alert</div>
                        <div className="text-[10px] text-slate-400">
                          Carrier SMS alert directly to customer&apos;s mobile
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoUdharSMS}
                      aria-label="Toggle Standard SMS Udhar alert"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setAutoUdharSMS(!autoUdharSMS);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        autoUdharSMS ? 'bg-blue-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          autoUdharSMS ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-[10.5px] space-y-1">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <Smartphone className="w-3.5 h-3.5 text-slate-400" /> Sample Automated Udhar Alert:
                  </span>
                  <p className="font-mono text-[9.5px] text-amber-200/90 bg-black/40 p-1.5 rounded border border-slate-800/60 leading-relaxed">
                    &ldquo;{storeName}: Dear Ramesh Kirana Store, Rs.402.00 Udhar added on Bill #SQ-882104. Total Pending Due: Rs.402.00. Date: 15 Nov 2026, 01:45 PM. Thank you.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </SettingsAccordion>

          {/* 4. DISPLAY, HEADER BRANDING & STORE PROFILE LINK */}
          <SettingsAccordion
            id="modal-display-layout"
            title="Display, Layout & Store Branding"
            summary={layoutSummary}
            description="Responsive viewport layout mode, header branding visibility & store profile shortcut"
            icon={<Monitor className="w-4 h-4 text-sky-400" />}
            isOpen={openSections.display_layout}
            onToggle={() => toggleSection('display_layout')}
          >
            <div className="space-y-3">
              {onOpenStoreProfile && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {activeProfile.logoDataUrl ? (
                      <img
                        src={activeProfile.logoDataUrl}
                        alt={storeName}
                        className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
                        <Building2 className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">
                        Active Store Branding: {storeName}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {contactLine ||
                          activeProfile.address ||
                          'Customize store name, phone, email, address, logo & facade'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      onOpenStoreProfile();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 font-bold text-[11px] whitespace-nowrap transition"
                  >
                    Open Full Store Settings
                  </button>
                </div>
              )}

              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <Monitor className="w-4 h-4 text-sky-400" />
                    Screen Layout Mode
                  </label>
                  <span className="text-[10px] font-semibold text-sky-300 tabular-nums">
                    Active: <span className="capitalize font-bold">{resolvedLayout}</span>
                    {layoutPref === 'auto' ? ` (Auto · ${windowWidth}px)` : ' (Manual)'}
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Screen layout mode"
                  className={`grid ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-4'} gap-2`}
                >
                  {(
                    [
                      {
                        id: 'auto' as ViewportLayoutPreference,
                        label: 'Auto',
                        sub: `${autoLayout} (${windowWidth}px)`,
                        Icon: Sparkles,
                      },
                      {
                        id: 'mobile' as ViewportLayoutPreference,
                        label: 'Mobile',
                        sub: 'Compact · 100%',
                        Icon: Smartphone,
                      },
                      {
                        id: 'tablet' as ViewportLayoutPreference,
                        label: 'Tablet',
                        sub: 'Balanced · 100%',
                        Icon: Tablet,
                      },
                      {
                        id: 'desktop' as ViewportLayoutPreference,
                        label: 'Desktop',
                        sub: '≥1024px full',
                        Icon: Monitor,
                      },
                    ] as const
                  ).map(opt => {
                    const isSelected = layoutPref === opt.id;
                    const IconComp = opt.Icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setLayoutPref(opt.id);
                        }}
                        className={`p-2 rounded-xl border text-left transition flex items-center gap-2 ${
                          isSelected
                            ? 'bg-blue-600/20 border-blue-500 text-white shadow-sm'
                            : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <IconComp
                          className={`w-4 h-4 flex-shrink-0 ${
                            isSelected ? 'text-blue-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold leading-tight truncate">{opt.label}</div>
                          <div className="text-[10px] text-slate-400 tabular-nums truncate">
                            {opt.sub}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {onToggleHeaderBranding && (
                  <div className="pt-2.5 mt-1 border-t border-slate-800/80 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-sky-400" />
                        <span>Show Store Name &amp; Branding in Header</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Show or hide the store logo, business title, and tagline in the top bar.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showHeaderBranding}
                      aria-label="Show or hide store name and branding in header"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onToggleHeaderBranding(!showHeaderBranding);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showHeaderBranding ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          showHeaderBranding ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                <div className="pt-2.5 mt-1 border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5 flex-wrap">
                      <Vibrate className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Tactile Haptic Vibration (Mobile POS)</span>
                      <span
                        className={`text-[10px] font-semibold ${
                          hapticsSupported ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        · {hapticsSupported ? 'Device Supported' : 'Not Supported on Browser'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Vibrate briefly when adding items to the cart and double-pulse on sale completion via navigator.vibrate.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hapticsEnabled}
                    aria-label="Enable tactile haptic vibration in mobile POS"
                    onClick={() => {
                      const next = !hapticsEnabled;
                      soundManager.setHapticsEnabled(next);
                      setHapticsEnabled(next);
                      soundManager.playMechanicalClick();
                      if (next) {
                        soundManager.vibrateTap();
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      hapticsEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        hapticsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </SettingsAccordion>

          {/* 5. PERFORMANCE MANAGER */}
          {onUpdatePerformanceSettings && (
            <SettingsAccordion
              id="modal-performance-manager"
              title="Performance Manager"
              summary={performanceSummary}
              description="Master toggles to pause Predictive Analytics, Auto Cloud Syncing & Live Receipt Rendering"
              icon={<Gauge className="w-4 h-4 text-amber-400" />}
              isOpen={openSections.performance_manager}
              onToggle={() => toggleSection('performance_manager')}
            >
              <PerformanceManagerPanel
                settings={effectivePerf}
                onUpdate={onUpdatePerformanceSettings}
              />
            </SettingsAccordion>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {savedToast ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-4 h-4" /> Settings Saved!
              </span>
            ) : (
              <span>Changes apply across POS bills once saved.</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/40 transition active:scale-95"
            >
              Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
