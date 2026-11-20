import React, { useMemo, useState } from 'react';
import {
  Bill,
  Customer,
  Product,
  ReceiptSettings,
  UnitType,
  WhatsAppAutomationConfig,
  WhatsAppInboundMessage,
  WhatsAppMessageIntent,
  WhatsAppParsedItem,
} from '../types';
import { formatCurrency, formatStockDisplay } from '../utils/formatters';
import { getEffectiveUnitPrice } from '../utils/customerPricing';
import {
  buildAutoReplyForMessage,
  buildWhatsAppWebUrl,
  evaluateWhatsAppItemsAgainstInventory,
  findCustomerByPhone,
} from '../utils/whatsappAutomation';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Inbox,
  Link2,
  MessageSquare,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Trash2,
  UserPlus,
  Webhook,
  X,
} from 'lucide-react';

interface WhatsAppAutomationPanelProps {
  messages: WhatsAppInboundMessage[];
  config: WhatsAppAutomationConfig;
  products: Product[];
  customers: Customer[];
  bills: Bill[];
  receiptSettings: ReceiptSettings;
  storeName: string;
  hasServerAccessToken: boolean;
  isSyncingServer: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onOpenSettings: () => void;
  onRefreshFromServer: () => void;
  onReceiveInboundMessage: (params: {
    senderName: string;
    senderPhone: string;
    messageText: string;
    source: 'simulator' | 'manual';
  }) => Promise<WhatsAppInboundMessage | null>;
  onUpdateMessageItems: (messageId: string, items: WhatsAppParsedItem[]) => void;
  onConfirmAndBillOrder: (
    messageId: string,
    paymentMode: 'cash' | 'credit',
    deductStock: boolean
  ) => void;
  onSendReply: (messageId: string, replyText: string) => Promise<{
    deliveryMode: string;
    whatsappWebUrl: string;
  } | null>;
  onLoadOrderToCart: (messageId: string) => void;
  onIgnoreMessage: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onAddNewCustomer: (name: string, phone: string) => Customer;
  onViewBillReceipt: (bill: Bill) => void;
}

type InboxFilter = 'all' | 'orders' | 'inquiries' | 'processed';

const QUICK_TEST_TEMPLATES = [
  {
    label: 'Bulk Order (Ramesh Kirana)',
    senderName: 'Ramesh Kirana Store',
    senderPhone: '9876543210',
    messageText: 'Bhaiya 2 Bundle Gold Flake King aur 2 Carton Parle-G bhej do aaj',
  },
  {
    label: 'Rate & Stock Inquiry',
    senderName: 'Suresh Kirana',
    senderPhone: '9988776655',
    messageText: 'Surf Excel aur Fortune Mustard Oil ka kya rate hai aur kitna stock available hai?',
  },
  {
    label: 'Low Stock Check Order',
    senderName: 'Ali Tea & Pan Stall',
    senderPhone: '9712345678',
    messageText: 'Please send 1 Bundle Flake Blue and 1 Carton Tata Tea Gold',
  },
  {
    label: 'Khata Balance Inquiry',
    senderName: 'Gupta General Store',
    senderPhone: '9823456789',
    messageText: 'Mera pending udhar khata balance kitna baki hai?',
  },
];

