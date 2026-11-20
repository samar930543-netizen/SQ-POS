import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Product } from '../types';
import { soundManager } from '../utils/soundEffects';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Edit2,
  FolderKanban,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

export interface CategoryMutationResult {
  ok: boolean;
  error?: string;
  category?: string;
}

interface CategoryManagementPanelProps {
  categories: string[];
  products: Product[];
  onAddCategory: (name: string) => CategoryMutationResult;
  onRenameCategory: (oldName: string, newName: string) => CategoryMutationResult;
  onDeleteCategory: (name: string) => CategoryMutationResult;
  onViewCategoryProducts?: (category: string) => void;
}

type CategoryUsageFilter = 'all' | 'active' | 'unused';

export const CategoryManagementPanel: React.FC<CategoryManagementPanelProps> = ({
  categories,
  products,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onViewCategoryProducts,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState<CategoryUsageFilter>('all');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [feedback, setFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingCategory) {
      const timer = window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [renamingCategory]);

  const showTempFeedback = (type: 'error' | 'success', text: string) => {
    setFeedback({ type, text });
    if (type === 'success') {
      window.setTimeout(() => {
        setFeedback(prev => (prev?.text === text ? null : prev));
      }, 2500);
    }
  };

  // Compute product count & stock pieces per category
  const categoryStats = useMemo(() => {
    const map = new Map<string, { productCount: number; stockPieces: number }>();
    for (const p of products) {
      const key = p.category;
      const prev = map.get(key) || { productCount: 0, stockPieces: 0 };
      prev.productCount += 1;
      prev.stockPieces += p.stockPieces;
      map.set(key, prev);
    }
    return map;
  }, [products]);

  const enrichedCategories = useMemo(() => {
    return categories.map(name => {
      const stats = categoryStats.get(name) || { productCount: 0, stockPieces: 0 };
      return {
        name,
        productCount: stats.productCount,
        stockPieces: stats.stockPieces,
        isUnused: stats.productCount === 0,
      };
    });
  }, [categories, categoryStats]);

  const totalCount = enrichedCategories.length;
  const unusedCount = enrichedCategories.filter(c => c.isUnused).length;
  const activeCount = totalCount - unusedCount;

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedCategories.filter(cat => {
      if (usageFilter === 'active' && cat.isUnused) return false;
      if (usageFilter === 'unused' && !cat.isUnused) return false;
      if (q && !cat.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enrichedCategories, usageFilter, searchQuery]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = onAddCategory(newCategoryName);
    if (!res.ok) {
      soundManager.playAlertSound();
      showTempFeedback('error', res.error || 'Could not add category.');
      return;
    }
    soundManager.playCheckoutSuccess();
    setNewCategoryName('');
    showTempFeedback('success', `Added category "${res.category}".`);
  };

  const startRename = (name: string) => {
    soundManager.playMechanicalClick();
    setConfirmDeleteCategory(null);
    setRenamingCategory(name);
    setRenameDraft(name);
    setRenameError(null);
  };

  const commitRename = () => {
    if (!renamingCategory) return;
    const res = onRenameCategory(renamingCategory, renameDraft);
    if (!res.ok) {
      soundManager.playAlertSound();
      setRenameError(res.error || 'Could not rename category.');
      return;
    }
    soundManager.playCheckoutSuccess();
    const oldName = renamingCategory;
    const updatedName = renameDraft.trim();
    setRenamingCategory(null);
    setRenameDraft('');
    setRenameError(null);
    showTempFeedback(
      'success',
      oldName === updatedName
        ? 'No changes made.'
        : `Renamed "${oldName}" to "${updatedName}".`
    );
  };

  const handleDeleteConfirm = (name: string) => {
    const res = onDeleteCategory(name);
    if (!res.ok) {
      soundManager.playAlertSound();
      showTempFeedback('error', res.error || 'Cannot delete category in use.');
      setConfirmDeleteCategory(null);
      return;
    }
    soundManager.playCheckoutSuccess();
    setConfirmDeleteCategory(null);
    showTempFeedback('success', `Deleted unused category "${name}".`);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-950">
      {/* Category Toolbar & Summary */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800 space-y-3">
        {/* Metrics Summary Row */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">
              Total Categories
            </span>
            <span className="text-lg font-black text-white tabular-nums">{totalCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">
              In Use (Active)
            </span>
            <span className="text-lg font-black text-emerald-400 tabular-nums">{activeCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">
              Unused (Removable)
            </span>
            <span className="text-lg font-black text-amber-300 tabular-nums">{unusedCount}</span>
          </div>
        </div>

        {/* Add New Category Bar */}
        <form onSubmit={handleAddSubmit} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <FolderKanban className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={newCategoryName}
              onChange={e => {
                setNewCategoryName(e.target.value);
                if (feedback?.type === 'error') setFeedback(null);
              }}
              placeholder="Add new category (e.g. Dairy & Bakery, Frozen Foods)..."
              aria-label="New category name"
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Category</span>
          </button>
        </form>

        {/* Inline Feedback Banner */}
        {feedback && (
          <div
            role="status"
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
              feedback.type === 'error'
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-200'
            }`}
          >
            <span className="flex items-center gap-2">
              {feedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              )}
              <span>{feedback.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Dismiss message"
              className="p-0.5 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Search Within Existing Categories & Usage Filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search within existing categories..."
              aria-label="Search existing categories"
              className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear category search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 shrink-0">
            {(
              [
                { id: 'all', label: `All (${totalCount})` },
                { id: 'active', label: `Active (${activeCount})` },
                { id: 'unused', label: `Unused (${unusedCount})` },
              ] as Array<{ id: CategoryUsageFilter; label: string }>
            ).map(tab => {
              const active = usageFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setUsageFilter(tab.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Category Rows */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-800/60">
        {filteredCategories.length === 0 ? (
          <div className="py-14 px-4 flex flex-col items-center justify-center text-center bg-slate-900/40 rounded-2xl border border-slate-800">
            <FolderKanban className="w-10 h-10 text-slate-600 mb-2 stroke-[1.5]" />
            <p className="text-sm font-bold text-slate-200">
              {searchQuery.trim()
                ? `No categories matching "${searchQuery.trim()}"`
                : usageFilter === 'unused'
                ? 'No unused categories'
                : 'No categories found'}
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {searchQuery.trim()
                ? 'Try a different keyword or clear the search filter.'
                : usageFilter === 'unused'
                ? 'Every category currently has products assigned to it.'
                : 'Add a category above to organize your product catalog.'}
            </p>
            {(searchQuery.trim() || usageFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setUsageFilter('all');
                }}
                className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          filteredCategories.map(cat => {
            const isRenaming = renamingCategory === cat.name;
            const isConfirmingDelete = confirmDeleteCategory === cat.name;

            return (
              <div
                key={cat.name}
                className="py-3 px-2.5 rounded-xl hover:bg-slate-900/50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <div className="space-y-1.5 max-w-md">
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameDraft}
                          onChange={e => {
                            setRenameDraft(e.target.value);
                            setRenameError(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setRenamingCategory(null);
                              setRenameError(null);
                            }
                          }}
                          aria-label={`Rename category ${cat.name}`}
                          className="flex-1 px-3 py-1.5 bg-slate-950 border border-blue-500 rounded-lg text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingCategory(null);
                            setRenameError(null);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                      {renameError && (
                        <p className="text-[11px] text-rose-400 flex items-center gap-1 font-medium">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          <span>{renameError}</span>
                        </p>
                      )}
                      {cat.productCount > 0 && !renameError && (
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          All {cat.productCount} assigned product
                          {cat.productCount === 1 ? '' : 's'} will update automatically.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <h4 className="font-bold text-white text-sm truncate">{cat.name}</h4>
                      <div className="flex items-center flex-wrap gap-1.5 text-xs text-slate-400 mt-0.5 tabular-nums">
                        <span className={cat.isUnused ? 'text-amber-300 font-medium' : 'text-emerald-300 font-medium'}>
                          {cat.isUnused
                            ? 'Unused'
                            : `${cat.productCount} ${cat.productCount === 1 ? 'product' : 'products'}`}
                        </span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span>
                          {cat.isUnused
                            ? 'Safe to delete'
                            : `${cat.stockPieces} pcs in stock`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Controls */}
                {!isRenaming && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!cat.isUnused && onViewCategoryProducts && (
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          onViewCategoryProducts(cat.name);
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700 text-xs font-semibold transition whitespace-nowrap shrink-0"
                      >
                        View SKUs
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => startRename(cat.name)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition whitespace-nowrap shrink-0"
                      title={`Rename ${cat.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Rename</span>
                    </button>

                    {cat.isUnused ? (
                      isConfirmingDelete ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteConfirm(cat.name)}
                            className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCategory(null)}
                            className="px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold whitespace-nowrap shrink-0 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playMechanicalClick();
                            setRenamingCategory(null);
                            setConfirmDeleteCategory(cat.name);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 text-xs font-semibold flex items-center gap-1 transition whitespace-nowrap shrink-0"
                          title={`Delete unused category ${cat.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        disabled
                        title={`Cannot delete "${cat.name}" while ${cat.productCount} product${
                          cat.productCount === 1 ? ' is' : 's are'
                        } assigned to it`}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-900/70 text-slate-500 border border-slate-800 text-xs font-semibold flex items-center gap-1 cursor-not-allowed whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>In Use</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
