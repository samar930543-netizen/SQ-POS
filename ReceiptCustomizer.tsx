import React, { useEffect, useMemo, useState } from 'react';
import {
  Bill,
  PaperWidthType,
  PrinterConnectionsConfig,
  ReceiptAlignment,
  ReceiptDateTimeFormat,
  ReceiptDesignConfig,
  ReceiptFontSize,
  ReceiptHeaderLayout,
  ReceiptItemDisplayFormat,
  ReceiptSettings,
  ReceiptTemplateType,
  SavedCustomReceiptPreset,
  StoreProfile,
} from '../types';
import {
  RECEIPT_PRESET_DESIGNS,
  RECEIPT_PRESET_META,
  resolveReceiptDesign,
} from '../utils/receiptPresets';
import { soundManager } from '../utils/soundEffects';
import { ThermalReceiptPaper } from './ThermalReceiptPaper';
import { SettingsAccordion } from './SettingsAccordion';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Barcode,
  BookmarkPlus,
  CalendarClock,
  Check,
  Eye,
  LayoutTemplate,
  ListOrdered,
  Palette,
  Printer,
  QrCode,
  RotateCcw,
  Save,
  Sliders,
  Stamp,
  Trash2,
  Type,
  Gauge,
  EyeOff,
} from 'lucide-react';

interface ReceiptCustomizerProps {
  settings: ReceiptSettings;
  storeProfile: StoreProfile;
  printers?: PrinterConnectionsConfig;
  onSaveSettings: (updated: ReceiptSettings) => void;
  showSaveActions?: boolean;
  embedded?: boolean;
  enableLiveReceiptRendering?: boolean;
  onDraftChange?: (draft: {
    template: ReceiptTemplateType;
    paperWidth: PaperWidthType;
    design: ReceiptDesignConfig;
    savedCustomPresets: SavedCustomReceiptPreset[];
    activeCustomPresetId?: string;
  }) => void;
}

const SAMPLE_PREVIEW_BILL_BASE: Bill = {
  id: 'preview_customizer_1',
  billNumber: 'SQ-882104',
  timestamp: '2026-11-15T13:45:00.000Z',
  formattedDateTime: '15 Nov 2026, 01:45 PM',
  customerName: 'Ramesh Kirana Store',
  customerPhone: '9876543210',
  items: [
    {
      productId: 'p1',
      productName: 'Gold Flake King',
      unit: 'bundle',
      bundleUnitName: 'Bundle',
      bundlePieces: 50,
      quantity: 2,
      unitPrice: 4350,
      totalPieces: 100,
      itemTotal: 8700,
    },
    {
      productId: 'p2',
      productName: 'Dettol Soap 75g',
      unit: 'piece',
      bundleUnitName: 'Carton',
      bundlePieces: 48,
      quantity: 6,
      unitPrice: 42,
      totalPieces: 6,
      itemTotal: 252,
    },
  ],
  itemsTotal: 8952,
  previousBalance: 450,
  grandTotal: 9402,
  amountReceived: 9000,
  remainingBalance: 402,
  paymentMode: 'partial',
};

const DATE_TIME_FORMAT_OPTIONS: Array<{
  id: ReceiptDateTimeFormat;
  label: string;
  example: string;
}> = [
  { id: 'date_time', label: 'Date + 12h Time', example: '15 Nov 2026, 01:45 PM' },
  { id: 'date_only', label: 'Date Only', example: '15 Nov 2026' },
  { id: 'short_24h', label: 'Short 24h', example: '15/11/26 13:45' },
  { id: 'iso_compact', label: 'ISO Compact', example: '2026-11-15 13:45' },
];

const FONT_SIZE_OPTIONS: Array<{ id: ReceiptFontSize; label: string; sub: string }> = [
  { id: 'xs', label: 'XS', sub: '8.5px Dense' },
  { id: 'sm', label: 'SM', sub: '9.5px Standard' },
  { id: 'md', label: 'MD', sub: '10.5px Crisp' },
  { id: 'lg', label: 'LG', sub: '11.5px Bold' },
];

const ITEM_FORMAT_OPTIONS: Array<{
  id: ReceiptItemDisplayFormat;
  label: string;
  description: string;
}> = [
  { id: 'tabular_unit', label: '4-Col Table', description: 'Item/Unit, Qty, Rate, Amt' },
  { id: 'compact_inline', label: 'Compact 1-Line', description: 'Item (Qty) ...... Amt' },
  { id: 'two_line_detail', label: '2-Line Detail', description: 'Name+Amt / Qty & Rate' },
  { id: 'numbered_audit', label: 'Numbered Audit', description: '# · Item · Pcs · Rate' },
  { id: 'bulk_cards', label: 'Bulk Dispatch', description: 'Carton badges + count' },
];

