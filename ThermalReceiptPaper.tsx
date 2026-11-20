import React, { useMemo } from 'react';
import {
  Bill,
  PaperWidthType,
  ReceiptAlignment,
  ReceiptDesignConfig,
  ReceiptFontSize,
  StoreProfile,
} from '../types';
import { formatReceiptDateTime } from '../utils/receiptPresets';
import {
  buildReceiptQrPayload,
  encodeReceiptBarcode,
  encodeReceiptQrMatrix,
} from '../utils/receiptCodes';
import { Scissors } from 'lucide-react';

interface ThermalReceiptPaperProps {
  bill: Bill;
  storeProfile: StoreProfile;
  design: ReceiptDesignConfig;
  paperWidth: PaperWidthType;
  thankYouFallback?: string;
  previewFixedWidth?: boolean;
  autoCutPreview?: 'partial' | 'full' | false;
  id?: string;
}

const FONT_SCALE: Record<
  ReceiptFontSize,
  {
    base: string;
    title: string;
    meta: string;
    tableHeader: string;
    itemRow: string;
    subItem: string;
    summary: string;
    grandTotal: string;
    footer: string;
  }
> = {
  xs: {
    base: 'text-[8.5px] leading-tight',
    title: 'text-[11px] leading-tight',
    meta: 'text-[7.5px] leading-tight',
    tableHeader: 'text-[7.5px]',
    itemRow: 'text-[8.5px] leading-tight',
    subItem: 'text-[7px]',
    summary: 'text-[8px]',
    grandTotal: 'text-[9.5px]',
    footer: 'text-[7.5px]',
  },
  sm: {
    base: 'text-[9.5px] leading-tight',
    title: 'text-xs sm:text-sm leading-tight',
    meta: 'text-[8px] sm:text-[8.5px] leading-tight',
    tableHeader: 'text-[8px] sm:text-[8.5px]',
    itemRow: 'text-[9px] sm:text-[9.5px] leading-tight',
    subItem: 'text-[7.5px]',
    summary: 'text-[8.5px] sm:text-[9px]',
    grandTotal: 'text-[10.5px] sm:text-[11px]',
    footer: 'text-[8px] sm:text-[8.5px]',
  },
  md: {
    base: 'text-[10.5px] leading-snug',
    title: 'text-sm sm:text-base leading-tight',
    meta: 'text-[9px] leading-snug',
    tableHeader: 'text-[9px]',
    itemRow: 'text-[10px] leading-snug',
    subItem: 'text-[8px]',
    summary: 'text-[9.5px]',
    grandTotal: 'text-xs',
    footer: 'text-[9px]',
  },
  lg: {
    base: 'text-[11.5px] leading-snug',
    title: 'text-base sm:text-lg leading-tight',
    meta: 'text-[10px] leading-snug',
    tableHeader: 'text-[9.5px]',
    itemRow: 'text-[11px] leading-snug',
    subItem: 'text-[8.5px]',
    summary: 'text-[10.5px]',
    grandTotal: 'text-[13px]',
    footer: 'text-[9.5px]',
  },
};

function alignClass(alignment: ReceiptAlignment): string {
  if (alignment === 'left') return 'text-left';
  if (alignment === 'right') return 'text-right';
  return 'text-center';
}

function flexAlignClass(alignment: ReceiptAlignment): string {
  if (alignment === 'left') return 'justify-start';
  if (alignment === 'right') return 'justify-end';
  return 'justify-center';
}

function getReceiptUnitAbbr(
  item: Bill['items'][number],
  unitStyle?: 'short' | 'code_pie_ban_lar'
): string {
  if (unitStyle === 'code_pie_ban_lar') {
    if (item.unit === 'piece') return 'PIE';
    const unitName = (item.bundleUnitName || '').trim().toLowerCase();
    if (unitName.includes('ladi') || unitName === 'lar') return 'LAR';
    return 'BAN';
  }
  return item.unit === 'bundle' ? 'B' : 'P';
}

