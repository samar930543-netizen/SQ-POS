import React, { useState, useRef, useEffect } from 'react';
import { soundManager } from '../utils/soundEffects';

interface EditableQuantityBadgeProps {
  quantity: number;
  onCommit: (newQty: number) => void;
  min?: number;
  longPressMs?: number;
  triggerMode?: 'click' | 'double_or_hold';
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}

export const EditableQuantityBadge: React.FC<EditableQuantityBadgeProps> = ({
  quantity,
  onCommit,
  min = 1,
  longPressMs = 450,
  triggerMode = 'double_or_hold',
  className = '',
  inputClassName = '',
  ariaLabel = 'Quantity',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [draftValue, setDraftValue] = useState(String(quantity));

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearPressTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(String(quantity));
    }
  }, [quantity, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const enterEditMode = () => {
    clearPressTimer();
    soundManager.playMechanicalClick();
    setDraftValue(String(quantity));
    setIsEditing(true);
  };

  const commitValue = () => {
    const trimmed = draftValue.trim();
    if (trimmed === '') {
      setIsEditing(false);
      setDraftValue(String(quantity));
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setIsEditing(false);
      setDraftValue(String(quantity));
      return;
    }

    const nextQty = Math.max(min, Math.floor(parsed));
    setIsEditing(false);
    if (nextQty !== quantity) {
      soundManager.playItemAdded();
      onCommit(nextQty);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraftValue(String(quantity));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (triggerMode === 'click') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setIsPressing(true);

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      enterEditMode();
    }, longPressMs);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (triggerMode === 'click') return;
    if (!pointerStartRef.current || timerRef.current === null) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearPressTimer();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={draftValue}
        onChange={e => setDraftValue(e.target.value)}
        onBlur={commitValue}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitValue();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
          }
        }}
        aria-label={`${ariaLabel} input`}
        className={`w-12 text-center font-bold text-xs text-white bg-slate-900 border border-blue-500 rounded-md px-1 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${inputClassName}`}
      />
    );
  }

  if (triggerMode === 'click') {
    return (
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          enterEditMode();
        }}
        title="Click to enter quantity"
        aria-label={`${ariaLabel}: ${quantity}. Click to edit`}
        className={`min-w-[2rem] px-1.5 py-0.5 text-center font-bold text-xs text-white tabular-nums rounded-md select-none cursor-pointer transition touch-manipulation hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 ${className}`}
      >
        {quantity}
      </button>
    );
  }

  return (
    <button
      type="button"
      onDoubleClick={e => {
        e.stopPropagation();
        enterEditMode();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPressTimer}
      onPointerLeave={clearPressTimer}
      onPointerCancel={clearPressTimer}
      onContextMenu={e => {
        if (isPressing || longPressTriggeredRef.current) {
          e.preventDefault();
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          enterEditMode();
        }
      }}
      title="Double-click or hold to enter quantity"
      aria-label={`${ariaLabel}: ${quantity}. Double-click or hold to edit`}
      className={`min-w-[2rem] px-1.5 py-0.5 text-center font-bold text-xs text-white tabular-nums rounded-md select-none cursor-pointer transition touch-manipulation hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 ${
        isPressing ? 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/70 scale-95' : ''
      } ${className}`}
    >
      {quantity}
    </button>
  );
};

export interface EditableQuantityActionTriggerProps {
  isPressing: boolean;
  shouldSuppressClick: (e: React.MouseEvent<HTMLElement>) => boolean;
  onDoubleClick: React.MouseEventHandler<HTMLElement>;
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerLeave: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
}

interface EditableQuantityActionProps {
  quantity: number;
  unitLabel: string;
  onCommit: (newQty: number) => void;
  min?: number;
  longPressMs?: number;
  accentColor?: 'blue' | 'amber';
  className?: string;
  children: (triggerProps: EditableQuantityActionTriggerProps) => React.ReactNode;
}