const DEFAULT_TRUE_SUMMARY_KEYS = new Set<string>([
  'showItemsTotal',
  'showPaidAmount',
  'showBalanceDue',
  'showSummaryAdjustments',
]);

const HEADER_FIELD_TOGGLES: Array<{
  key: keyof Pick<
    ReceiptDesignConfig,
    | 'showCustomHeaderText'
    | 'showStoreName'
    | 'showTagline'
    | 'showStorePhone'
    | 'showAddress'
    | 'showEmail'
    | 'showLogo'
    | 'showInvoiceNumber'
    | 'showInvoiceLabel'
    | 'showDateTime'
    | 'showCustomerName'
    | 'showCustomerPhone'
    | 'showTotalItemsCount'
    | 'showItemsTotal'
    | 'showPaidAmount'
    | 'showBalanceDue'
    | 'showSummaryAdjustments'
    | 'showInlineQtyOnGrandTotal'
    | 'showBarcode'
    | 'showQrCode'
    | 'watermarkEnabled'
    | 'showFooterMessage'
  >;
  label: string;
}> = [
  { key: 'showCustomHeaderText', label: 'Custom Header Banner' },
  { key: 'showStoreName', label: 'Store Name' },
  { key: 'showTagline', label: 'Store Tagline' },
  { key: 'showStorePhone', label: 'Store Phone' },
  { key: 'showAddress', label: 'Store Address' },
  { key: 'showEmail', label: 'Store Email' },
  { key: 'showLogo', label: 'Store Logo' },
  { key: 'showInvoiceNumber', label: 'Invoice / Bill No.' },
  { key: 'showInvoiceLabel', label: 'Bill No. Prefix (#)' },
  { key: 'showDateTime', label: 'Date & Time' },
  { key: 'showCustomerName', label: 'Customer Name' },
  { key: 'showCustomerPhone', label: 'Customer Phone' },
  { key: 'showTotalItemsCount', label: 'Total Items Count' },
  { key: 'showItemsTotal', label: 'Items Total' },
  { key: 'showPaidAmount', label: 'Paid Amount' },
  { key: 'showBalanceDue', label: 'Balance Due' },
  { key: 'showSummaryAdjustments', label: 'Tax / Prev Due / Loyalty' },
  { key: 'showInlineQtyOnGrandTotal', label: 'Qty on Grand Total Line' },
  { key: 'showBarcode', label: '1D Invoice Barcode' },
  { key: 'showQrCode', label: '2D QR Code' },
  { key: 'watermarkEnabled', label: 'Receipt Watermark' },
  { key: 'showFooterMessage', label: 'Bottom Footer' },
];

