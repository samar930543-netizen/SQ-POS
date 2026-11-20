import React from 'react';
import { GitBranch, X } from 'lucide-react';
import {
  MultiStoreManagerPanel,
  MultiStoreManagerPanelProps,
} from './MultiStoreManagerPanel';

interface MultiStoreModalProps extends MultiStoreManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MultiStoreModal: React.FC<MultiStoreModalProps> = ({
  isOpen,
  onClose,
  ...panelProps
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Multi-Store Management and Branch Sync"
    >
      <div className="w-full max-w-4xl max-h-[92vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/35 flex items-center justify-center text-blue-400">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white">
                Multi-Store Branches &amp; Sync Control
              </h3>
              <p className="text-[11px] text-slate-400">
                Switch active branch, configure multi-branch synchronization, or transfer stock.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center justify-center"
            aria-label="Close Multi-Store Manager"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5">
          <MultiStoreManagerPanel {...panelProps} />
        </div>
      </div>
    </div>
  );
};
