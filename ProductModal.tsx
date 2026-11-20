import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../types';
import { soundManager } from '../utils/soundEffects';
import { hasConfiguredBundleTier, hasConfiguredPieceTier } from '../utils/unitSpecs';
import { DEFAULT_PRODUCT_CATEGORIES } from '../utils/storage';
import { CategoryMutationResult } from './CategoryManagementPanel';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { buildBarcodeSvgBars, generateEan13Barcode } from '../utils/barcodeScanner';
import {
  ProductImageSearchResult,
  searchOnlineProductImages,
  cacheSelectedProductImage,
} from '../utils/productImageSearch';
import {
  X,
  Package,
  Upload,
  Link as LinkIcon,
  Smile,
  Trash2,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Star,
  Plus,
  Camera,
  Sparkles,
  ScanBarcode,
  Search,
  Loader2,
  Globe,
  Maximize2,
} from 'lucide-react';

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveProduct: (product: Product) => void;
  productToEdit?: Product | null;
  categories?: string[];
  products?: Product[];
  initialBarcode?: string;
  initialDraft?: {
    name?: string;
    unitType?: 'bundle' | 'piece';
    unitPrice?: number;
  };
  onAddCategory?: (name: string) => CategoryMutationResult;
}

const EMOJI_OPTIONS = [
  '🚬', '🍂', '🧼', '🧴', '🫧', '🧺', '🍪', '🧈', '☕', '🛢️', '🥤', '🍬', '🍫', '📦', '🛒', '🥛', '🌾', '🧂', '🍞', '🧃'
];

/**
 * Resizes and compresses image to max 400x400 JPEG data URL
 * Ensures safe, lightweight storage in localStorage without quota issues
 */