export const EditableQuantityAction: React.FC<EditableQuantityActionProps> = ({
  quantity,
  unitLabel,
  onCommit,
  min = 0,
  longPressMs = 450,
  accentColor = 'blue',
  className = '',
  children,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [draftValue, setDraftValue] = useState(quantity > 0 ? String(quantity) : '1');

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const hasTypedRef = useRef(false);
  const openedAtRef = useRef(0);

  const clearPressTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const enterEditMode = () => {
    clearPressTimer();
    soundManager.playMechanicalClick();
    hasTypedRef.current = false;
    openedAtRef.current = Date.now();
    setDraftValue(quantity > 0 ? String(quantity) : '1');
    setIsEditing(true);
  };

  const commitValue = (forceSubmit: boolean = false) => {
    const trimmed = draftValue.trim();
    if (trimmed === '') {
      setIsEditing(false);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setIsEditing(false);
      return;
    }

    const nextQty = Math.max(min, Math.floor(parsed));
    setIsEditing(false);

    if (!forceSubmit && !hasTypedRef.current && quantity === 0) {
      return;
    }

    if (nextQty !== quantity || (forceSubmit && nextQty > 0)) {
      soundManager.playItemAdded();
      onCommit(nextQty);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handlePointerDown: React.PointerEventHandler<HTMLElement> = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setIsPressing(true);

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      enterEditMode();
    }, longPressMs);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLElement> = e => {
    if (!pointerStartRef.current || timerRef.current === null) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearPressTimer();
    }
  };

  const shouldSuppressClick = (e: React.MouseEvent<HTMLElement>) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return true;
    }
    if (e.detail > 1) {
      return true;
    }
    return false;
  };

  if (isEditing) {
    const borderAccent =
      accentColor === 'amber'
        ? 'border-amber-400 focus:border-amber-400 focus:ring-amber-400/50'
        : 'border-blue-400 focus:border-blue-400 focus:ring-blue-400/50';
    const confirmBg =
      accentColor === 'amber'
        ? 'bg-amber-600 hover:bg-amber-500'
        : 'bg-blue-600 hover:bg-blue-500';
    const labelColor = accentColor === 'amber' ? 'text-amber-300' : 'text-blue-300';

    return (
      <div
        onClick={e => e.stopPropagation()}
        className={`flex flex-col justify-between p-1.5 rounded-xl bg-slate-900 border ${borderAccent} shadow-inner ${className}`}
      >
        <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
          <span className={`font-bold truncate ${labelColor}`}>{unitLabel} Qty</span>
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              if (Date.now() - openedAtRef.current < 150) return;
              cancelEdit();
            }}
            className="text-slate-400 hover:text-white px-1 font-bold"
            aria-label={`Cancel ${unitLabel} quantity entry`}
          >
            ✕
          </button>
        </div>

        <div className="mt-1 flex items-center gap-1">
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={min}
            step={1}
            value={draftValue}
            onChange={e => {
              hasTypedRef.current = true;
              setDraftValue(e.target.value);
            }}
            onBlur={() => commitValue(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitValue(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            aria-label={`Enter ${unitLabel} quantity`}
            className="w-full min-w-0 px-1.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs font-black text-white text-center tabular-nums focus:outline-none focus:ring-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              if (Date.now() - openedAtRef.current < 150) return;
              commitValue(true);
            }}
            className={`px-2 py-1 rounded-lg text-white text-[11px] font-bold flex-shrink-0 transition active:scale-95 ${confirmBg}`}
            aria-label={`Apply ${unitLabel} quantity`}
          >
            ✓
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children({
        isPressing,
        shouldSuppressClick,
        onDoubleClick: e => {
          e.stopPropagation();
          enterEditMode();
        },
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: clearPressTimer,
        onPointerLeave: clearPressTimer,
        onPointerCancel: clearPressTimer,
        onContextMenu: e => {
          if (isPressing || longPressTriggeredRef.current) {
            e.preventDefault();
          }
        },
      })}
    </>
  );
};