export const ThermalReceiptPaper: React.FC<ThermalReceiptPaperProps> = ({
  bill,
  storeProfile,
  design,
  paperWidth,
  thankYouFallback = 'Thank you for your business!',
  previewFixedWidth = false,
  autoCutPreview = false,
  id,
}) => {
  const scale = FONT_SCALE[design.fontSize] || FONT_SCALE.sm;
  const storeName = storeProfile.storeName?.trim() || 'SQ ENTERPRISES';
  const effectiveGstin = bill.gstNumber || storeProfile.gstin || '07AABCS1429B1Z1';
  const formattedDate = formatReceiptDateTime(bill, design.dateTimeFormat);

  const showLogoImg = Boolean(
    design.showLogo && storeProfile.showLogoOnInvoices && storeProfile.logoDataUrl
  );
  const showFacadeImg = Boolean(
    design.showFacade && storeProfile.showFacadeOnInvoices && storeProfile.facadePhotoDataUrl
  );

  const customHeaderText = design.showCustomHeaderText
    ? (design.customHeaderText || '').trim()
    : '';

  const contactParts = [
    design.showStorePhone && storeProfile.contactNumber?.trim()
      ? `Ph: ${storeProfile.contactNumber.trim()}`
      : '',
    design.showEmail && storeProfile.email?.trim() ? storeProfile.email.trim() : '',
  ].filter(Boolean);
  const contactLine = contactParts.join(' | ');

  const totalItemLines = bill.items.length;
  const totalUnitsCount = bill.items.reduce((sum, i) => sum + i.quantity, 0);
  const totalBundles = bill.items
    .filter(i => i.unit === 'bundle')
    .reduce((sum, i) => sum + i.quantity, 0);
  const totalLoosePcs = bill.items
    .filter(i => i.unit === 'piece')
    .reduce((sum, i) => sum + i.quantity, 0);
  const grandTotalPieces = bill.items.reduce((sum, i) => sum + i.totalPieces, 0);

  const invoiceValue = design.showInvoiceLabel ? `#${bill.billNumber}` : bill.billNumber;
  const footerText =
    design.customFooterText.trim() || thankYouFallback || 'Thank you for your business!';

  const barcodeData = useMemo(() => {
    if (!design.showBarcode) return null;
    return encodeReceiptBarcode(bill.billNumber, design.barcodeFormat || 'code128');
  }, [design.showBarcode, design.barcodeFormat, bill.billNumber]);

  const qrData = useMemo(() => {
    if (!design.showQrCode) return null;
    const payload = buildReceiptQrPayload(bill, storeProfile, design);
    const matrix = encodeReceiptQrMatrix(payload);
    if (!matrix) return null;
    const paths: string[] = [];
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (matrix.modules[y][x]) {
          paths.push(`M${x} ${y}h1v1h-1z`);
        }
      }
    }
    return {
      size: matrix.size,
      pathD: paths.join(''),
      payload: matrix.payload,
    };
  }, [
    design.showQrCode,
    design.qrCodeMode,
    design.qrUpiId,
    design.qrCustomPayload,
    bill,
    storeProfile,
  ]);

  const watermarkText = design.watermarkEnabled
    ? (design.watermarkText || storeName).trim().toUpperCase()
    : '';
  const watermarkOpacity = Math.min(0.28, Math.max(0.06, design.watermarkOpacity ?? 0.12));
  const watermarkStyle = design.watermarkStyle || 'diagonal';

  const paperStyle: React.CSSProperties = previewFixedWidth
    ? { width: paperWidth === '58mm' ? '220px' : '310px' }
    : { maxWidth: paperWidth === '58mm' ? '58mm' : '80mm' };

  return (
    <div
      id={id}
      style={paperStyle}
      className={`relative overflow-hidden print:overflow-hidden w-full bg-white text-black p-2.5 sm:p-3 rounded shadow-md font-mono tabular-nums border border-gray-300 print:m-0 print:p-1 print:border-none print:shadow-none print:w-full ${scale.base}`}
    >
      {/* OPTIONAL RECEIPT WATERMARK OVERLAY (strictly scoped inside thermal paper sheet) */}
      {watermarkText && (
        <div
          aria-hidden="true"
          style={{ opacity: watermarkOpacity }}
          className="pointer-events-none select-none absolute inset-0 z-0 overflow-hidden text-black"
        >
          {watermarkStyle === 'repeated_grid' ? (
            <div className="w-full h-full grid grid-cols-2 gap-y-10 gap-x-2 py-6 px-2 place-items-center">
              {Array.from({ length: 8 }).map((_, idx) => (
                <span
                  key={idx}
                  className="-rotate-25 font-black uppercase tracking-widest text-[10px] leading-none whitespace-nowrap"
                >
                  {watermarkText}
                </span>
              ))}
            </div>
          ) : watermarkStyle === 'stamp' ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="-rotate-12 border-2 border-black px-2.5 py-1 font-black uppercase tracking-[0.18em] text-sm sm:text-base whitespace-nowrap">
                {watermarkText}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center px-2">
              <span
                className={`-rotate-30 font-black uppercase tracking-[0.2em] text-center break-words leading-tight ${
                  paperWidth === '58mm' ? 'text-lg' : 'text-2xl'
                }`}
              >
                {watermarkText}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="relative z-10 space-y-1.5">
        {/* OPTIONAL STOREFRONT FACADE */}
        {showFacadeImg && (
          <div className="w-full h-16 rounded overflow-hidden border border-gray-300">
            <img
              src={storeProfile.facadePhotoDataUrl}
              alt={`${storeName} storefront`}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* ============================================================== */}
        {/* HEADER SECTION */}
        {/* ============================================================== */}
        {design.headerLayout === 'split_3line' ? (
          <div className="pb-1 border-b-2 border-dashed border-black space-y-0.5 leading-tight">
            {customHeaderText && (
              <div
                className={`font-black uppercase tracking-wider text-gray-800 whitespace-pre-line pb-0.5 ${scale.meta} ${alignClass(
                  design.headerAlignment
                )}`}
              >
                {customHeaderText}
              </div>
            )}
            {showLogoImg && (
              <div className={`flex pb-0.5 ${flexAlignClass(design.headerAlignment)}`}>
                <img
                  src={storeProfile.logoDataUrl}
                  alt={storeName}
                  className="h-7 max-w-[90px] object-contain"
                />
              </div>
            )}

            {/* Line 1: Store Name (left) & Bill Number (top right) */}
            {(design.showStoreName || design.showInvoiceNumber) && (
              <div className="flex justify-between items-baseline gap-2">
                {design.showStoreName ? (
                  <span className={`font-black uppercase tracking-tight truncate ${scale.title}`}>
                    {storeName}
                  </span>
                ) : (
                  <span />
                )}
                {design.showInvoiceNumber && (
                  <span className={`font-black flex-shrink-0 ${scale.title}`}>
                    {design.showInvoiceLabel ? `Bill ${invoiceValue}` : invoiceValue}
                  </span>
                )}
              </div>
            )}

            {design.showTagline && (
              <div className={`font-bold text-gray-800 ${scale.meta} ${alignClass(design.headerAlignment)}`}>
                {storeProfile.tagline?.trim() || 'WHOLESALE FMCG GOODS'}
              </div>
            )}

            {design.showAddress && storeProfile.address?.trim() && (
              <div className={`text-gray-700 ${scale.subItem} ${alignClass(design.headerAlignment)}`}>
                {storeProfile.address.trim()}
              </div>
            )}

            {/* Line 2: Date & Time (left) & Store Mobile Number (right, below Bill Number) */}
            {(design.showDateTime || design.showStorePhone) && (
              <div className={`flex justify-between items-baseline gap-1.5 font-semibold text-gray-800 ${scale.meta}`}>
                <span className="truncate">{design.showDateTime ? formattedDate : ''}</span>
                {design.showStorePhone && (
                  <span className="font-bold flex-shrink-0">
                    {storeProfile.contactNumber?.trim() || 'N/A'}
                  </span>
                )}
              </div>
            )}

            {design.showEmail && storeProfile.email?.trim() && (
              <div className={`text-gray-700 ${scale.subItem} ${alignClass(design.headerAlignment)}`}>
                {storeProfile.email.trim()}
              </div>
            )}

            {/* Line 3: Customer Name (left) & Customer Phone (right) */}
            {(design.showCustomerName || design.showCustomerPhone) && (
              <div className={`flex justify-between items-baseline gap-2 ${scale.meta}`}>
                <span className="font-bold truncate">
                  {design.showCustomerName ? bill.customerName || 'Walk-in Customer' : ''}
                </span>
                {design.showCustomerPhone && (
                  <span className="font-bold flex-shrink-0">
                    {bill.customerPhone || 'N/A'}
                  </span>
                )}
              </div>
            )}

            {bill.isGstBill && (
              <div className="text-center font-black uppercase tracking-wide text-[8px] bg-gray-100 py-0.5 rounded">
                TAX INVOICE · GSTIN: {effectiveGstin}
              </div>
            )}
          </div>
        ) : (
          <>
            {(customHeaderText ||
              showLogoImg ||
              design.showStoreName ||
              design.showTagline ||
              (design.showAddress && storeProfile.address?.trim()) ||
              contactLine ||
              bill.isGstBill) && (
              <div className={`pb-1.5 border-b-2 border-dashed border-black space-y-0.5 ${alignClass(design.headerAlignment)}`}>
                {customHeaderText && (
                  <p className={`font-black uppercase tracking-wider text-gray-800 whitespace-pre-line ${scale.meta}`}>
                    {customHeaderText}
                  </p>
                )}
                {showLogoImg && (
                  <div className={`flex pb-0.5 ${flexAlignClass(design.headerAlignment)}`}>
                    <img
                      src={storeProfile.logoDataUrl}
                      alt={storeName}
                      className="h-9 max-w-[115px] object-contain"
                    />
                  </div>
                )}
                {design.showStoreName && (
                  <h1 className={`font-black uppercase tracking-wider ${scale.title}`}>
                    {storeName}
                  </h1>
                )}
                {design.showTagline && (
                  <p className={`font-bold text-gray-800 ${scale.meta}`}>
                    {bill.isGstBill
                      ? 'TAX INVOICE (GST GOODS)'
                      : storeProfile.tagline?.trim() || 'WHOLESALE FMCG GOODS'}
                  </p>
                )}
                {design.showAddress && storeProfile.address?.trim() && (
                  <p className={`text-gray-700 ${scale.subItem}`}>
                    {storeProfile.address.trim()}
                  </p>
                )}
                {contactLine && (
                  <p className={`font-semibold text-gray-700 ${scale.subItem}`}>
                    {contactLine}
                  </p>
                )}
                {bill.isGstBill && (
                  <p className={`font-bold text-gray-700 ${scale.subItem}`}>
                    GSTIN: {effectiveGstin}
                  </p>
                )}
              </div>
            )}

            {/* Metadata block (Invoice, Date/Time, Customer) */}
            {(design.showInvoiceNumber ||
              design.showDateTime ||
              design.showCustomerName ||
              design.showCustomerPhone) && (
              <div className={`py-1 border-b border-dashed border-black space-y-0.5 ${scale.meta}`}>
                {(design.showInvoiceNumber || design.showDateTime) && (
                  <div className="flex justify-between items-baseline gap-2">
                    <span>
                      {design.showInvoiceNumber ? (
                        <>
                          {design.showInvoiceLabel && <span className="text-gray-600">Bill No: </span>}
                          <strong className="font-black">{invoiceValue}</strong>
                        </>
                      ) : null}
                    </span>
                    {design.showDateTime && (
                      <span className="font-semibold text-right">{formattedDate}</span>
                    )}
                  </div>
                )}
                {(design.showCustomerName || design.showCustomerPhone) && (
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="truncate">
                      {design.showCustomerName ? (
                        <>
                          <span className="text-gray-600">Customer: </span>
                          <strong>{bill.customerName || 'Walk-in Customer'}</strong>
                        </>
                      ) : null}
                    </span>
                    {design.showCustomerPhone && (
                      <span className="flex-shrink-0">
                        <span className="text-gray-600">Ph: </span>
                        <strong>{bill.customerPhone || 'N/A'}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ============================================================== */}
        {/* ITEM DISPLAY FORMATS */}
        {/* ============================================================== */}
        {design.itemDisplayFormat === 'compact_inline' && (
          <div className={`py-1 border-b border-dashed border-black space-y-1 ${scale.itemRow}`}>
            {bill.items.map((item, idx) => {
              const abbr = getReceiptUnitAbbr(item, design.qtyUnitStyle);
              return (
                <div key={idx} className="flex justify-between items-baseline gap-1.5">
                  <span className="truncate font-semibold">
                    {item.productName} ({item.quantity}
                    {design.qtyUnitStyle === 'code_pie_ban_lar' ? ` ${abbr}` : abbr})
                    {design.showItemRate ? ` @₹${item.unitPrice}` : ''}
                  </span>
                  <span className="font-bold flex-shrink-0">₹{item.itemTotal}</span>
                </div>
              );
            })}
          </div>
        )}

        {design.itemDisplayFormat === 'two_line_detail' && (
          <div className="py-1 border-b-2 border-dashed border-black space-y-1">
            {bill.items.map((item, idx) => {
              const abbr = getReceiptUnitAbbr(item, design.qtyUnitStyle);
              return (
                <div key={idx} className={scale.itemRow}>
                  <div className="flex justify-between font-bold gap-2">
                    <span className="truncate">{item.productName}</span>
                    <span className="flex-shrink-0">₹{item.itemTotal}</span>
                  </div>
                  <div className={`flex justify-between text-gray-600 ${scale.subItem}`}>
                    <span>
                      {item.quantity}{' '}
                      {design.qtyUnitStyle === 'code_pie_ban_lar'
                        ? abbr
                        : item.unit === 'bundle'
                          ? item.bundleUnitName
                          : 'Piece'}
                      {design.showItemUnitDetail ? ` (${item.totalPieces} pcs)` : ''}
                    </span>
                    {design.showItemRate && <span>Rate: ₹{item.unitPrice}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {design.itemDisplayFormat === 'numbered_audit' && (
          <div className="py-1 border-b-2 border-black">
            <div className={`grid grid-cols-12 font-bold border-b border-black pb-0.5 mb-1 uppercase ${scale.tableHeader}`}>
              <span className="col-span-1">#</span>
              <span className={design.showItemRate ? 'col-span-5' : 'col-span-7'}>Item &amp; Unit</span>
              <span className="col-span-2 text-center">Pcs</span>
              {design.showItemRate && <span className="col-span-2 text-right">Rate</span>}
              <span className="col-span-2 text-right">Amt</span>
            </div>
            <div className="space-y-1">
              {bill.items.map((item, idx) => {
                const abbr = getReceiptUnitAbbr(item, design.qtyUnitStyle);
                return (
                  <div key={idx} className={`grid grid-cols-12 items-start ${scale.itemRow}`}>
                    <span className="col-span-1 text-gray-500">{idx + 1}</span>
                    <div className={`${design.showItemRate ? 'col-span-5' : 'col-span-7'} pr-1`}>
                      <p className="font-bold leading-tight truncate">{item.productName}</p>
                      {design.showItemUnitDetail && (
                        <p className={`text-gray-600 ${scale.subItem}`}>
                          {item.quantity}{' '}
                          {design.qtyUnitStyle === 'code_pie_ban_lar'
                            ? abbr
                            : item.unit === 'bundle'
                              ? item.bundleUnitName
                              : 'Piece'}
                        </p>
                      )}
                    </div>
                    <span className="col-span-2 text-center font-bold">{item.totalPieces}</span>
                    {design.showItemRate && (
                      <span className="col-span-2 text-right text-gray-700">₹{item.unitPrice}</span>
                    )}
                    <span className="col-span-2 text-right font-black">₹{item.itemTotal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {design.itemDisplayFormat === 'bulk_cards' && (
          <div className="space-y-1.5">
            <div className="py-1 border-b-2 border-black space-y-1.5">
              <div className={`font-black uppercase text-gray-800 tracking-wide ${scale.tableHeader}`}>
                DISPATCH ITEMS (COUNT VERIFICATION):
              </div>
              {bill.items.map((i, idx) => {
                const abbr = getReceiptUnitAbbr(i, design.qtyUnitStyle);
                return (
                  <div key={idx} className="p-1.5 rounded bg-gray-50 border border-gray-400 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-[10.5px] text-black bg-white px-1 py-0.2 rounded border border-black">
                        [{' '}
                        {i.quantity}{' '}
                        {design.qtyUnitStyle === 'code_pie_ban_lar'
                          ? abbr
                          : i.unit === 'bundle'
                            ? `${i.bundleUnitName.toUpperCase()}S`
                            : 'PCS'}{' '}
                        ]
                      </span>
                      <span className="font-black text-[10.5px]">₹{i.itemTotal}</span>
                    </div>
                    <div className={`font-bold text-gray-900 truncate ${scale.itemRow}`}>{i.productName}</div>
                    {(design.showItemUnitDetail || design.showItemRate) && (
                      <div className={`flex justify-between text-gray-600 ${scale.subItem}`}>
                        <span>
                          {design.showItemUnitDetail
                            ? i.unit === 'bundle'
                              ? `(${i.bundlePieces} pcs/bundle = ${i.totalPieces} pcs)`
                              : 'Single Piece (Loose)'
                            : ''}
                        </span>
                        {design.showItemRate && <span>Rate: ₹{i.unitPrice}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-1.5 bg-gray-100 border-2 border-black rounded text-center space-y-0.5">
              <div className={`font-black uppercase tracking-wider text-gray-800 ${scale.subItem}`}>
                TOTAL PACKAGE COUNT TO DELIVER:
              </div>
              <div className={`font-black text-black ${scale.itemRow}`}>
                {totalBundles} BUNDLES + {totalLoosePcs} LOOSE PCS ({grandTotalPieces} PCS)
              </div>
            </div>
          </div>
        )}

        {design.itemDisplayFormat === 'tabular_unit' && (() => {
          const isExpandedCode = design.qtyUnitStyle === 'code_pie_ban_lar';
          const itemColClass = design.showItemRate
            ? isExpandedCode
              ? 'col-span-5'
              : 'col-span-6'
            : isExpandedCode
              ? 'col-span-7'
              : 'col-span-8';
          const qtyColClass = isExpandedCode ? 'col-span-3' : 'col-span-2';

          return (
            <div className="py-1 border-b-2 border-dashed border-black">
              <div className={`grid grid-cols-12 font-bold border-b border-gray-400 pb-0.5 mb-1 uppercase text-gray-800 ${scale.tableHeader}`}>
                <span className={itemColClass}>
                  {design.showItemUnitDetail ? 'Item/Unit' : 'Item'}
                </span>
                <span className={`${qtyColClass} text-center`}>Qty</span>
                {design.showItemRate && <span className="col-span-2 text-right">Rate</span>}
                <span className="col-span-2 text-right">Amt</span>
              </div>
              <div className="space-y-1 py-0.5">
                {bill.items.map((item, idx) => {
                  const abbr = getReceiptUnitAbbr(item, design.qtyUnitStyle);
                  return (
                    <div key={idx} className={`grid grid-cols-12 items-baseline ${scale.itemRow}`}>
                      <div className={`${itemColClass} pr-1 font-semibold truncate`}>
                        {item.productName}
                        {design.showItemUnitDetail && (
                          <span className={`text-gray-600 block ${scale.subItem}`}>
                            {item.unit === 'bundle'
                              ? `(${item.bundleUnitName} of ${item.bundlePieces}p)`
                              : '(Piece)'}
                          </span>
                        )}
                      </div>
                      <div className={`${qtyColClass} text-center font-bold whitespace-nowrap`}>
                        {isExpandedCode ? `${item.quantity} ${abbr}` : `${item.quantity}${abbr}`}
                      </div>
                      {design.showItemRate && (
                        <div className="col-span-2 text-right text-gray-700">₹{item.unitPrice}</div>
                      )}
                      <div className="col-span-2 text-right font-black">₹{item.itemTotal}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* SUMMARY SECTION */}
        {/* ============================================================== */}
        {(() => {
          const showItemsTotal = design.showItemsTotal !== false;
          const showPaidAmount = design.showPaidAmount !== false;
          const showBalanceDue = design.showBalanceDue !== false;
          const showAdjustments = design.showSummaryAdjustments !== false;
          const hasAboveGrandTotal =
            design.showTotalItemsCount ||
            showItemsTotal ||
            (showAdjustments &&
              (Boolean(bill.pricingTierLabel && (bill.pricingSavings || 0) > 0) ||
                (bill.loyaltyDiscountAmount || 0) > 0 ||
                Boolean(bill.isGstBill && bill.totalGstAmount) ||
                bill.previousBalance > 0));

          return (
            <div className={`py-0.5 space-y-0.5 ${scale.summary}`}>
              {design.showTotalItemsCount && (
                <div className="flex justify-between font-bold border-b border-dashed border-gray-400 pb-0.5">
                  <span>Total Items:</span>
                  <span>
                    {totalItemLines} ({totalUnitsCount} units)
                  </span>
                </div>
              )}

              {showItemsTotal && (
                <div className="flex justify-between">
                  <span>{bill.isGstBill ? 'Taxable Subtotal:' : 'Items Total:'}</span>
                  <span className="font-bold">₹{bill.itemsTotal.toFixed(2)}</span>
                </div>
              )}

              {showAdjustments && bill.pricingTierLabel && (bill.pricingSavings || 0) > 0 && (
                <div className={`flex justify-between text-gray-700 ${scale.subItem}`}>
                  <span>Rate Tier ({bill.pricingTierLabel}):</span>
                  <span>-₹{(bill.pricingSavings || 0).toFixed(2)}</span>
                </div>
              )}

              {showAdjustments && (bill.loyaltyDiscountAmount || 0) > 0 && (
                <div className={`flex justify-between font-semibold text-gray-800 ${scale.subItem}`}>
                  <span>Loyalty Redeemed ({bill.loyaltyPointsRedeemed || 0} pts):</span>
                  <span>-₹{(bill.loyaltyDiscountAmount || 0).toFixed(2)}</span>
                </div>
              )}

              {showAdjustments && bill.isGstBill && bill.totalGstAmount && (
                <>
                  <div className="flex justify-between text-gray-700">
                    <span>CGST ({((bill.gstRate || 18) / 2).toFixed(1)}%):</span>
                    <span>₹{(bill.cgstAmount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>SGST ({((bill.gstRate || 18) / 2).toFixed(1)}%):</span>
                    <span>₹{(bill.sgstAmount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Total GST ({bill.gstRate || 18}%):</span>
                    <span>₹{bill.totalGstAmount.toFixed(2)}</span>
                  </div>
                </>
              )}

              {showAdjustments && bill.previousBalance > 0 && (
                <div className="flex justify-between font-medium">
                  <span>Previous Due:</span>
                  <span className="font-bold">₹{bill.previousBalance.toFixed(2)}</span>
                </div>
              )}

              <div
                className={`flex justify-between items-baseline gap-1.5 font-black pt-0.5 ${
                  hasAboveGrandTotal ? 'border-t border-black' : ''
                } ${scale.grandTotal}`}
              >
                <span>Grand Total:</span>
                {design.showInlineQtyOnGrandTotal && (
                  <span className={`font-bold text-gray-800 ${scale.summary}`}>
                    Qty: {totalUnitsCount}
                  </span>
                )}
                <span className="flex-shrink-0">₹{bill.grandTotal.toFixed(2)}</span>
              </div>

              {showPaidAmount && (
                <div className="flex justify-between font-semibold">
                  <span>Paid:</span>
                  <span>₹{bill.amountReceived.toFixed(2)}</span>
                </div>
              )}

              {showAdjustments && (bill.loyaltyPointsEarned || 0) > 0 && (
                <div className={`flex justify-between text-gray-700 ${scale.subItem}`}>
                  <span>Loyalty Earned:</span>
                  <span>+{bill.loyaltyPointsEarned} pts</span>
                </div>
              )}

              {showBalanceDue && (
                <div className="flex justify-between font-black border-t border-dashed border-gray-400 pt-0.5">
                  <span>Balance Due:</span>
                  <span>₹{bill.remainingBalance.toFixed(2)}</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* BARCODE & QR CODE VERIFICATION BLOCK */}
        {/* ============================================================== */}
        {(barcodeData || qrData) && (
          <div className="pt-1.5 border-t border-dashed border-gray-400 space-y-1.5 print:break-inside-avoid">
            {barcodeData && (
              <div className="flex flex-col items-center justify-center">
                <svg
                  role="img"
                  aria-label={`Barcode ${barcodeData.encodedText}`}
                  viewBox={`0 0 ${barcodeData.totalWidth} 28`}
                  className="w-full max-w-[190px] h-7 text-black"
                  preserveAspectRatio="none"
                  shapeRendering="crispEdges"
                >
                  {barcodeData.bars.map((bar, idx) => (
                    <rect
                      key={idx}
                      x={bar.x}
                      y={0}
                      width={bar.w}
                      height={28}
                      fill="currentColor"
                    />
                  ))}
                </svg>
                <span className={`font-mono font-bold tracking-widest text-black ${scale.subItem}`}>
                  {barcodeData.encodedText}
                </span>
              </div>
            )}

            {qrData && (
              <div className="flex flex-col items-center justify-center space-y-0.5">
                <div className="p-1 bg-white border border-gray-300 rounded">
                  <svg
                    role="img"
                    aria-label="Receipt QR Code"
                    viewBox={`0 0 ${qrData.size} ${qrData.size}`}
                    className={`${paperWidth === '58mm' ? 'w-16 h-16' : 'w-20 h-20'} text-black`}
                    shapeRendering="crispEdges"
                  >
                    <path d={qrData.pathD} fill="currentColor" />
                  </svg>
                </div>
                {(design.qrCodeLabel || design.qrCodeMode) && (
                  <span className={`font-semibold text-gray-800 text-center ${scale.subItem}`}>
                    {design.qrCodeLabel?.trim() ||
                      (design.qrCodeMode === 'upi_payment'
                        ? 'Scan to pay via UPI'
                        : 'Scan to verify invoice')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* FOOTER */}
        {/* ============================================================== */}
        {design.showFooterMessage && (
          <div
            className={`pt-1 border-t border-dashed border-black font-bold whitespace-pre-line ${scale.footer} ${alignClass(
              design.footerAlignment
            )}`}
          >
            {footerText}
          </div>
        )}

        {/* AUTO-CUTTER PERFORATED PREVIEW INDICATOR (SCREEN ONLY) */}
        {autoCutPreview && (
          <div className="print:hidden pt-1.5 mt-1 border-t border-dashed border-gray-400 flex items-center justify-between text-[7.5px] font-bold uppercase tracking-wider text-gray-500">
            <span className="flex items-center gap-1">
              <Scissors className="w-2.5 h-2.5" />
              <span>Auto-Cut: {autoCutPreview === 'full' ? 'Full Sever' : 'Partial Tab'}</span>
            </span>
            <span>ESC/POS GS V</span>
          </div>
        )}
      </div>
    </div>
  );
};