export const WhatsAppAutomationPanel: React.FC<WhatsAppAutomationPanelProps> = ({
  messages,
  config,
  products,
  customers,
  bills,
  storeName,
  hasServerAccessToken,
  isSyncingServer,
  onToggleEnabled,
  onOpenSettings,
  onRefreshFromServer,
  onReceiveInboundMessage,
  onUpdateMessageItems,
  onConfirmAndBillOrder,
  onSendReply,
  onLoadOrderToCart,
  onIgnoreMessage,
  onDeleteMessage,
  onAddNewCustomer,
  onViewBillReceipt,
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(messages[0]?.id || '');
  const [paymentModeChoice, setPaymentModeChoice] = useState<'cash' | 'credit'>(
    config.defaultOrderPaymentMode || 'credit'
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingReplyId, setSendingReplyId] = useState<string | null>(null);
  const [lastDispatchLinks, setLastDispatchLinks] = useState<
    Record<string, { mode: string; url: string }>
  >({});
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerName, setComposerName] = useState('');
  const [composerPhone, setComposerPhone] = useState('');
  const [composerText, setComposerText] = useState('');
  const [isParsingInbound, setIsParsingInbound] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showWebhookDocs, setShowWebhookDocs] = useState(false);

  const selectedMessage = useMemo(
    () => messages.find(m => m.id === selectedId) || messages[0] || null,
    [messages, selectedId]
  );

  const stats = useMemo(() => {
    const pendingOrders = messages.filter(
      m =>
        m.intent === 'order' &&
        (m.status === 'pending_review' || m.status === 'insufficient_stock')
    ).length;
    const pendingInquiries = messages.filter(
      m => m.intent === 'inquiry' && m.status === 'pending_review'
    ).length;
    const stockSyncedOrders = messages.filter(m => m.stockUpdated).length;
    const totalBilledValue = messages
      .filter(m => m.status === 'billed' || m.status === 'auto_processed')
      .reduce((s, m) => s + m.estimatedTotal, 0);
    return {
      pendingOrders,
      pendingInquiries,
      stockSyncedOrders,
      totalBilledValue,
    };
  }, [messages]);

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return messages.filter(msg => {
      if (filter === 'orders' && msg.intent !== 'order') return false;
      if (filter === 'inquiries' && msg.intent !== 'inquiry') return false;
      if (
        filter === 'processed' &&
        msg.status !== 'billed' &&
        msg.status !== 'auto_processed' &&
        msg.status !== 'replied'
      ) {
        return false;
      }
      if (!q) return true;
      return (
        msg.senderName.toLowerCase().includes(q) ||
        msg.senderPhone.toLowerCase().includes(q) ||
        msg.messageText.toLowerCase().includes(q) ||
        msg.parsedItems.some(i => i.matchedProductName.toLowerCase().includes(q))
      );
    });
  }, [messages, filter, searchQuery]);

  const selectedCustomer = useMemo(() => {
    if (!selectedMessage) return null;
    if (selectedMessage.customerId) {
      const byId = customers.find(c => c.id === selectedMessage.customerId);
      if (byId) return byId;
    }
    return findCustomerByPhone(customers, selectedMessage.senderPhone);
  }, [selectedMessage, customers]);

  const liveEvaluatedItems = useMemo(() => {
    if (!selectedMessage) return [];
    return evaluateWhatsAppItemsAgainstInventory(
      selectedMessage.parsedItems,
      products,
      selectedCustomer
    );
  }, [selectedMessage, products, selectedCustomer]);

  const liveTotal = useMemo(
    () =>
      Math.round(
        liveEvaluatedItems
          .filter(i => i.matchedProductId !== 'UNMATCHED')
          .reduce((s, i) => s + i.lineTotal, 0) * 100
      ) / 100,
    [liveEvaluatedItems]
  );

  const hasStockShortage = liveEvaluatedItems.some(
    i => i.matchedProductId !== 'UNMATCHED' && !i.stockSufficient
  );

  const linkedBill = useMemo(() => {
    if (!selectedMessage?.linkedBillId) return null;
    return bills.find(b => b.id === selectedMessage.linkedBillId) || null;
  }, [selectedMessage, bills]);

  const activeReplyText = selectedMessage
    ? replyDrafts[selectedMessage.id] ??
      selectedMessage.replyText ??
      buildAutoReplyForMessage({
        intent: selectedMessage.intent,
        senderName: selectedMessage.senderName,
        parsedItems: liveEvaluatedItems,
        customer: selectedCustomer,
        products,
        storeName,
        messageText: selectedMessage.messageText,
      })
    : '';

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '/api/whatsapp/webhook';

  const handleCopyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl).catch(() => {});
    soundManager.playMechanicalClick();
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleItemQtyChange = (itemId: string, nextQty: number) => {
    if (!selectedMessage) return;
    const safeQty = Math.max(1, Math.round(nextQty || 1));
    const nextItems = liveEvaluatedItems.map(item =>
      item.id === itemId ? { ...item, quantity: safeQty } : item
    );
    onUpdateMessageItems(
      selectedMessage.id,
      evaluateWhatsAppItemsAgainstInventory(nextItems, products, selectedCustomer)
    );
  };

  const handleItemUnitToggle = (itemId: string) => {
    if (!selectedMessage) return;
    const nextItems = liveEvaluatedItems.map(item => {
      if (item.id !== itemId) return item;
      const prod = products.find(p => p.id === item.matchedProductId);
      if (!prod) return item;
      const nextUnit: UnitType = item.unit === 'bundle' && prod.piecePrice > 0 ? 'piece' : 'bundle';
      return { ...item, unit: nextUnit };
    });
    onUpdateMessageItems(
      selectedMessage.id,
      evaluateWhatsAppItemsAgainstInventory(nextItems, products, selectedCustomer)
    );
  };

  const handleItemProductChange = (itemId: string, productId: string) => {
    if (!selectedMessage) return;
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    const nextItems = liveEvaluatedItems.map(item => {
      if (item.id !== itemId) return item;
      const eff = getEffectiveUnitPrice(prod, item.unit, selectedCustomer);
      return {
        ...item,
        matchedProductId: prod.id,
        matchedProductName: prod.name,
        bundleUnitName: prod.bundleUnitName,
        bundlePieces: prod.bundlePieces,
        unitPrice: eff.unitPrice,
      };
    });
    onUpdateMessageItems(
      selectedMessage.id,
      evaluateWhatsAppItemsAgainstInventory(nextItems, products, selectedCustomer)
    );
  };

  const handleRemoveParsedItem = (itemId: string) => {
    if (!selectedMessage) return;
    onUpdateMessageItems(
      selectedMessage.id,
      liveEvaluatedItems.filter(i => i.id !== itemId)
    );
  };

  const handleAddCatalogItemRow = () => {
    if (!selectedMessage || products.length === 0) return;
    const firstProd = products[0];
    const unit = firstProd.bundlePrice > 0 ? 'bundle' : 'piece';
    const eff = getEffectiveUnitPrice(firstProd, unit, selectedCustomer);
    const pcs = unit === 'bundle' ? firstProd.bundlePieces : 1;
    const newRow: WhatsAppParsedItem = {
      id: `wa_row_${Date.now()}`,
      rawText: 'Manual POS match',
      matchedProductId: firstProd.id,
      matchedProductName: firstProd.name,
      unit,
      bundleUnitName: firstProd.bundleUnitName,
      bundlePieces: firstProd.bundlePieces,
      quantity: 1,
      unitPrice: eff.unitPrice,
      totalPieces: pcs,
      lineTotal: eff.unitPrice,
      availablePieces: firstProd.stockPieces,
      stockSufficient: firstProd.stockPieces >= pcs,
      confidence: 1,
    };
    onUpdateMessageItems(selectedMessage.id, [...liveEvaluatedItems, newRow]);
  };

  const handleSubmitSimulatedMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposerError(null);
    if (!composerText.trim()) {
      setComposerError('Please enter a customer WhatsApp message.');
      return;
    }
    if (!config.enabled) {
      setComposerError('Enable WhatsApp Automation first to receive and process messages.');
      return;
    }

    setIsParsingInbound(true);
    try {
      const created = await onReceiveInboundMessage({
        senderName: composerName.trim() || 'WhatsApp Customer',
        senderPhone: composerPhone.trim() || '9876543210',
        messageText: composerText.trim(),
        source: 'simulator',
      });
      if (created) {
        soundManager.playScannerBeep();
        setSelectedId(created.id);
        setIsComposerOpen(false);
        setComposerText('');
      }
    } catch (err: any) {
      setComposerError(err?.message || 'Failed to parse WhatsApp message.');
    } finally {
      setIsParsingInbound(false);
    }
  };

  const handleDispatchReply = async () => {
    if (!selectedMessage || !activeReplyText.trim()) return;
    setSendingReplyId(selectedMessage.id);
    try {
      const result = await onSendReply(selectedMessage.id, activeReplyText.trim());
      if (result) {
        soundManager.playCheckoutSuccess();
        setLastDispatchLinks(prev => ({
          ...prev,
          [selectedMessage.id]: {
            mode: result.deliveryMode,
            url: result.whatsappWebUrl,
          },
        }));
      }
    } finally {
      setSendingReplyId(null);
    }
  };

  const getIntentBadge = (intent: WhatsAppMessageIntent) => {
    switch (intent) {
      case 'order':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'inquiry':
        return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      case 'payment':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStatusLabel = (msg: WhatsAppInboundMessage) => {
    switch (msg.status) {
      case 'billed':
      case 'auto_processed':
        return {
          text: msg.stockUpdated ? 'Billed & Stock Synced' : 'Billed',
          cls: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40',
        };
      case 'replied':
        return {
          text: 'Replied',
          cls: 'bg-blue-600/20 text-blue-300 border-blue-500/40',
        };
      case 'insufficient_stock':
        return {
          text: 'Low Stock Review',
          cls: 'bg-rose-600/20 text-rose-300 border-rose-500/40',
        };
      case 'ignored':
        return {
          text: 'Archived',
          cls: 'bg-slate-800 text-slate-400 border-slate-700',
        };
      default:
        return {
          text: 'Pending Action',
          cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        };
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100 p-3 sm:p-5">
      <div className="w-full max-w-none m-0 space-y-4 pb-10">
        {/* Top Control Bar */}
        <div
          className={`bg-slate-900 border border-slate-800 rounded-xl p-4 flex ${
            isDesktopLayout ? 'flex-row items-center' : 'flex-col'
          } justify-between gap-3`}
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white tracking-wide">
                  WhatsApp Business Orders &amp; Inquiries
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                    config.enabled
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {config.enabled ? 'Automation Active' : 'Automation Paused'}
                </span>
                {config.autoConfirmOrders && config.enabled && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-300 border border-blue-500/30">
                    Auto-Bill + Stock Sync
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Receive customer WhatsApp orders and rate/stock inquiries, deduct inventory automatically, and sync bills to POS &amp; Khata.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Master Enable/Disable Switch synced with Settings */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
              <span className="text-[11px] font-bold text-slate-300">Integration</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                aria-label="Enable or disable WhatsApp automation integration"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onToggleEnabled(!config.enabled);
                }}
                className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  config.enabled
                    ? 'bg-emerald-600 border-emerald-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    config.enabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onRefreshFromServer();
              }}
              disabled={isSyncingServer}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingServer ? 'animate-spin' : ''}`} />
              Sync Webhook
            </button>

            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenSettings();
              }}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              Settings
            </button>

            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                setComposerError(null);
                setIsComposerOpen(true);
              }}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 transition whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Receive WhatsApp Message
            </button>
          </div>
        </div>

        {/* Disabled Notice */}
        {!config.enabled && (
          <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-black text-amber-200">
                  WhatsApp Business Automation is Currently Disabled
                </div>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Inbound webhook orders, automated stock deductions, and inquiry auto-replies are paused. Toggle automation on to resume live POS syncing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                soundManager.playCheckoutSuccess();
                onToggleEnabled(true);
              }}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black whitespace-nowrap self-start sm:self-auto"
            >
              Enable Automation
            </button>
          </div>
        )}

        {/* Metrics Summary Row */}
        <div
          className={`grid ${
            isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
          } gap-3`}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold text-slate-400">Pending Orders</div>
            <div className="text-xl font-black text-white mt-1 tabular-nums">
              {stats.pendingOrders}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Awaiting confirmation / stock check</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold text-slate-400">Open Inquiries</div>
            <div className="text-xl font-black text-sky-300 mt-1 tabular-nums">
              {stats.pendingInquiries}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Rate, stock &amp; Khata balance asks</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold text-slate-400">Stock-Synced Orders</div>
            <div className="text-xl font-black text-emerald-400 mt-1 tabular-nums">
              {stats.stockSyncedOrders}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Inventory deducted &amp; billed</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold text-slate-400">WhatsApp Billed Value</div>
            <div className="text-xl font-black text-white mt-1 tabular-nums font-mono">
              {formatCurrency(stats.totalBilledValue)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Synced into POS reports</div>
          </div>
        </div>

        {/* Main 2-Column Workspace */}
        <div className={`grid ${isDesktopLayout ? 'grid-cols-12' : 'grid-cols-1'} gap-4 items-start`}>
          {/* Left Column: Customer Thread Queue */}
          <div
            className={`${
              isDesktopLayout ? 'col-span-5' : ''
            } bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col`}
          >
            <div className="p-3 border-b border-slate-800 space-y-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    { id: 'all', label: `All (${messages.length})` },
                    {
                      id: 'orders',
                      label: `Orders (${messages.filter(m => m.intent === 'order').length})`,
                    },
                    {
                      id: 'inquiries',
                      label: `Inquiries (${messages.filter(m => m.intent === 'inquiry').length})`,
                    },
                    {
                      id: 'processed',
                      label: 'Completed',
                    },
                  ] as Array<{ id: InboxFilter; label: string }>
                ).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition ${
                      filter === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search customer, phone, or SKU..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-800/80 max-h-[560px] overflow-y-auto">
              {filteredMessages.length === 0 ? (
                <div className="p-8 text-center space-y-2.5">
                  <Inbox className="w-8 h-8 text-slate-600 mx-auto" />
                  <div className="text-xs font-bold text-slate-300">
                    No WhatsApp messages in this view
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Simulate an inbound customer order or connect your Meta Cloud API webhook to receive live orders.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsComposerOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                  >
                    Receive Test Order
                  </button>
                </div>
              ) : (
                filteredMessages.map(msg => {
                  const statusBadge = getStatusLabel(msg);
                  const isActive = selectedMessage?.id === msg.id;
                  return (
                    <button
                      key={msg.id}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setSelectedId(msg.id);
                      }}
                      className={`w-full text-left p-3.5 transition hover:bg-slate-800/50 ${
                        isActive ? 'bg-slate-800/70' : 'bg-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white truncate">
                              {msg.senderName}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border ${getIntentBadge(
                                msg.intent
                              )}`}
                            >
                              {msg.intent}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                            {msg.senderPhone} · {msg.formattedTime}
                          </div>
                        </div>

                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border whitespace-nowrap ${statusBadge.cls}`}
                        >
                          {statusBadge.text}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300 mt-2 line-clamp-2 leading-snug">
                        &ldquo;{msg.messageText}&rdquo;
                      </p>

                      {msg.parsedItems.length > 0 && (
                        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                          <span>
                            {msg.parsedItems.length} item(s) matched
                          </span>
                          <span className="font-mono font-bold text-slate-200 tabular-nums">
                            Est. {formatCurrency(msg.estimatedTotal)}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Order Parsing, Stock Check, POS Billing & Reply Workbench */}
          <div className={`${isDesktopLayout ? 'col-span-7' : ''} bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4`}>
            {!selectedMessage ? (
              <div className="py-16 text-center space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300">Select a WhatsApp Thread</div>
                <p className="text-xs text-slate-500">
                  Choose an inbound customer message on the left to inspect matched SKUs, verify stock, generate a POS bill, or reply.
                </p>
              </div>
            ) : (
              <>
                {/* Customer Header & Quick Meta */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm sm:text-base font-black text-white">
                        {selectedMessage.senderName}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getIntentBadge(
                          selectedMessage.intent
                        )}`}
                      >
                        {selectedMessage.intent}
                      </span>
                      {selectedCustomer ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                          Khata Linked · Due {formatCurrency(selectedCustomer.currentBalance)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playMechanicalClick();
                            onAddNewCustomer(
                              selectedMessage.senderName,
                              selectedMessage.senderPhone
                            );
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1"
                        >
                          <UserPlus className="w-3 h-3 text-blue-400" />
                          Save Customer
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                      Phone: {selectedMessage.senderPhone} · Received {selectedMessage.formattedTime} · Source: {selectedMessage.source.toUpperCase()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {selectedMessage.status === 'pending_review' && (
                      <button
                        type="button"
                        onClick={() => onIgnoreMessage(selectedMessage.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteMessage(selectedMessage.id)}
                      className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 transition"
                      title="Delete message"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Original Inbound Message Box */}
                <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Inbound Customer Message
                  </div>
                  <p className="text-xs sm:text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {selectedMessage.messageText}
                  </p>
                </div>

                {/* Linked POS Bill Banner (when already billed) */}
                {(selectedMessage.status === 'billed' ||
                  selectedMessage.status === 'auto_processed') && (
                  <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold text-emerald-200">
                          POS Bill #{selectedMessage.linkedBillNumber} Generated
                          {selectedMessage.stockUpdated ? ' · Inventory Deducted' : ''}
                        </div>
                        <div className="text-[11px] text-emerald-300/80">
                          {selectedMessage.processingNote ||
                            'Order synced into POS Sales History, Inventory & Staff Logs.'}
                        </div>
                      </div>
                    </div>
                    {linkedBill && (
                      <button
                        type="button"
                        onClick={() => onViewBillReceipt(linkedBill)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        View Receipt
                      </button>
                    )}
                  </div>
                )}

                {/* Matched Catalog Items & Stock Sync Table */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                      <PackageCheck className="w-4 h-4 text-emerald-400" />
                      Matched POS Catalog Items &amp; Live Stock Check
                    </div>
                    {selectedMessage.status !== 'billed' &&
                      selectedMessage.status !== 'auto_processed' && (
                        <button
                          type="button"
                          onClick={handleAddCatalogItemRow}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[11px] font-bold flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Add SKU Row
                        </button>
                      )}
                  </div>

                  {liveEvaluatedItems.length === 0 ? (
                    <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-center justify-between gap-2">
                      <span>No catalog SKUs detected automatically from this message.</span>
                      {selectedMessage.status !== 'billed' && (
                        <button
                          type="button"
                          onClick={handleAddCatalogItemRow}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold whitespace-nowrap"
                        >
                          Map Product Manually
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 px-3">Catalog Product</th>
                            <th className="py-2 px-2">Qty &amp; Unit</th>
                            <th className="py-2 px-2 text-right">Stock Status</th>
                            <th className="py-2 px-3 text-right">Line Total</th>
                            {selectedMessage.status !== 'billed' &&
                              selectedMessage.status !== 'auto_processed' && (
                                <th className="py-2 px-2 w-8"></th>
                              )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          {liveEvaluatedItems.map(item => {
                            const prod = products.find(p => p.id === item.matchedProductId);
                            const isLocked =
                              selectedMessage.status === 'billed' ||
                              selectedMessage.status === 'auto_processed';
                            return (
                              <tr key={item.id} className="hover:bg-slate-800/30">
                                <td className="py-2 px-3">
                                  {isLocked ? (
                                    <div className="font-bold text-white">
                                      {item.matchedProductName}
                                    </div>
                                  ) : (
                                    <select
                                      value={item.matchedProductId}
                                      onChange={e =>
                                        handleItemProductChange(item.id, e.target.value)
                                      }
                                      className="w-full max-w-[210px] px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
                                    >
                                      {products.map(p => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    Rate: {formatCurrency(item.unitPrice)} /{' '}
                                    {item.unit === 'bundle' ? item.bundleUnitName : 'Pc'} (
                                    {item.totalPieces} pcs)
                                  </div>
                                </td>

                                <td className="py-2 px-2 whitespace-nowrap">
                                  {isLocked ? (
                                    <span className="font-bold text-slate-200 tabular-nums">
                                      {item.quantity}{' '}
                                      {item.unit === 'bundle' ? item.bundleUnitName : 'Pcs'}
                                    </span>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        min={1}
                                        max={999}
                                        value={item.quantity}
                                        onChange={e =>
                                          handleItemQtyChange(
                                            item.id,
                                            parseInt(e.target.value, 10) || 1
                                          )
                                        }
                                        className="w-14 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-bold text-white text-center tabular-nums"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleItemUnitToggle(item.id)}
                                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-blue-300 border border-slate-700"
                                        title="Switch between Bundle and Piece"
                                      >
                                        {item.unit === 'bundle' ? item.bundleUnitName : 'Piece'}
                                      </button>
                                    </div>
                                  )}
                                </td>

                                <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">
                                  {prod ? (
                                    item.stockSufficient ? (
                                      <span className="text-[11px] font-semibold text-emerald-400">
                                        {formatStockDisplay(
                                          prod.stockPieces,
                                          prod.bundlePieces,
                                          prod.bundleUnitName
                                        ).text}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] font-bold text-rose-400">
                                        Low: {prod.stockPieces} / {item.totalPieces} pcs
                                      </span>
                                    )
                                  ) : (
                                    <span className="text-[11px] text-slate-500">Unmatched</span>
                                  )}
                                </td>

                                <td className="py-2 px-3 text-right font-mono font-bold text-white tabular-nums">
                                  {formatCurrency(item.lineTotal)}
                                </td>

                                {!isLocked && (
                                  <td className="py-2 px-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveParsedItem(item.id)}
                                      className="p-1 rounded text-slate-500 hover:text-rose-400"
                                      title="Remove row"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-950 border-t border-slate-800">
                            <td colSpan={3} className="py-2 px-3 text-right text-xs font-bold text-slate-300">
                              Estimated Order Subtotal
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-sm font-black text-emerald-400 tabular-nums">
                              {formatCurrency(liveTotal)}
                            </td>
                            {selectedMessage.status !== 'billed' &&
                              selectedMessage.status !== 'auto_processed' && <td />}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Order Execution Controls */}
                  {liveEvaluatedItems.length > 0 &&
                    selectedMessage.status !== 'billed' &&
                    selectedMessage.status !== 'auto_processed' && (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold text-slate-400">
                            Settlement Mode:
                          </span>
                          <div className="flex rounded-lg border border-slate-700 overflow-hidden text-[11px] font-bold">
                            <button
                              type="button"
                              onClick={() => setPaymentModeChoice('credit')}
                              className={`px-2.5 py-1 transition ${
                                paymentModeChoice === 'credit'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-900 text-slate-400 hover:text-white'
                              }`}
                            >
                              Add to Khata (Udhar)
                            </button>
                            <button
                              type="button"
                              onClick={() => setPaymentModeChoice('cash')}
                              className={`px-2.5 py-1 transition ${
                                paymentModeChoice === 'cash'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-900 text-slate-400 hover:text-white'
                              }`}
                            >
                              Cash / Paid
                            </button>
                          </div>
                          {hasStockShortage && (
                            <span className="text-[10px] font-semibold text-amber-300 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                              Partial stock warning — billing will deduct negative diff
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onLoadOrderToCart(selectedMessage.id)}
                            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />
                            Edit in Cart
                          </button>
                          <button
                            type="button"
                            disabled={!config.enabled}
                            onClick={() => {
                              soundManager.playCheckoutSuccess();
                              onConfirmAndBillOrder(
                                selectedMessage.id,
                                paymentModeChoice,
                                config.autoDeductStock !== false
                              );
                            }}
                            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Check className="w-4 h-4" />
                            Confirm, Deduct Stock &amp; Create Bill
                          </button>
                        </div>
                      </div>
                    )}
                </div>

                {/* Automated Reply Composer */}
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-sky-400" />
                      Customer Reply ({selectedMessage.intent === 'inquiry' ? 'Live Rate & Stock Quote' : 'Order Confirmation'})
                    </label>
                    {selectedMessage.repliedAt && (
                      <span className="text-[10px] font-semibold text-emerald-400">
                        Sent via{' '}
                        {selectedMessage.replyDeliveryMode === 'cloud_api'
                          ? 'Meta Cloud API'
                          : 'WhatsApp Web'}
                      </span>
                    )}
                  </div>

                  <textarea
                    rows={4}
                    value={activeReplyText}
                    onChange={e =>
                      setReplyDrafts(prev => ({
                        ...prev,
                        [selectedMessage.id]: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-blue-500"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">
                      {hasServerAccessToken && config.businessPhoneNumberId
                        ? 'Cloud API Token active: Sends directly via Meta Graph API v21.0.'
                        : 'Prepares & logs reply and provides a direct WhatsApp Web link.'}
                    </span>

                    <div className="flex items-center gap-2">
                      <a
                        href={buildWhatsAppWebUrl(selectedMessage.senderPhone, activeReplyText)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                        Open WhatsApp
                      </a>

                      <button
                        type="button"
                        disabled={
                          !config.enabled ||
                          sendingReplyId === selectedMessage.id ||
                          !activeReplyText.trim()
                        }
                        onClick={() => void handleDispatchReply()}
                        className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sendingReplyId === selectedMessage.id
                          ? 'Sending...'
                          : 'Send & Log Reply'}
                      </button>
                    </div>
                  </div>

                  {lastDispatchLinks[selectedMessage.id] && (
                    <div className="p-2.5 rounded-lg bg-blue-950/30 border border-blue-500/30 text-[11px] text-blue-200 flex items-center justify-between gap-2">
                      <span>
                        Reply logged ({lastDispatchLinks[selectedMessage.id].mode === 'cloud_api' ? 'Dispatched via Meta Graph API' : 'Ready on WhatsApp Web'}).
                      </span>
                      {lastDispatchLinks[selectedMessage.id].mode !== 'cloud_api' && (
                        <a
                          href={lastDispatchLinks[selectedMessage.id].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-emerald-300 hover:underline flex items-center gap-1"
                        >
                          Launch Chat <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Meta Business Cloud API Webhook Setup Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Meta WhatsApp Business Cloud API Webhook
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-950 border border-slate-800 text-slate-300">
                {hasServerAccessToken ? 'Cloud API Token Configured' : 'Webhook + Local Simulator Mode'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowWebhookDocs(prev => !prev)}
              className="text-xs font-bold text-blue-400 hover:text-blue-300 self-start sm:self-auto"
            >
              {showWebhookDocs ? 'Hide Setup Details' : 'Show Webhook URL & Verify Token'}
            </button>
          </div>

          {showWebhookDocs && (
            <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5 text-blue-400" /> Callback Webhook URL
                </div>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[11px] font-mono text-emerald-300 truncate">
                    {webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-200 flex items-center gap-1 flex-shrink-0"
                  >
                    {copiedWebhook ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedWebhook ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  Verify Token &amp; Graph API Info
                </div>
                <div className="text-[11px] font-mono text-slate-200">
                  Verify Token: <span className="text-amber-300">{config.verifyToken}</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {config.lastWebhookAt
                    ? `Last webhook ping: ${new Date(config.lastWebhookAt).toLocaleString('en-IN')}`
                    : 'Configure WHATSAPP_ACCESS_TOKEN in server environment variables to send outbound replies automatically.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Receive / Simulate Customer WhatsApp Modal */}
      {isComposerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-black text-white">
                  Receive Customer WhatsApp Message
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsComposerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSimulatedMessage} className="p-4 sm:p-5 space-y-4">
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Quick Wholesale Test Scenarios
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TEST_TEMPLATES.map(tpl => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setComposerName(tpl.senderName);
                        setComposerPhone(tpl.senderPhone);
                        setComposerText(tpl.messageText);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 transition"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Customer Name</label>
                  <input
                    type="text"
                    value={composerName}
                    onChange={e => setComposerName(e.target.value)}
                    placeholder="e.g. Ramesh Kirana Store"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">WhatsApp Phone</label>
                  <input
                    type="tel"
                    value={composerPhone}
                    onChange={e => setComposerPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">
                  Customer Order or Inquiry Text (English / Hinglish)
                </label>
                <textarea
                  rows={3}
                  required
                  value={composerText}
                  onChange={e => setComposerText(e.target.value)}
                  placeholder='e.g. "2 Bundle Gold Flake King aur 3 Carton Parle-G bhej do"'
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {composerError && (
                <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
                  {composerError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsComposerOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isParsingInbound}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-black text-white flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isParsingInbound ? 'Parsing Order & Checking Stock...' : 'Process Inbound Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