function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image file'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export const ProductModal: React.FC<ProductModalProps> = ({
  isOpen,
  onClose,
  onSaveProduct,
  productToEdit,
  categories,
  products = [],
  initialBarcode,
  initialDraft,
  onAddCategory,
}) => {
  const availableCategories = React.useMemo(() => {
    const base =
      categories && categories.length > 0 ? categories : DEFAULT_PRODUCT_CATEGORIES;
    if (
      productToEdit?.category &&
      !base.some(c => c.toLowerCase() === productToEdit.category.toLowerCase())
    ) {
      return [...base, productToEdit.category];
    }
    return base;
  }, [categories, productToEdit]);

  const [name, setName] = useState(productToEdit?.name || '');
  const [category, setCategory] = useState(
    productToEdit?.category || availableCategories[0] || 'General FMCG'
  );
  const [isAddingCatInline, setIsAddingCatInline] = useState(false);
  const [newCatInlineDraft, setNewCatInlineDraft] = useState('');
  const [newCatInlineError, setNewCatInlineError] = useState<string | null>(null);
  const [barcode, setBarcode] = useState(productToEdit?.barcode || initialBarcode || '');
  const [pieceBarcode, setPieceBarcode] = useState(productToEdit?.pieceBarcode || '');
  const [scanTargetField, setScanTargetField] = useState<'primary' | 'piece' | null>(null);
  const [enableBundleTier, setEnableBundleTier] = useState<boolean>(
    productToEdit ? hasConfiguredBundleTier(productToEdit) : true
  );
  const [enablePieceTier, setEnablePieceTier] = useState<boolean>(
    productToEdit ? hasConfiguredPieceTier(productToEdit) : true
  );
  const [bundleUnitName, setBundleUnitName] = useState(productToEdit?.bundleUnitName || 'Bundle');
  const [bundlePieces, setBundlePieces] = useState(productToEdit?.bundlePieces?.toString() || '50');
  const [bundlePrice, setBundlePrice] = useState(productToEdit?.bundlePrice?.toString() || '4350');
  const [piecePrice, setPiecePrice] = useState(productToEdit?.piecePrice?.toString() || '80');
  const [stockPieces, setStockPieces] = useState(productToEdit?.stockPieces?.toString() || '100');
  const [lowStockThreshold, setLowStockThreshold] = useState(productToEdit?.lowStockThreshold?.toString() || '10');
  const [emoji, setEmoji] = useState(productToEdit?.emoji || '📦');
  const [isFavorite, setIsFavorite] = useState<boolean>(Boolean(productToEdit?.isFavorite));
  const [formError, setFormError] = useState<string | null>(null);
  
  // Custom image state
  const [imageUrl, setImageUrl] = useState<string>(productToEdit?.imageUrl || '');
  const [imageTab, setImageTab] = useState<'auto' | 'upload' | 'url' | 'emoji'>(
    productToEdit?.imageUrl
      ? productToEdit.imageUrl.startsWith('data:')
        ? 'upload'
        : 'url'
      : 'auto'
  );
  const [urlInput, setUrlInput] = useState<string>(
    productToEdit?.imageUrl && !productToEdit.imageUrl.startsWith('data:') ? productToEdit.imageUrl : ''
  );
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Auto-Fetch Image online search & selection screen state
  const [autoFetchOnName, setAutoFetchOnName] = useState<boolean>(!productToEdit);
  const [imageOrigin, setImageOrigin] = useState<'none' | 'auto' | 'upload' | 'url'>(
    productToEdit?.imageUrl ? 'upload' : 'none'
  );
  const [searchQuery, setSearchQuery] = useState<string>(productToEdit?.name || '');
  const [searchResults, setSearchResults] = useState<ProductImageSearchResult[]>([]);
  const [searchSource, setSearchSource] = useState<string>('');
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastSearchedQuery, setLastSearchedQuery] = useState<string>('');
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [highlightedCandidate, setHighlightedCandidate] =
    useState<ProductImageSearchResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      searchAbortRef.current?.abort();
      return;
    }
    setFormError(null);
    setImageError(null);
    setIsAddingCatInline(false);
    setNewCatInlineDraft('');
    setNewCatInlineError(null);
    setScanTargetField(null);
    setSearchResults([]);
    setSearchSource('');
    setSearchError(null);
    setLastSearchedQuery('');
    setIsSelectionModalOpen(false);
    setHighlightedCandidate(null);
    setSelectedCandidateId(null);

    if (productToEdit) {
      const hasBundle = hasConfiguredBundleTier(productToEdit);
      const hasPiece = hasConfiguredPieceTier(productToEdit) || !hasBundle;
      setName(productToEdit.name || '');
      setSearchQuery(productToEdit.name || '');
      setCategory(productToEdit.category || availableCategories[0] || 'General FMCG');
      setBarcode(productToEdit.barcode || '');
      setPieceBarcode(productToEdit.pieceBarcode || '');
      setEnableBundleTier(hasBundle);
      setEnablePieceTier(hasPiece);
      setBundleUnitName(productToEdit.bundleUnitName || 'Bundle');
      setBundlePieces(String(productToEdit.bundlePieces || (hasBundle ? 12 : 1)));
      setBundlePrice(hasBundle ? String(productToEdit.bundlePrice) : '');
      setPiecePrice(hasPiece ? String(productToEdit.piecePrice) : '');
      setStockPieces(String(productToEdit.stockPieces ?? 0));
      setLowStockThreshold(String(productToEdit.lowStockThreshold ?? 10));
      setEmoji(productToEdit.emoji || '📦');
      setIsFavorite(Boolean(productToEdit.isFavorite));
      setImageUrl(productToEdit.imageUrl || '');
      setAutoFetchOnName(false);
      setImageOrigin(productToEdit.imageUrl ? 'upload' : 'none');
      setImageTab(
        productToEdit.imageUrl
          ? productToEdit.imageUrl.startsWith('data:')
            ? 'upload'
            : 'url'
          : 'auto'
      );
      setUrlInput(
        productToEdit.imageUrl && !productToEdit.imageUrl.startsWith('data:')
          ? productToEdit.imageUrl
          : ''
      );
    } else {
      const draftName = initialDraft?.name?.trim() || '';
      const draftPrice =
        initialDraft?.unitPrice && initialDraft.unitPrice > 0
          ? String(initialDraft.unitPrice)
          : '';
      setName(draftName);
      setSearchQuery(draftName);
      setCategory(availableCategories[0] || 'General FMCG');
      setBarcode(initialBarcode || '');
      setPieceBarcode('');
      setEnableBundleTier(true);
      setEnablePieceTier(true);
      setBundleUnitName('Bundle');
      setBundlePieces('50');
      setBundlePrice(initialDraft?.unitType === 'bundle' && draftPrice ? draftPrice : '4350');
      setPiecePrice(initialDraft?.unitType === 'piece' && draftPrice ? draftPrice : '80');
      setStockPieces('100');
      setLowStockThreshold('10');
      setEmoji('📦');
      setIsFavorite(false);
      setImageUrl('');
      setAutoFetchOnName(true);
      setImageOrigin('none');
      setImageTab('auto');
      setUrlInput('');
    }
  }, [productToEdit, isOpen, initialBarcode, initialDraft]);

  const runImageSearch = React.useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      setSearchError('Enter at least 2 characters of the product name to search.');
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearchingImages(true);
    setSearchError(null);
    setLastSearchedQuery(trimmed);

    try {
      const { results, source } = await searchOnlineProductImages(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(results);
      setSearchSource(source);
      if (results.length > 0) {
        setHighlightedCandidate(prev =>
          prev && results.some(r => r.id === prev.id) ? prev : results[0]
        );
      } else {
        setHighlightedCandidate(null);
        setSearchError(`No product images found for "${trimmed}". Try adjusting keywords.`);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setSearchError(err?.message || 'Unable to fetch online images right now.');
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingImages(false);
      }
    }
  }, []);

  // Automatically search online when a product name is entered
  useEffect(() => {
    if (!isOpen || !autoFetchOnName) return;
    if (imageOrigin === 'upload' || imageOrigin === 'url') return;

    const trimmed = name.trim();
    if (trimmed.length < 3) {
      return;
    }
    if (trimmed.toLowerCase() === lastSearchedQuery.toLowerCase() && searchResults.length > 0) {
      return;
    }

    setSearchQuery(trimmed);
    const timer = setTimeout(() => {
      void runImageSearch(trimmed);
    }, 650);

    return () => clearTimeout(timer);
  }, [
    name,
    isOpen,
    autoFetchOnName,
    imageOrigin,
    lastSearchedQuery,
    searchResults.length,
    runImageSearch,
  ]);

  if (!isOpen) return null;

  // Handle local file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setImageError('Please select a valid image file (PNG, JPG, WebP).');
      return;
    }

    try {
      setIsProcessingImage(true);
      setImageError(null);
      const compressedDataUrl = await compressImageFile(file);
      setImageUrl(compressedDataUrl);
      setImageOrigin('upload');
      setSelectedCandidateId(null);
      soundManager.playMechanicalClick();
    } catch (err) {
      console.error(err);
      setImageError('Error reading image file. Please try another image.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  // Handle URL input
  const handleApplyUrl = () => {
    if (!urlInput.trim()) {
      setImageUrl('');
      setImageOrigin('none');
      return;
    }
    setImageUrl(urlInput.trim());
    setImageOrigin('url');
    setSelectedCandidateId(null);
    setImageError(null);
    soundManager.playMechanicalClick();
  };

  // Pick and cache an online image candidate from Auto-Fetch
  const handlePickOnlineCandidate = async (
    candidate: ProductImageSearchResult,
    closeSelectionScreen = false
  ) => {
    soundManager.playMechanicalClick();
    setHighlightedCandidate(candidate);
    setSelectedCandidateId(candidate.id);
    setImageError(null);
    setIsProcessingImage(true);
    try {
      const cachedOrUrl = await cacheSelectedProductImage(candidate);
      setImageUrl(cachedOrUrl);
      setImageOrigin('auto');
      if (closeSelectionScreen) {
        setIsSelectionModalOpen(false);
      }
    } catch {
      setImageUrl(candidate.thumbnailUrl || candidate.url);
      setImageOrigin('auto');
      if (closeSelectionScreen) {
        setIsSelectionModalOpen(false);
      }
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleOpenSelectionScreen = () => {
    soundManager.playMechanicalClick();
    const effectiveQuery = (searchQuery.trim() || name.trim()).trim();
    if (effectiveQuery && effectiveQuery !== searchQuery.trim()) {
      setSearchQuery(effectiveQuery);
    }
    setIsSelectionModalOpen(true);
    if (
      effectiveQuery.length >= 2 &&
      (searchResults.length === 0 ||
        effectiveQuery.toLowerCase() !== lastSearchedQuery.toLowerCase())
    ) {
      void runImageSearch(effectiveQuery);
    }
  };

  // Remove image
  const handleRemoveImage = () => {
    setImageUrl('');
    setUrlInput('');
    setImageOrigin('none');
    setSelectedCandidateId(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    soundManager.playMechanicalClick();
  };

  const handleToggleUnitTier = (tier: 'bundle' | 'piece') => {
    setFormError(null);
    soundManager.playMechanicalClick();
    if (tier === 'bundle') {
      if (enableBundleTier && !enablePieceTier) return;
      const next = !enableBundleTier;
      setEnableBundleTier(next);
      if (next && (!parseInt(bundlePieces, 10) || parseInt(bundlePieces, 10) <= 1)) {
        setBundlePieces('12');
      }
    } else {
      if (enablePieceTier && !enableBundleTier) return;
      setEnablePieceTier(!enablePieceTier);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return;

    const parsedBundlePrice = enableBundleTier ? Math.max(0, parseFloat(bundlePrice) || 0) : 0;
    const parsedPiecePrice = enablePieceTier ? Math.max(0, parseFloat(piecePrice) || 0) : 0;
    const parsedBundlePieces = enableBundleTier ? Math.max(1, parseInt(bundlePieces, 10) || 1) : 1;

    if (enableBundleTier && parsedBundlePrice <= 0) {
      setFormError(`Please enter a valid ${bundleUnitName.trim() || 'Bundle'} rate greater than ₹0.`);
      return;
    }
    if (enablePieceTier && parsedPiecePrice <= 0) {
      setFormError('Please enter a valid Single Piece rate greater than ₹0.');
      return;
    }
    if (parsedBundlePrice <= 0 && parsedPiecePrice <= 0) {
      setFormError('Configure at least one active selling unit tier.');
      return;
    }

    soundManager.playScannerBeep();

    const product: Product = {
      id: productToEdit?.id || 'prod_' + Date.now(),
      name: name.trim(),
      category,
      barcode: barcode.trim() || undefined,
      pieceBarcode: pieceBarcode.trim() || undefined,
      bundleUnitName: enableBundleTier ? (bundleUnitName.trim() || 'Bundle') : 'Piece',
      bundlePieces: parsedBundlePieces,
      bundlePrice: parsedBundlePrice,
      piecePrice: parsedPiecePrice,
      stockPieces: parseInt(stockPieces, 10) || 0,
      lowStockThreshold: Math.max(1, parseInt(lowStockThreshold) || 10),
      emoji,
      imageUrl: imageUrl.trim() || undefined,
      color: productToEdit?.color || 'from-blue-600 to-indigo-700',
      isFavorite,
    };

    onSaveProduct(product);
    onClose();
  };

  const barcodePreviewBars = barcode.trim() ? buildBarcodeSvgBars(barcode.trim()) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg my-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
              <Package className="w-4 h-4" />
            </span>
            <h3 className="font-bold text-sm text-white">
              {productToEdit ? 'EDIT FMCG PRODUCT' : 'ADD NEW WHOLESALE PRODUCT'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">

          {/* Product Name & Category (First so entering product name auto-fetches image) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="font-bold text-slate-300 block">Product Name *</label>
                <button
                  type="button"
                  onClick={handleOpenSelectionScreen}
                  className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 transition"
                  title="Search online and open image selection screen"
                >
                  {isSearchingImages ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Searching...</span>
                    </>
                  ) : searchResults.length > 0 ? (
                    <>
                      <Globe className="w-3 h-3" />
                      <span>Pick Image ({searchResults.length})</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      <span>Auto-Fetch Image</span>
                    </>
                  )}
                </button>
              </div>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Gold Flake King / Dettol Soap"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-semibold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="font-bold text-slate-300 block">Category *</label>
                {onAddCategory && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setIsAddingCatInline(prev => !prev);
                      setNewCatInlineError(null);
                    }}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{isAddingCatInline ? 'Select Existing' : 'New Category'}</span>
                  </button>
                )}
              </div>

              {isAddingCatInline && onAddCategory ? (
                <div className="space-y-1">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newCatInlineDraft}
                      onChange={e => {
                        setNewCatInlineDraft(e.target.value);
                        setNewCatInlineError(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const res = onAddCategory(newCatInlineDraft);
                          if (!res.ok) {
                            soundManager.playAlertSound();
                            setNewCatInlineError(res.error || 'Invalid category name');
                            return;
                          }
                          soundManager.playCheckoutSuccess();
                          if (res.category) setCategory(res.category);
                          setNewCatInlineDraft('');
                          setIsAddingCatInline(false);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setIsAddingCatInline(false);
                          setNewCatInlineError(null);
                        }
                      }}
                      placeholder="e.g. Dairy & Bakery"
                      className="flex-1 px-2.5 py-2 bg-slate-950 border border-blue-500 rounded-xl text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const res = onAddCategory(newCatInlineDraft);
                        if (!res.ok) {
                          soundManager.playAlertSound();
                          setNewCatInlineError(res.error || 'Invalid category name');
                          return;
                        }
                        soundManager.playCheckoutSuccess();
                        if (res.category) setCategory(res.category);
                        setNewCatInlineDraft('');
                        setIsAddingCatInline(false);
                      }}
                      className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold whitespace-nowrap shrink-0"
                    >
                      Add
                    </button>
                  </div>
                  {newCatInlineError && (
                    <p className="text-[11px] text-rose-400">{newCatInlineError}</p>
                  )}
                </div>
              ) : (
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                >
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* SECTION: PRODUCT IMAGE CONFIGURATION */}
          <div className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                PRODUCT VISUAL / IMAGE
              </label>
              <div className="flex items-center gap-2">
                {searchResults.length > 0 && (
                  <button
                    type="button"
                    onClick={handleOpenSelectionScreen}
                    className="text-[11px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1 font-semibold"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Selection Screen ({searchResults.length})</span>
                  </button>
                )}
                {imageUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove Image
                  </button>
                )}
              </div>
            </div>

            {/* Preview Box & Tabs */}
            <div className="flex items-start gap-3">
              {/* Image Preview Box */}
              <div className="w-20 h-20 rounded-xl bg-slate-900 border border-slate-700 overflow-hidden flex items-center justify-center relative flex-shrink-0 shadow-inner">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={() => {
                      setImageError('Failed to load image. Reverting to emoji.');
                      setImageUrl('');
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-3xl">
                    <span>{emoji}</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase mt-1">Emoji</span>
                  </div>
                )}
                {isProcessingImage && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-[10px] text-white gap-1">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    <span>Saving...</span>
                  </div>
                )}
              </div>

              {/* Mode Selector Tabs */}
              <div className="flex-1 space-y-2 min-w-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[10.5px] font-semibold gap-0.5">
                  <button
                    type="button"
                    onClick={() => setImageTab('auto')}
                    className={`py-1 px-1.5 rounded-md transition flex items-center justify-center gap-1 ${
                      imageTab === 'auto'
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">Auto-Fetch</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageTab('upload')}
                    className={`py-1 px-1.5 rounded-md transition flex items-center justify-center gap-1 ${
                      imageTab === 'upload'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Upload className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">Upload</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageTab('url')}
                    className={`py-1 px-1.5 rounded-md transition flex items-center justify-center gap-1 ${
                      imageTab === 'url'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <LinkIcon className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">URL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageTab('emoji')}
                    className={`py-1 px-1.5 rounded-md transition flex items-center justify-center gap-1 ${
                      imageTab === 'emoji'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smile className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">Emoji</span>
                  </button>
                </div>

                {/* TAB 0: AUTO-FETCH ONLINE IMAGE */}
                {imageTab === 'auto' && (
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            void runImageSearch(searchQuery || name);
                          }
                        }}
                        placeholder="Search online product images..."
                        className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        type="button"
                        disabled={isSearchingImages}
                        onClick={() => void runImageSearch(searchQuery || name)}
                        className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-bold rounded-lg transition flex items-center gap-1 whitespace-nowrap"
                      >
                        {isSearchingImages ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Search className="w-3 h-3" />
                        )}
                        <span>Fetch</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoFetchOnName}
                          onChange={e => setAutoFetchOnName(e.target.checked)}
                          className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-0"
                        />
                        <span>Auto-search when Product Name is entered</span>
                      </label>
                      {searchResults.length > 0 && (
                        <button
                          type="button"
                          onClick={handleOpenSelectionScreen}
                          className="text-cyan-300 hover:text-cyan-200 font-bold underline whitespace-nowrap"
                        >
                          Open Picker ({searchResults.length})
                        </button>
                      )}
                    </div>

                    {isSearchingImages && searchResults.length === 0 && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {[0, 1, 2, 3].map(idx => (
                          <div
                            key={idx}
                            className="aspect-square rounded-lg bg-slate-800/80 border border-slate-700/60 animate-pulse"
                          />
                        ))}
                      </div>
                    )}

                    {searchResults.length > 0 && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {searchResults.slice(0, 4).map(candidate => {
                          const isSelected = selectedCandidateId === candidate.id;
                          return (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => void handlePickOnlineCandidate(candidate, false)}
                              title={candidate.title}
                              className={`group relative aspect-square rounded-lg bg-white overflow-hidden border-2 transition ${
                                isSelected
                                  ? 'border-cyan-400 ring-2 ring-cyan-500/40'
                                  : 'border-slate-700 hover:border-blue-400'
                              }`}
                            >
                              <img
                                src={candidate.thumbnailUrl || candidate.url}
                                alt={candidate.title}
                                className="w-full h-full object-contain p-0.5"
                                loading="lazy"
                              />
                              {isSelected && (
                                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow">
                                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {searchError && (
                      <p className="text-[10.5px] text-amber-300 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span>{searchError}</span>
                      </p>
                    )}

                    {!isSearchingImages && searchResults.length === 0 && !searchError && (
                      <p className="text-[10px] text-slate-500">
                        Type a product name above to automatically fetch product photos online.
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 1: FILE UPLOAD */}
                {imageTab === 'upload' && (
                  <div className="space-y-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="product-image-upload"
                    />
                    <label
                      htmlFor="product-image-upload"
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-600 text-blue-300 font-semibold cursor-pointer transition active:scale-95"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{imageUrl && imageUrl.startsWith('data:') ? 'Change Uploaded Photo' : 'Choose Photo from Device'}</span>
                    </label>
                    <p className="text-[10px] text-slate-500">
                      Supports JPG, PNG, WebP (auto-optimized for mobile offline storage).
                    </p>
                  </div>
                )}

                {/* TAB 2: IMAGE URL */}
                {imageTab === 'url' && (
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://example.com/product.jpg"
                        className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-[11px] focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={handleApplyUrl}
                        className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition"
                      >
                        Apply
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Paste any direct image link from the web.
                    </p>
                  </div>
                )}

                {/* TAB 3: EMOJI ICON */}
                {imageTab === 'emoji' && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-slate-900 rounded-lg border border-slate-800">
                      {EMOJI_OPTIONS.map(em => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => {
                            setEmoji(em);
                            setImageUrl(''); // Clear custom image when emoji picked
                            setImageOrigin('none');
                            setSelectedCandidateId(null);
                            soundManager.playMechanicalClick();
                          }}
                          className={`w-7 h-7 flex items-center justify-center text-base rounded-md transition ${
                            emoji === em && !imageUrl
                              ? 'bg-blue-600 shadow ring-1 ring-white'
                              : 'hover:bg-slate-800'
                          }`}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {imageError && (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3 h-3" />
                    {imageError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Multi-Unit Configuration Box */}
          <div className="p-3 bg-slate-950/80 border border-blue-500/30 rounded-xl space-y-3">
            <div className="font-bold text-blue-400 text-xs flex items-center justify-between gap-2">
              <span>CONFIGURED UNIT PRICE TIERS</span>
              <span className="text-[10px] text-slate-400">
                Only active tiers render in POS
              </span>
            </div>

            {/* Active Tier Selectors */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleToggleUnitTier('bundle')}
                className={`py-2 px-2.5 rounded-lg border text-left flex items-center justify-between transition ${
                  enableBundleTier
                    ? 'bg-blue-600/20 border-blue-500/60 text-blue-200'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="font-bold text-[11px]">Bulk Unit Tier</span>
                <span className={`w-4 h-4 rounded flex items-center justify-center ${enableBundleTier ? 'bg-blue-500 text-white' : 'bg-slate-800 border border-slate-700'}`}>
                  {enableBundleTier && <Check className="w-3 h-3" />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleUnitTier('piece')}
                className={`py-2 px-2.5 rounded-lg border text-left flex items-center justify-between transition ${
                  enablePieceTier
                    ? 'bg-amber-600/20 border-amber-500/60 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="font-bold text-[11px]">Single Piece Tier</span>
                <span className={`w-4 h-4 rounded flex items-center justify-center ${enablePieceTier ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 border border-slate-700'}`}>
                  {enablePieceTier && <Check className="w-3 h-3" />}
                </span>
              </button>
            </div>

            {/* Bulk Unit Specs (shown only when Bulk tier enabled) */}
            {enableBundleTier && (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-slate-400 block mb-1">Bulk Unit Name</label>
                  <input
                    type="text"
                    required={enableBundleTier}
                    value={bundleUnitName}
                    onChange={e => setBundleUnitName(e.target.value)}
                    placeholder="Bundle, Peti, Carton..."
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Pieces per {bundleUnitName || 'Bundle'}</label>
                  <input
                    type="number"
                    required={enableBundleTier}
                    min={enablePieceTier ? '2' : '1'}
                    value={bundlePieces}
                    onChange={e => setBundlePieces(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-bold"
                  />
                </div>
              </div>
            )}

            {/* Dynamic Rates Grid */}
            <div className={`grid ${enableBundleTier && enablePieceTier ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5 pt-1`}>
              {enableBundleTier && (
                <div>
                  <label className="text-emerald-400 font-bold block mb-1">
                    {bundleUnitName || 'Bundle'} Rate (₹) *
                  </label>
                  <input
                    type="number"
                    required={enableBundleTier}
                    min="0.01"
                    step="any"
                    value={bundlePrice}
                    onChange={e => setBundlePrice(e.target.value)}
                    placeholder="e.g. 4350"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-bold text-sm"
                  />
                </div>
              )}

              {enablePieceTier && (
                <div>
                  <label className="text-amber-400 font-bold block mb-1">
                    Single Piece Rate (₹) *
                  </label>
                  <input
                    type="number"
                    required={enablePieceTier}
                    min="0.01"
                    step="any"
                    value={piecePrice}
                    onChange={e => setPiecePrice(e.target.value)}
                    placeholder="e.g. 80"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-bold text-sm"
                  />
                </div>
              )}
            </div>

            {formError && (
              <p className="text-[11px] text-rose-400 flex items-center gap-1 font-semibold">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {formError}
              </p>
            )}
          </div>

          {/* Stock & Low Stock Threshold */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-slate-300 font-bold block mb-1">Current Stock (Total Pcs) *</label>
              <input
                type="number"
                required
                value={stockPieces}
                onChange={e => setStockPieces(e.target.value)}
                placeholder="Total loose pieces (can be negative)"
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-bold"
              />
              {enableBundleTier && (parseInt(bundlePieces, 10) || 1) > 1 && (
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  ≈ {Math.trunc((parseInt(stockPieces, 10) || 0) / (parseInt(bundlePieces, 10) || 1))} {bundleUnitName || 'Bundle'}s
                </span>
              )}
            </div>

            <div>
              <label className="text-rose-400 font-bold block mb-1">
                Low Stock Alert Below (Pcs)
              </label>
              <input
                type="number"
                required
                min="1"
                value={lowStockThreshold}
                onChange={e => setLowStockThreshold(e.target.value)}
                placeholder="Default 10 pcs"
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-bold"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Triggers warning badge
              </span>
            </div>
          </div>

          {/* Barcodes (Primary/Bulk & Optional Loose Piece) + Favorite Pin */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <ScanBarcode className="w-3.5 h-3.5 text-blue-400" />
                BARCODE CONFIGURATION
              </span>
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setBarcode(generateEan13Barcode(products));
                }}
                className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Generate EAN-13</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-slate-400 block">
                  {enableBundleTier ? 'Primary / Carton Barcode' : 'Product Barcode / SKU'}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    placeholder="e.g. 8901234001"
                    className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => setScanTargetField('primary')}
                    className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-300 flex items-center gap-1 whitespace-nowrap"
                    title="Capture barcode with camera or USB scanner"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Scan</span>
                  </button>
                </div>
              </div>

              {enableBundleTier && enablePieceTier ? (
                <div className="space-y-1">
                  <label className="text-slate-400 block">
                    Loose Piece Barcode (Optional)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={pieceBarcode}
                      onChange={e => setPieceBarcode(e.target.value)}
                      placeholder="Separate retail piece code"
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setScanTargetField('piece')}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 flex items-center gap-1 whitespace-nowrap"
                      title="Capture loose piece barcode"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setIsFavorite(prev => !prev);
                    }}
                    className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition ${
                      isFavorite
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                      <span>Pin to Favorite Items</span>
                    </span>
                    <span className="text-[10px] font-bold uppercase">
                      {isFavorite ? 'Pinned' : 'Off'}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {enableBundleTier && enablePieceTier && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setIsFavorite(prev => !prev);
                }}
                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition ${
                  isFavorite
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                  <span>Pin to Favorite Items</span>
                </span>
                <span className="text-[10px] font-bold uppercase">
                  {isFavorite ? 'Pinned' : 'Off'}
                </span>
              </button>
            )}

            {barcodePreviewBars && (
              <div className="pt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <svg
                  viewBox={`0 0 ${barcodePreviewBars.totalWidth} 22`}
                  className="h-6 w-32 text-slate-200"
                  aria-hidden="true"
                >
                  {barcodePreviewBars.bars.map((b, i) => (
                    <rect key={i} x={b.x} y={0} width={b.w} height={22} fill="currentColor" />
                  ))}
                </svg>
                <span className="font-mono text-slate-300 tabular-nums">{barcode.trim()}</span>
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/40 transition active:scale-95"
            >
              {productToEdit ? 'Update Product' : 'Add to Inventory'}
            </button>
          </div>
        </form>

      </div>

      <CameraBarcodeModal
        isOpen={scanTargetField !== null}
        onClose={() => setScanTargetField(null)}
        title={scanTargetField === 'piece' ? 'Scan Loose Piece Barcode' : 'Scan Product / Carton Barcode'}
        subtitle="Capture barcode directly into this product SKU field"
        mode="single"
        onScanCode={code => {
          if (scanTargetField === 'piece') {
            setPieceBarcode(code.trim());
          } else {
            setBarcode(code.trim());
          }
          setScanTargetField(null);
          return { ok: true, message: `Assigned barcode ${code.trim()}` };
        }}
      />

      {/* Dedicated Auto-Fetch Online Image Selection Screen */}
      {isSelectionModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            {/* Selection Modal Header */}
            <div className="px-4 sm:px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 flex-shrink-0">
                  <Globe className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white truncate">
                    Select Product Image Online
                  </h4>
                  <p className="text-[11px] text-slate-400 truncate">
                    {searchSource
                      ? `${searchSource} · Pick the clearest product pack shot`
                      : 'Search online and pick the best photo for this product'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSelectionModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                aria-label="Close image selection screen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input Bar */}
            <div className="px-4 sm:px-5 py-3 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runImageSearch(searchQuery);
                    }
                  }}
                  placeholder="Search product brand, size or pack (e.g. Parle-G Gold 1kg)"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="button"
                disabled={isSearchingImages}
                onClick={() => void runImageSearch(searchQuery)}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition"
              >
                {isSearchingImages ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Search</span>
                  </>
                )}
              </button>
            </div>

            {/* Image Results Gallery */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 bg-slate-950/60">
              {isSearchingImages && searchResults.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl bg-slate-900 border border-slate-800 p-2 space-y-2 animate-pulse"
                    >
                      <div className="aspect-square rounded-lg bg-slate-800" />
                      <div className="h-3 bg-slate-800 rounded w-3/4" />
                      <div className="h-2.5 bg-slate-800 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : searchResults.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {searchResults.map(candidate => {
                    const isHighlighted = highlightedCandidate?.id === candidate.id;
                    const isApplied = selectedCandidateId === candidate.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setHighlightedCandidate(candidate);
                        }}
                        onDoubleClick={() => void handlePickOnlineCandidate(candidate, true)}
                        className={`group text-left rounded-xl p-2 border transition flex flex-col gap-2 ${
                          isHighlighted
                            ? 'bg-cyan-950/40 border-cyan-400 ring-2 ring-cyan-500/35'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div className="relative aspect-square w-full rounded-lg bg-white overflow-hidden border border-slate-200/20 flex items-center justify-center">
                          <img
                            src={candidate.thumbnailUrl || candidate.url}
                            alt={candidate.title}
                            className="w-full h-full object-contain p-1.5"
                            loading="lazy"
                          />
                          {(isHighlighted || isApplied) && (
                            <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-[11px] font-semibold text-slate-100 line-clamp-2 leading-snug">
                            {candidate.title}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {candidate.source}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center space-y-2">
                  <Globe className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-300">
                    {searchError || 'Enter a product name above and click Search.'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Tip: Include pack weight or brand (e.g. &ldquo;Tata Tea Gold 250g&rdquo;) for sharper matches.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="px-4 sm:px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-slate-400 truncate max-w-xs">
                {highlightedCandidate
                  ? `Selected: ${highlightedCandidate.title}`
                  : 'Click an image above to preview & apply'}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsSelectionModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!highlightedCandidate || isProcessingImage}
                  onClick={() => {
                    if (highlightedCandidate) {
                      void handlePickOnlineCandidate(highlightedCandidate, true);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-900/30 transition"
                >
                  {isProcessingImage ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Applying Image...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Use Selected Image</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