export const ReceiptCustomizer: React.FC<ReceiptCustomizerProps> = ({
  settings,
  storeProfile,
  printers,
  onSaveSettings,
  showSaveActions = true,
  embedded = false,
  enableLiveReceiptRendering = true,
  onDraftChange,
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
  const [newPresetName, setNewPresetName] = useState('');
  const [isSavingNewPreset, setIsSavingNewPreset] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [openSubSections, setOpenSubSections] = useState<Record<string, boolean>>({});
  const [snapshotPreviewOpen, setSnapshotPreviewOpen] = useState(false);

  const toggleSubSection = (key: string) => {
    setOpenSubSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const serializedSettings = useMemo(
    () =>
      JSON.stringify({
        template: settings.template,
        paperWidth: settings.paperWidth,
        design: resolveReceiptDesign(settings),
        savedCustomPresets: settings.savedCustomPresets || [],
        activeCustomPresetId: settings.activeCustomPresetId,
      }),
    [settings]
  );

  useEffect(() => {
    setTemplate(settings.template);
    setPaperWidth(settings.paperWidth);
    setDesign(resolveReceiptDesign(settings));
    setSavedCustomPresets(settings.savedCustomPresets || []);
    setActiveCustomPresetId(settings.activeCustomPresetId);
  }, [serializedSettings]);

  const emitDraft = (
    nextTemplate: ReceiptTemplateType,
    nextWidth: PaperWidthType,
    nextDesign: ReceiptDesignConfig,
    nextPresets: SavedCustomReceiptPreset[],
    nextActiveCustomId?: string
  ) => {
    onDraftChange?.({
      template: nextTemplate,
      paperWidth: nextWidth,
      design: nextDesign,
      savedCustomPresets: nextPresets,
      activeCustomPresetId: nextActiveCustomId,
    });
  };

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => {
      setFeedbackMsg(prev => (prev === msg ? null : prev));
    }, 2400);
  };

  const updateDesign = (patch: Partial<ReceiptDesignConfig>) => {
    const next = { ...design, ...patch };
    setDesign(next);
    emitDraft(template, paperWidth, next, savedCustomPresets, activeCustomPresetId);
  };

  const handleSelectPreset = (presetId: ReceiptTemplateType) => {
    soundManager.playMechanicalClick();
    const presetDesign = { ...RECEIPT_PRESET_DESIGNS[presetId] };
    setTemplate(presetId);
    setDesign(presetDesign);
    setActiveCustomPresetId(undefined);
    emitDraft(presetId, paperWidth, presetDesign, savedCustomPresets, undefined);
  };

  const handleChangePaperWidth = (width: PaperWidthType) => {
    soundManager.playMechanicalClick();
    setPaperWidth(width);
    emitDraft(template, width, design, savedCustomPresets, activeCustomPresetId);
  };

  const handleApplyAndSave = () => {
    soundManager.playCheckoutSuccess();
    const updated: ReceiptSettings = {
      ...settings,
      template,
      paperWidth,
      showPhone: design.showStorePhone,
      thankYouMessage: design.customFooterText.trim() || settings.thankYouMessage,
      design,
      savedCustomPresets,
      activeCustomPresetId,
    };
    onSaveSettings(updated);
    showToast('Custom receipt design saved & applied to POS bills.');
  };

  const handleResetToPreset = () => {
    soundManager.playMechanicalClick();
    const freshDesign = { ...RECEIPT_PRESET_DESIGNS[template] };
    setDesign(freshDesign);
    setActiveCustomPresetId(undefined);
    emitDraft(template, paperWidth, freshDesign, savedCustomPresets, undefined);
    showToast(`Reset options to ${template.replace('_', ' ')} preset.`);
  };

  const handleCreateCustomPreset = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    soundManager.playCheckoutSuccess();
    const created: SavedCustomReceiptPreset = {
      id: `custom_receipt_${Date.now()}`,
      name: trimmed,
      baseTemplate: template,
      paperWidth,
      design: { ...design },
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = [created, ...savedCustomPresets];
    setSavedCustomPresets(nextPresets);
    setActiveCustomPresetId(created.id);
    setNewPresetName('');
    setIsSavingNewPreset(false);

    const updated: ReceiptSettings = {
      ...settings,
      template,
      paperWidth,
      thankYouMessage: design.customFooterText.trim() || settings.thankYouMessage,
      design,
      savedCustomPresets: nextPresets,
      activeCustomPresetId: created.id,
    };
    onSaveSettings(updated);
    emitDraft(template, paperWidth, design, nextPresets, created.id);
    showToast(`Saved custom template "${created.name}".`);
  };

  const handleLoadCustomPreset = (preset: SavedCustomReceiptPreset) => {
    soundManager.playMechanicalClick();
    setTemplate(preset.baseTemplate);
    setPaperWidth(preset.paperWidth);
    setDesign({ ...preset.design });
    setActiveCustomPresetId(preset.id);
    emitDraft(preset.baseTemplate, preset.paperWidth, preset.design, savedCustomPresets, preset.id);
    showToast(`Loaded "${preset.name}" into editor.`);
  };

  const handleUpdateActiveCustomPreset = () => {
    if (!activeCustomPresetId) return;
    soundManager.playCheckoutSuccess();
    const nextPresets = savedCustomPresets.map(p =>
      p.id === activeCustomPresetId
        ? {
            ...p,
            baseTemplate: template,
            paperWidth,
            design: { ...design },
            updatedAt: new Date().toISOString(),
          }
        : p
    );
    setSavedCustomPresets(nextPresets);
    const updated: ReceiptSettings = {
      ...settings,
      template,
      paperWidth,
      thankYouMessage: design.customFooterText.trim() || settings.thankYouMessage,
      design,
      savedCustomPresets: nextPresets,
      activeCustomPresetId,
    };
    onSaveSettings(updated);
    emitDraft(template, paperWidth, design, nextPresets, activeCustomPresetId);
    showToast('Updated saved custom template.');
  };

  const handleDeleteCustomPreset = (id: string) => {
    soundManager.playMechanicalClick();
    const nextPresets = savedCustomPresets.filter(p => p.id !== id);
    const nextActiveId = activeCustomPresetId === id ? undefined : activeCustomPresetId;
    setSavedCustomPresets(nextPresets);
    setActiveCustomPresetId(nextActiveId);
    const updated: ReceiptSettings = {
      ...settings,
      template,
      paperWidth,
      design,
      savedCustomPresets: nextPresets,
      activeCustomPresetId: nextActiveId,
    };
    onSaveSettings(updated);
    emitDraft(template, paperWidth, design, nextPresets, nextActiveId);
  };

  const previewBill: Bill = useMemo(() => {
    const gstEnabled = Boolean(settings.enableGst);
    const rate = settings.gstRate || 18;
    const gstAmount = gstEnabled ? (SAMPLE_PREVIEW_BILL_BASE.itemsTotal * rate) / 100 : 0;
    const grandTotal =
      SAMPLE_PREVIEW_BILL_BASE.itemsTotal + gstAmount + SAMPLE_PREVIEW_BILL_BASE.previousBalance;
    return {
      ...SAMPLE_PREVIEW_BILL_BASE,
      isGstBill: gstEnabled,
      gstRate: gstEnabled ? rate : undefined,
      cgstAmount: gstEnabled ? gstAmount / 2 : undefined,
      sgstAmount: gstEnabled ? gstAmount / 2 : undefined,
      totalGstAmount: gstEnabled ? gstAmount : undefined,
      gstNumber: gstEnabled ? settings.gstNumber || storeProfile.gstin : undefined,
      grandTotal,
      remainingBalance: Math.max(0, grandTotal - SAMPLE_PREVIEW_BILL_BASE.amountReceived),
    };
  }, [settings.enableGst, settings.gstRate, settings.gstNumber, storeProfile.gstin]);

  const enabledHeaderFieldCount = HEADER_FIELD_TOGGLES.filter(item =>
    DEFAULT_TRUE_SUMMARY_KEYS.has(item.key) ? design[item.key] !== false : Boolean(design[item.key])
  ).length;
  const activePresetMeta = RECEIPT_PRESET_META.find(p => p.id === template);
  const activeCustomPreset = activeCustomPresetId
    ? savedCustomPresets.find(p => p.id === activeCustomPresetId)
    : undefined;
  const activeDateFormatMeta = DATE_TIME_FORMAT_OPTIONS.find(o => o.id === design.dateTimeFormat);
  const activeItemFormatMeta = ITEM_FORMAT_OPTIONS.find(o => o.id === design.itemDisplayFormat);

  return (
    <section
      aria-labelledby="receipt-customizer-heading"
      className={
        embedded
          ? 'space-y-4'
          : 'bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4'
      }
    >
      {/* Toolbar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-start sm:items-center gap-2.5">
          {!embedded && (
            <div className="w-9 h-9 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0">
              <Palette className="w-4 h-4" />
            </div>
          )}
          <div>
            <h3
              id="receipt-customizer-heading"
              className="text-xs sm:text-sm font-bold text-white tracking-wide flex items-center gap-2"
            >
              {embedded ? 'Template Designer & Live Preview' : 'Thermal Receipt Customizer'}
            </h3>
            <p className="text-[11px] text-slate-400">
              Expand any customization group below to tailor fields, typography, alignment, and item formatting.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleResetToPreset}
            className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            Reset Preset
          </button>
          {showSaveActions && (
            <button
              type="button"
              onClick={handleApplyAndSave}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Save &amp; Apply Design
            </button>
          )}
        </div>
      </div>

      {feedbackMsg && (
        <div className="px-3.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 2-Column Workspace: Collapsible Control Groups Left, Sticky Thermal Preview Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-2.5">
          {/* 1. Preset Templates */}
          <SettingsAccordion
            id="receipt-presets"
            variant="compact"
            title="Preset Templates"
            summary={`Active: ${activeCustomPreset ? `${activeCustomPreset.name} (Custom)` : activePresetMeta?.label || template} · ${RECEIPT_PRESET_META.length} presets`}
            icon={<LayoutTemplate className="w-3.5 h-3.5 text-blue-400" />}
            isOpen={Boolean(openSubSections.presets)}
            onToggle={() => toggleSubSection('presets')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {RECEIPT_PRESET_META.map(preset => {
                const isSelected = template === preset.id && !activeCustomPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500 text-white'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="font-bold text-xs text-white truncate">
                          {preset.label}
                        </span>
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        ) : (
                          <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">
                            {preset.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-snug">
                        {preset.description}
                      </p>
                    </div>
                    <div className="mt-2 pt-1.5 border-t border-slate-800/80 text-[10px] text-sky-300/90 font-medium truncate">
                      {preset.recommendedRoll}
                    </div>
                  </button>
                );
              })}
            </div>
          </SettingsAccordion>

          {/* 2. Saved Custom Designs */}
          <SettingsAccordion
            id="receipt-saved-designs"
            variant="compact"
            title="Saved Custom Designs"
            summary={
              savedCustomPresets.length === 0
                ? 'None saved yet'
                : `${savedCustomPresets.length} saved${activeCustomPreset ? ` · Active: ${activeCustomPreset.name}` : ''}`
            }
            icon={<BookmarkPlus className="w-3.5 h-3.5 text-emerald-400" />}
            isOpen={Boolean(openSubSections.saved)}
            onToggle={() => toggleSubSection('saved')}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Save combinations of toggles and styles for quick switching.
              </span>
              <div className="flex items-center gap-1.5">
                {activeCustomPresetId && (
                  <button
                    type="button"
                    onClick={handleUpdateActiveCustomPreset}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition whitespace-nowrap"
                  >
                    Update Selected
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setIsSavingNewPreset(prev => !prev);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold transition whitespace-nowrap"
                >
                  {isSavingNewPreset ? 'Cancel' : '+ Save New Design'}
                </button>
              </div>
            </div>

            {isSavingNewPreset && (
              <form onSubmit={handleCreateCustomPreset} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                  placeholder="Design name (e.g. Fast Counter 58mm)"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  maxLength={40}
                />
                <button
                  type="submit"
                  disabled={!newPresetName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition whitespace-nowrap"
                >
                  Save Design
                </button>
              </form>
            )}

            {savedCustomPresets.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                No saved custom designs yet. Configure your layout and click &ldquo;+ Save New Design&rdquo;.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {savedCustomPresets.map(preset => {
                  const isActive = activeCustomPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 transition ${
                        isActive
                          ? 'bg-emerald-600/15 border-emerald-500/60 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleLoadCustomPreset(preset)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-xs font-bold truncate flex items-center gap-1.5">
                          {isActive && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                          <span className="truncate">{preset.name}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {preset.paperWidth} · {preset.design.fontSize.toUpperCase()} · {preset.design.itemDisplayFormat.replace('_', ' ')}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomPreset(preset.id)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition flex-shrink-0"
                        aria-label={`Delete ${preset.name}`}
                        title="Delete saved custom design"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsAccordion>

          {/* 3. Header & Summary Field Toggles */}
          <SettingsAccordion
            id="receipt-field-toggles"
            variant="compact"
            title="Header & Receipt Field Toggles"
            summary={`${enabledHeaderFieldCount} of ${HEADER_FIELD_TOGGLES.length} fields visible`}
            icon={<Sliders className="w-3.5 h-3.5 text-cyan-400" />}
            isOpen={Boolean(openSubSections.fields)}
            onToggle={() => toggleSubSection('fields')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HEADER_FIELD_TOGGLES.map(item => {
                const checked = DEFAULT_TRUE_SUMMARY_KEYS.has(item.key)
                  ? design[item.key] !== false
                  : Boolean(design[item.key]);
                return (
                  <div
                    key={item.key}
                    className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <span className="text-[11px] font-semibold text-slate-200 truncate">
                      {item.label}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={`Toggle ${item.label}`}
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        updateDesign({ [item.key]: !checked });
                      }}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                        checked ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                          checked ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </SettingsAccordion>

          {/* 4. Date/Time Formatting, Paper Width, Font Size & Alignment */}
          <SettingsAccordion
            id="receipt-typography-alignment"
            variant="compact"
            title="Font Size, Alignment & Date/Time"
            summary={`${paperWidth} · ${design.fontSize.toUpperCase()} · Header ${design.headerAlignment} · ${activeDateFormatMeta?.label || design.dateTimeFormat}`}
            icon={<Type className="w-3.5 h-3.5 text-purple-400" />}
            isOpen={Boolean(openSubSections.typography)}
            onToggle={() => toggleSubSection('typography')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Header Style */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Header Layout Style
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'centered' as ReceiptHeaderLayout, label: 'Standard Block' },
                      { id: 'split_3line' as ReceiptHeaderLayout, label: '3-Line Split' },
                    ] as const
                  ).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        updateDesign({ headerLayout: opt.id });
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition whitespace-nowrap ${
                        design.headerLayout === opt.id
                          ? 'bg-blue-600/25 border-blue-500 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paper Width */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  Thermal Paper Width
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['58mm', '80mm'] as const).map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => handleChangePaperWidth(w)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition whitespace-nowrap ${
                        paperWidth === w
                          ? 'bg-emerald-600/25 border-emerald-500 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {w} Roll
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Font Size */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                <Type className="w-3.5 h-3.5 text-purple-400" />
                Receipt Font Size
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {FONT_SIZE_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateDesign({ fontSize: opt.id });
                    }}
                    className={`p-2 rounded-lg border text-left transition ${
                      design.fontSize === opt.id
                        ? 'bg-blue-600/25 border-blue-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-black">{opt.label}</div>
                    <div className="text-[10px] text-slate-400">{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Header & Footer Alignment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Header Alignment
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'left' as ReceiptAlignment, label: 'Left', Icon: AlignLeft },
                      { id: 'center' as ReceiptAlignment, label: 'Center', Icon: AlignCenter },
                      { id: 'right' as ReceiptAlignment, label: 'Right', Icon: AlignRight },
                    ] as const
                  ).map(opt => {
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          updateDesign({ headerAlignment: opt.id });
                        }}
                        className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition ${
                          design.headerAlignment === opt.id
                            ? 'bg-blue-600/25 border-blue-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Footer Alignment
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'left' as ReceiptAlignment, label: 'Left', Icon: AlignLeft },
                      { id: 'center' as ReceiptAlignment, label: 'Center', Icon: AlignCenter },
                      { id: 'right' as ReceiptAlignment, label: 'Right', Icon: AlignRight },
                    ] as const
                  ).map(opt => {
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          updateDesign({ footerAlignment: opt.id });
                        }}
                        className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition ${
                          design.footerAlignment === opt.id
                            ? 'bg-blue-600/25 border-blue-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Date & Time Formatting */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
                Date &amp; Time Formatting
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {DATE_TIME_FORMAT_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateDesign({ dateTimeFormat: opt.id });
                    }}
                    className={`p-2 rounded-lg border text-left transition ${
                      design.dateTimeFormat === opt.id
                        ? 'bg-amber-600/20 border-amber-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] font-bold">{opt.label}</div>
                    <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {opt.example}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </SettingsAccordion>

          {/* 5. Item Display Formats & Footer Text */}
          <SettingsAccordion
            id="receipt-item-format"
            variant="compact"
            title="Item Display Format & Footer"
            summary={`${activeItemFormatMeta?.label || design.itemDisplayFormat} · Rate ${design.showItemRate ? 'On' : 'Off'}`}
            icon={<ListOrdered className="w-3.5 h-3.5 text-emerald-400" />}
            isOpen={Boolean(openSubSections.items)}
            onToggle={() => toggleSubSection('items')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
              {ITEM_FORMAT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ itemDisplayFormat: opt.id });
                  }}
                  className={`p-2 rounded-lg border text-left transition ${
                    design.itemDisplayFormat === opt.id
                      ? 'bg-emerald-600/20 border-emerald-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="text-[11px] font-bold">{opt.label}</div>
                  <div className="text-[10px] text-slate-400 truncate">{opt.description}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-200">
                  Show Unit Rate (₹)
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={design.showItemRate}
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ showItemRate: !design.showItemRate });
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                    design.showItemRate ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                      design.showItemRate ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-200">
                  Show Unit Packaging Info
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={design.showItemUnitDetail}
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ showItemUnitDetail: !design.showItemUnitDetail });
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                    design.showItemUnitDetail ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                      design.showItemUnitDetail ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-slate-200 block">
                  Quantity Unit Codes (PIE / BAN / LAR)
                </span>
                <span className="text-[10px] text-slate-400">
                  Use PIE for pieces, BAN for bundles, LAR for ladis instead of B/P
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={design.qtyUnitStyle === 'code_pie_ban_lar'}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  updateDesign({
                    qtyUnitStyle:
                      design.qtyUnitStyle === 'code_pie_ban_lar' ? 'short' : 'code_pie_ban_lar',
                  });
                }}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                  design.qtyUnitStyle === 'code_pie_ban_lar' ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                    design.qtyUnitStyle === 'code_pie_ban_lar' ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Custom Branding Header & Footer Text */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-slate-200 block">
                      Custom Header Branding Text
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Top tagline, GST branch note, or seasonal greeting printed above the store title
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(design.showCustomHeaderText)}
                    aria-label="Toggle custom header branding text"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateDesign({ showCustomHeaderText: !design.showCustomHeaderText });
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                      design.showCustomHeaderText ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                        design.showCustomHeaderText ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {design.showCustomHeaderText && (
                  <textarea
                    rows={2}
                    value={design.customHeaderText || ''}
                    onChange={e => updateDesign({ customHeaderText: e.target.value })}
                    placeholder="e.g. WHOLESALE DISTRIBUTORS · EST. 1998"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-y"
                  />
                )}
              </div>

              {design.showFooterMessage && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-300 block">
                    Custom Footer Branding Message (Supports Multi-Line)
                  </label>
                  <textarea
                    rows={2}
                    value={design.customFooterText}
                    onChange={e => updateDesign({ customFooterText: e.target.value })}
                    placeholder={'Thank you for your business!\nGoods once sold will not be returned without bill.'}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-y"
                  />
                </div>
              )}
            </div>
          </SettingsAccordion>

          {/* 6. Barcode, QR Code & Watermark Overlays */}
          <SettingsAccordion
            id="receipt-codes-watermark"
            variant="compact"
            title="Barcode, QR Code & Watermark Overlays"
            summary={`Barcode ${design.showBarcode ? (design.barcodeFormat === 'code39' ? 'Code 39' : 'Code 128') : 'Off'} · QR ${
              design.showQrCode ? (design.qrCodeMode === 'upi_payment' ? 'UPI' : design.qrCodeMode === 'custom_url' ? 'URL' : 'Verify') : 'Off'
            } · Watermark ${design.watermarkEnabled ? design.watermarkText || 'On' : 'Off'}`}
            icon={<QrCode className="w-3.5 h-3.5 text-sky-400" />}
            isOpen={Boolean(openSubSections.codesWatermark)}
            onToggle={() => toggleSubSection('codesWatermark')}
          >
            {/* 1D Barcode Controls */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Barcode className="w-4 h-4 text-sky-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-slate-200 block">
                      Print 1D Invoice Barcode
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Encodes Bill Number for fast optical scanner lookup &amp; returns
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(design.showBarcode)}
                  aria-label="Toggle invoice barcode printing"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ showBarcode: !design.showBarcode });
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                    design.showBarcode ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                      design.showBarcode ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {design.showBarcode && (
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {(
                    [
                      { id: 'code128', label: 'Code 128 (Compact ASCII)' },
                      { id: 'code39', label: 'Code 39 (Wide Industrial)' },
                    ] as const
                  ).map(fmt => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        updateDesign({ barcodeFormat: fmt.id });
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition ${
                        (design.barcodeFormat || 'code128') === fmt.id
                          ? 'bg-sky-600/25 border-sky-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2D QR Code Controls */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <QrCode className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-slate-200 block">
                      Print 2D QR Code
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Invoice verification payload, UPI Pay QR, or custom website link
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(design.showQrCode)}
                  aria-label="Toggle QR code printing"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ showQrCode: !design.showQrCode });
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                    design.showQrCode ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                      design.showQrCode ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {design.showQrCode && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'invoice_verify', label: 'Invoice Verify' },
                        { id: 'upi_payment', label: 'UPI Payment' },
                        { id: 'custom_url', label: 'Custom URL' },
                      ] as const
                    ).map(mode => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          updateDesign({ qrCodeMode: mode.id });
                        }}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition whitespace-nowrap ${
                          (design.qrCodeMode || 'invoice_verify') === mode.id
                            ? 'bg-emerald-600/25 border-emerald-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {design.qrCodeMode === 'upi_payment' && (
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-semibold text-slate-300 block">
                        Store UPI ID (VPA)
                      </label>
                      <input
                        type="text"
                        value={design.qrUpiId || ''}
                        onChange={e => updateDesign({ qrUpiId: e.target.value })}
                        placeholder="e.g. sqenterprises@oksbi"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}

                  {design.qrCodeMode === 'custom_url' && (
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-semibold text-slate-300 block">
                        Custom QR URL or Text
                      </label>
                      <input
                        type="text"
                        value={design.qrCustomPayload || ''}
                        onChange={e => updateDesign({ qrCustomPayload: e.target.value })}
                        placeholder="https://yourstore.example/feedback"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10.5px] font-semibold text-slate-300 block">
                      QR Caption Label
                    </label>
                    <input
                      type="text"
                      value={design.qrCodeLabel ?? 'Scan to verify / pay'}
                      onChange={e => updateDesign({ qrCodeLabel: e.target.value })}
                      placeholder="Scan to verify / pay"
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Watermark Overlay Controls */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Stamp className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-slate-200 block">
                      Receipt Watermark Overlay
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Background stamp rendered across printed receipt paper
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(design.watermarkEnabled)}
                  aria-label="Toggle receipt watermark overlay"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updateDesign({ watermarkEnabled: !design.watermarkEnabled });
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
                    design.watermarkEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-150 ${
                      design.watermarkEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {design.watermarkEnabled && (
                <div className="space-y-2.5 pt-1">
                  <div className="space-y-1">
                    <label className="text-[10.5px] font-semibold text-slate-300 block">
                      Watermark Text
                    </label>
                    <input
                      type="text"
                      maxLength={28}
                      value={design.watermarkText || ''}
                      onChange={e => updateDesign({ watermarkText: e.target.value })}
                      placeholder={storeProfile.storeName?.trim() || 'ORIGINAL'}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs uppercase font-bold tracking-wider text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'ORIGINAL',
                      'PAID',
                      'DUPLICATE',
                      'CREDIT DUE',
                      (storeProfile.storeName || 'SQ ENTERPRISES').slice(0, 20).toUpperCase(),
                    ].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          updateDesign({ watermarkText: preset });
                        }}
                        className={`px-2 py-1 rounded-md border text-[10px] font-bold uppercase transition ${
                          (design.watermarkText || '').toUpperCase() === preset
                            ? 'bg-amber-600/25 border-amber-500 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-semibold text-slate-300 block">
                        Overlay Style
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            { id: 'diagonal', label: 'Diagonal' },
                            { id: 'stamp', label: 'Stamp' },
                            { id: 'repeated_grid', label: 'Grid' },
                          ] as const
                        ).map(st => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              updateDesign({ watermarkStyle: st.id });
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-[10.5px] font-bold transition ${
                              (design.watermarkStyle || 'diagonal') === st.id
                                ? 'bg-amber-600/25 border-amber-500 text-white'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <label
                          htmlFor="watermark-opacity-range"
                          className="font-semibold text-slate-300"
                        >
                          Ink Darkness
                        </label>
                        <span className="font-mono font-bold text-amber-300 tabular-nums">
                          {Math.round((design.watermarkOpacity ?? 0.12) * 100)}%
                        </span>
                      </div>
                      <input
                        id="watermark-opacity-range"
                        type="range"
                        min={6}
                        max={24}
                        step={2}
                        value={Math.round((design.watermarkOpacity ?? 0.12) * 100)}
                        onChange={e =>
                          updateDesign({ watermarkOpacity: Number(e.target.value) / 100 })
                        }
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </SettingsAccordion>
        </div>

        {/* RIGHT COLUMN: LIVE THERMAL RECEIPT PREVIEW */}
        <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              {enableLiveReceiptRendering || snapshotPreviewOpen ? (
                <Eye className="w-3.5 h-3.5 text-purple-400" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-amber-400" />
              )}
              {enableLiveReceiptRendering
                ? 'Live Thermal Preview'
                : snapshotPreviewOpen
                ? 'Snapshot Thermal Preview'
                : 'Live Preview Paused'}
            </span>
            <div className="flex items-center gap-2">
              {!enableLiveReceiptRendering && snapshotPreviewOpen && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setSnapshotPreviewOpen(false);
                  }}
                  className="text-[11px] font-bold text-amber-300 hover:text-amber-200 underline"
                >
                  Pause Preview
                </button>
              )}
              <span className="text-[11px] text-slate-400 tabular-nums">
                {paperWidth} · {design.fontSize.toUpperCase()}
              </span>
            </div>
          </div>

          {enableLiveReceiptRendering || snapshotPreviewOpen ? (
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex justify-center overflow-x-auto">
              <ThermalReceiptPaper
                bill={previewBill}
                storeProfile={storeProfile}
                design={design}
                paperWidth={paperWidth}
                thankYouFallback={settings.thankYouMessage}
                autoCutPreview={
                  (printers ?? settings.printers)?.autoCutPaper !== false
                    ? (printers ?? settings.printers)?.autoCutMode || 'partial'
                    : false
                }
                previewFixedWidth
              />
            </div>
          ) : (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400 flex-shrink-0">
                  <Gauge className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white">
                    Live Receipt Rendering Paused (Fast Mode)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Edits update your receipt configuration instantly without continuous thermal paper DOM re-renders.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Template</span>
                  <span className="font-bold text-white">
                    {activeCustomPreset
                      ? `${activeCustomPreset.name} (Custom)`
                      : activePresetMeta?.label || template}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Roll &amp; Font</span>
                  <span className="font-mono text-slate-200">
                    {paperWidth} · {design.fontSize.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Header / Footer Align</span>
                  <span className="capitalize text-slate-200">
                    {design.headerAlignment} / {design.footerAlignment}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Item Format</span>
                  <span className="text-slate-200">
                    {activeItemFormatMeta?.label || design.itemDisplayFormat}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Codes &amp; Watermark</span>
                  <span className="text-sky-300 font-medium">
                    {[
                      design.showBarcode ? 'Barcode' : '',
                      design.showQrCode ? 'QR' : '',
                      design.watermarkEnabled ? 'Watermark' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'None'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Visible Fields</span>
                  <span className="font-mono text-emerald-300 tabular-nums">
                    {enabledHeaderFieldCount} / {HEADER_FIELD_TOGGLES.length}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSnapshotPreviewOpen(true);
                }}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition"
              >
                <Eye className="w-3.5 h-3.5 text-blue-400" />
                Render Snapshot Preview
              </button>
            </div>
          )}

          {showSaveActions && (
            <button
              type="button"
              onClick={handleApplyAndSave}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 transition active:scale-95"
            >
              <Save className="w-4 h-4" />
              Save &amp; Apply Receipt Design
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
