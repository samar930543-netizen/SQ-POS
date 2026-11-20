import React from 'react';
import { CartItem, Customer } from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { getCustomerPricingLabel } from '../utils/customerPricing';
import { ShoppingCart, ArrowRight, Trash2, Zap } from 'lucide-react';

interface FloatingCartBarProps {
  cart: CartItem[];
  activeCustomer?: Customer | null;
  onOpenCart: () => void;
  onClearCart: () => void;
  onExpressCashCheckout?: () => void;
}

export const FloatingCartBar: React.FC<FloatingCartBarProps> = ({
  cart,
  activeCustomer = null,
  onOpenCart,
  onClearCart,
  onExpressCashCheckout,
}) => {
  const { totalUnits, totalPieces, totalAmount } = cart.reduce(
    (acc, item) => {
      acc.totalUnits += item.quantity;
      acc.totalPieces += item.totalPieces;
      acc.totalAmount += item.itemTotal;
      return acc;
    },
    { totalUnits: 0, totalPieces: 0, totalAmount: 0 }
  );

  const hasItems = cart.length > 0;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3 z-30 px-3 sm:px-5 flex justify-center"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto w-full max-w-4xl rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-200 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3 ${
          hasItems
            ? 'bg-slate-900/95 border-blue-500/50 shadow-blue-950/60'
            : 'bg-slate-900/90 border-slate-800 shadow-black/50'
        }`}
      >
        {/* Left: Live Cart Summary & Real-time Item Count */}
        <button
          type="button"
          onClick={() => {
            soundManager.playMechanicalClick();
            onOpenCart();
          }}
          className="flex items-center gap-3 min-w-0 flex-1 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-xl"
          aria-label={`Open billing cart with ${totalUnits} items totaling ${formatCurrency(totalAmount)}`}
        >
          <div
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 transition ${
              hasItems
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                : 'bg-slate-800 text-slate-400 border border-slate-700/80'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {hasItems && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black flex items-center justify-center tabular-nums border border-slate-900">
                {totalUnits}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white leading-tight truncate">
              <span>{hasItems ? 'Current Bill' : 'Bill Ready'}</span>
              {activeCustomer && (
                <>
                  <span className="text-slate-500" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-emerald-300 truncate">
                    {activeCustomer.name} ({getCustomerPricingLabel(activeCustomer)})
                  </span>
                </>
              )}
            </div>

            <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums truncate">
              {hasItems ? (
                <>
                  {cart.length} {cart.length === 1 ? 'SKU' : 'SKUs'} · {totalUnits}{' '}
                  {totalUnits === 1 ? 'unit' : 'units'} ({totalPieces}{' '}
                  {totalPieces === 1 ? 'pc' : 'pcs'})
                </>
              ) : (
                'Scan barcode or tap any product unit to add items'
              )}
            </div>
          </div>
        </button>

        {/* Right: Real-Time Total Amount & Quick Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
          <div className="text-right tabular-nums">
            <div className="text-[10px] font-semibold text-slate-400 leading-none">
              Items Total
            </div>
            <div
              className={`mt-0.5 text-base sm:text-lg font-black leading-none ${
                hasItems ? 'text-emerald-400' : 'text-slate-300'
              }`}
            >
              {formatCurrency(totalAmount)}
            </div>
          </div>

          {hasItems && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                soundManager.playAlertSound();
                onClearCart();
              }}
              className="p-2 rounded-xl bg-slate-800/90 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 border border-slate-700/80 hover:border-rose-500/40 transition active:scale-95"
              title="Clear bill cart"
              aria-label="Clear bill cart"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {hasItems && onExpressCashCheckout && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onExpressCashCheckout();
              }}
              className="hidden sm:flex px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold items-center gap-1 whitespace-nowrap shrink-0 shadow-md shadow-emerald-950/60 transition active:scale-95"
              title="Complete cash payment immediately & open receipt"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Cash Pay</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              onOpenCart();
            }}
            className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition active:scale-95 ${
              hasItems
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-950/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            <span>{hasItems ? 'Review Bill' : 'Open Cart'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
