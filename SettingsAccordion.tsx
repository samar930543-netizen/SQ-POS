import React from 'react';
import { ChevronDown } from 'lucide-react';
import { soundManager } from '../utils/soundEffects';

interface SettingsAccordionProps {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  variant?: 'section' | 'compact';
  children: React.ReactNode;
}

export const SettingsAccordion: React.FC<SettingsAccordionProps> = ({
  id,
  title,
  summary,
  description,
  icon,
  isOpen,
  onToggle,
  variant = 'section',
  children,
}) => {
  const headerId = `accordion-header-${id}`;
  const panelId = `accordion-panel-${id}`;
  const isCompact = variant === 'compact';

  return (
    <div
      className={
        isCompact
          ? `rounded-xl border transition-colors ${
              isOpen
                ? 'bg-slate-950/90 border-slate-700'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`
          : `rounded-2xl border transition-colors ${
              isOpen
                ? 'bg-slate-900 border-slate-700'
                : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
            }`
      }
    >
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => {
          soundManager.playMechanicalClick();
          onToggle();
        }}
        className={`w-full text-left flex items-center justify-between gap-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          isCompact
            ? 'px-3.5 py-2.5 rounded-xl'
            : 'px-4 py-3.5 sm:px-5 sm:py-4 rounded-2xl'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {icon && (
            <div
              className={`flex items-center justify-center flex-shrink-0 border ${
                isCompact
                  ? 'w-7 h-7 rounded-lg bg-slate-900 border-slate-800'
                  : 'w-9 h-9 rounded-xl bg-slate-950 border-slate-800'
              }`}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div
              className={`font-bold text-white truncate ${
                isCompact ? 'text-xs' : 'text-sm'
              }`}
            >
              {title}
            </div>
            {(description || summary) && (
              <div className="text-[11px] text-slate-400 truncate mt-0.5 tabular-nums">
                {isOpen && description ? description : summary || description}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {!isOpen && summary && !isCompact && (
            <span className="hidden md:inline text-[11px] font-medium text-slate-300 tabular-nums max-w-[260px] truncate">
              {summary}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-150 flex-shrink-0 ${
              isOpen ? 'rotate-180 text-white' : ''
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className={
            isCompact
              ? 'px-3.5 pb-3.5 pt-2 border-t border-slate-800/90 space-y-3'
              : 'px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4 border-t border-slate-800 space-y-4'
          }
        >
          {children}
        </div>
      )}
    </div>
  );
};
