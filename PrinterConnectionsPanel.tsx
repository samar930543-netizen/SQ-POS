import React, { useEffect, useState } from 'react';
import {
  PaperWidthType,
  PrinterConnectionsConfig,
  PrinterConnectionType,
  StoreProfile,
  ThermalPaperRollConfig,
} from '../types';
import {
  DEFAULT_PAPER_ROLL_CONFIG,
  resolvePrinterConnectionsConfig,
} from '../utils/storage';
import {
  buildEscPosTestPageBytes,
  connectBluetoothPrinter,
  connectUsbPrinter,
  consumeThermalPaperRoll,
  disconnectBluetoothPrinter,
  disconnectUsbPrinter,
  dispatchEscPosPayload,
  getEnabledHardwarePrinters,
  getLiveHardwareStatus,
  getPrinterBrowserCapabilities,
  getRemainingPaperMeters,
  isThermalPaperLow,
  normalizeRollLengthMeters,
  PRINTER_TYPE_LABELS,
  recalculatePaperRollRemaining,
  subscribePrinterHardwareState,
  testTcpPrinterConnection,
} from '../utils/printerManager';
import { RECEIPT_PRESET_DESIGNS } from '../utils/receiptPresets';
import { soundManager } from '../utils/soundEffects';
import {
  Bluetooth,
  Usb,
  Network,
  Wifi,
  Printer,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  PlugZap,
  Unplug,
  Scissors,
  Archive,
  Send,
  ScrollText,
  RotateCcw,
  Volume2,
} from 'lucide-react';

interface PrinterConnectionsPanelProps {
  printers?: PrinterConnectionsConfig;
  paperWidth: PaperWidthType;
  storeProfile: StoreProfile;
  onChange: (nextPrinters: PrinterConnectionsConfig) => void;
}

type PrinterActionState = {
  busyType?: PrinterConnectionType | 'tcp_test_ip' | 'tcp_test_wifi';
  statusMsg?: string;
  errorMsg?: string;
};

export const PrinterConnectionsPanel: React.FC<PrinterConnectionsPanelProps> = ({
  printers: propPrinters,
  paperWidth,
  storeProfile,
  onChange,
}) => {
  const printers = resolvePrinterConnectionsConfig(propPrinters);
  const capabilities = getPrinterBrowserCapabilities();
  const [liveStatus, setLiveStatus] = useState(() => getLiveHardwareStatus());
  const [actionState, setActionState] = useState<PrinterActionState>({});
  const [tcpPingResult, setTcpPingResult] = useState<{
    network_ip?: { ok: boolean; text: string };
    wifi?: { ok: boolean; text: string };
  }>({});
  const [customPaperLength, setCustomPaperLength] = useState<number>(() =>
    normalizeRollLengthMeters(
      printers.paperRoll?.rollLengthMeters ?? DEFAULT_PAPER_ROLL_CONFIG.rollLengthMeters
    )
  );
  const [rollLengthDraft, setRollLengthDraft] = useState<string>(() =>
    String(
      normalizeRollLengthMeters(
        printers.paperRoll?.rollLengthMeters ?? DEFAULT_PAPER_ROLL_CONFIG.rollLengthMeters
      )
    )
  );
  const [isRollLengthFocused, setIsRollLengthFocused] = useState(false);

  useEffect(() => {
    const resolvedLength = normalizeRollLengthMeters(
      printers.paperRoll?.rollLengthMeters ?? DEFAULT_PAPER_ROLL_CONFIG.rollLengthMeters
    );
    setCustomPaperLength(resolvedLength);
    if (!isRollLengthFocused) {
      setRollLengthDraft(String(resolvedLength));
    }
  }, [printers.paperRoll?.rollLengthMeters, isRollLengthFocused]);

  useEffect(() => {
    return subscribePrinterHardwareState(() => {
      setLiveStatus(getLiveHardwareStatus());
    });
  }, []);

  const enabledTypes = getEnabledHardwarePrinters(printers);

  const commit = (next: PrinterConnectionsConfig) => {
    // If the currently preferred hardware printer was disabled, fall back safely
    let adjustedPreferred = next.preferredType;
    if (adjustedPreferred !== 'browser') {
      const stillEnabled =
        (adjustedPreferred === 'bluetooth' && next.bluetooth.enabled) ||
        (adjustedPreferred === 'usb' && next.usb.enabled) ||
        (adjustedPreferred === 'network_ip' && next.networkIp.enabled) ||
        (adjustedPreferred === 'wifi' && next.wifi.enabled);
      if (!stillEnabled) {
        const nextFirst = getEnabledHardwarePrinters(next)[0];
        adjustedPreferred = nextFirst || 'browser';
      }
    }
    onChange({
      ...next,
      preferredType: adjustedPreferred,
    });
  };

  const togglePrinterEnabled = (type: PrinterConnectionType) => {
    soundManager.playMechanicalClick();
    setActionState({});
    if (type === 'bluetooth') {
      const nextEnabled = !printers.bluetooth.enabled;
      commit({
        ...printers,
        bluetooth: { ...printers.bluetooth, enabled: nextEnabled },
      });
    } else if (type === 'usb') {
      const nextEnabled = !printers.usb.enabled;
      commit({
        ...printers,
        usb: { ...printers.usb, enabled: nextEnabled },
      });
    } else if (type === 'network_ip') {
      const nextEnabled = !printers.networkIp.enabled;
      commit({
        ...printers,
        networkIp: { ...printers.networkIp, enabled: nextEnabled },
      });
    } else {
      const nextEnabled = !printers.wifi.enabled;
      commit({
        ...printers,
        wifi: { ...printers.wifi, enabled: nextEnabled },
      });
    }
  };

  const handleConnectBluetooth = async () => {
    soundManager.playMechanicalClick();
    setActionState({ busyType: 'bluetooth' });
    try {
      const info = await connectBluetoothPrinter();
      commit({
        ...printers,
        bluetooth: {
          ...printers.bluetooth,
          enabled: true,
          deviceId: info.deviceId,
          deviceName: info.deviceName,
          serviceUuid: info.serviceUuid,
          characteristicUuid: info.characteristicUuid,
        },
      });
      setActionState({
        statusMsg: `Connected to Bluetooth printer "${info.deviceName}".`,
      });
      soundManager.playCheckoutSuccess();
    } catch (err: any) {
      setActionState({
        errorMsg: err?.message || 'Could not pair Bluetooth thermal printer.',
      });
    }
  };

  const handleDisconnectBluetooth = async () => {
    soundManager.playMechanicalClick();
    await disconnectBluetoothPrinter();
    setActionState({ statusMsg: 'Bluetooth printer disconnected.' });
  };

  const handleConnectUsb = async () => {
    soundManager.playMechanicalClick();
    setActionState({ busyType: 'usb' });
    try {
      const info = await connectUsbPrinter(
        printers.usb.transport,
        printers.usb.baudRate || 9600
      );
      commit({
        ...printers,
        usb: {
          ...printers.usb,
          enabled: true,
          transport: info.transport,
          deviceName: info.deviceName,
          vendorId: info.vendorId,
          productId: info.productId,
          interfaceNumber: info.interfaceNumber,
          endpointNumber: info.endpointNumber,
        },
      });
      setActionState({
        statusMsg: `Connected to USB printer "${info.deviceName}".`,
      });
      soundManager.playCheckoutSuccess();
    } catch (err: any) {
      setActionState({
        errorMsg: err?.message || 'Could not connect to USB printer.',
      });
    }
  };

  const handleDisconnectUsb = async () => {
    soundManager.playMechanicalClick();
    await disconnectUsbPrinter();
    setActionState({ statusMsg: 'USB printer disconnected.' });
  };

  const handleTestTcp = async (channel: 'network_ip' | 'wifi') => {
    soundManager.playMechanicalClick();
    const host = channel === 'network_ip' ? printers.networkIp.host : printers.wifi.host;
    const port = channel === 'network_ip' ? printers.networkIp.port : printers.wifi.port;
    const timeoutMs =
      channel === 'network_ip'
        ? printers.networkIp.timeoutMs || 4000
        : printers.wifi.timeoutMs || 4500;

    setActionState({
      busyType: channel === 'network_ip' ? 'tcp_test_ip' : 'tcp_test_wifi',
    });

    try {
      const result = await testTcpPrinterConnection(host, port || 9100, timeoutMs);
      if (result.reachable) {
        const text = `Reachable at ${host}:${port || 9100} (${result.latencyMs ?? 0}ms)`;
        setTcpPingResult(prev => ({
          ...prev,
          [channel]: { ok: true, text },
        }));
        setActionState({ statusMsg: text });
        soundManager.playCheckoutSuccess();
      } else {
        const text = result.error || `No response from ${host}:${port || 9100}`;
        setTcpPingResult(prev => ({
          ...prev,
          [channel]: { ok: false, text },
        }));
        setActionState({ errorMsg: text });
      }
    } catch (err: any) {
      const text = err?.message || `Connection test failed for ${host}:${port || 9100}`;
      setTcpPingResult(prev => ({
        ...prev,
        [channel]: { ok: false, text },
      }));
      setActionState({ errorMsg: text });
    }
  };

  const paperRoll: ThermalPaperRollConfig = printers.paperRoll || {
    ...DEFAULT_PAPER_ROLL_CONFIG,
  };
  const paperMetrics = getRemainingPaperMeters(printers, customPaperLength);
  const paperIsLow = isThermalPaperLow(printers, customPaperLength);

  const updatePaperRoll = (patch: Partial<ThermalPaperRollConfig>) => {
    const merged: ThermalPaperRollConfig = {
      ...paperRoll,
      ...patch,
    };
    const targetLength =
      patch.rollLengthMeters !== undefined
        ? normalizeRollLengthMeters(patch.rollLengthMeters)
        : customPaperLength;
    const nextRoll =
      patch.rollLengthMeters !== undefined && patch.usedMetersSinceReset === undefined
        ? recalculatePaperRollRemaining(merged, targetLength)
        : merged;
    commit({
      ...printers,
      paperRoll: nextRoll,
    });
  };

  const applyCustomPaperLength = (meters: number) => {
    const normalized = normalizeRollLengthMeters(meters);
    setCustomPaperLength(normalized);
    updatePaperRoll({ rollLengthMeters: normalized });
  };

  const handleTestPrint = async (type: PrinterConnectionType) => {
    soundManager.playMechanicalClick();
    setActionState({ busyType: type });
    try {
      const testBytes = buildEscPosTestPageBytes(
        PRINTER_TYPE_LABELS[type],
        paperWidth,
        storeProfile,
        printers
      );
      const res = await dispatchEscPosPayload(type, testBytes, printers);
      const nextAfterPrint = consumeThermalPaperRoll(
        printers,
        { items: [{ productId: 'test', productName: 'Test', unit: 'piece', bundleUnitName: 'Pcs', bundlePieces: 1, quantity: 1, unitPrice: 1, totalPieces: 1, itemTotal: 1 }] },
        RECEIPT_PRESET_DESIGNS.compact,
        customPaperLength
      );
      commit(nextAfterPrint);
      if (
        !paperIsLow &&
        isThermalPaperLow(nextAfterPrint, customPaperLength) &&
        paperRoll.alertSoundOnLowPaper !== false
      ) {
        soundManager.playAlertSound();
      } else {
        soundManager.playCheckoutSuccess();
      }
      setActionState({ statusMsg: res.message });
    } catch (err: any) {
      setActionState({
        errorMsg: err?.message || `Failed to send test print via ${PRINTER_TYPE_LABELS[type]}.`,
      });
    }
  };

  return (
    <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3.5">
      {/* Section Header + Default Route Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-800/80 pb-3">
        <div>
          <h4 className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
            <Printer className="w-4 h-4 text-sky-400" />
            <span>Printer Hardware Connections (Bluetooth, USB, Network IP &amp; WiFi)</span>
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {enabledTypes.length}/4 printer types enabled · Use individual switches below to activate each printer channel.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <label
            htmlFor="default-printer-route"
            className="text-[11px] font-semibold text-slate-400 whitespace-nowrap"
          >
            Default Route:
          </label>
          <select
            id="default-printer-route"
            value={printers.preferredType}
            onChange={e => {
              soundManager.playMechanicalClick();
              commit({
                ...printers,
                preferredType: e.target.value as PrinterConnectionsConfig['preferredType'],
              });
            }}
            className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
          >
            <option value="browser">System / Browser Print</option>
            {printers.bluetooth.enabled && <option value="bluetooth">Bluetooth Printer</option>}
            {printers.usb.enabled && <option value="usb">USB Printer</option>}
            {printers.networkIp.enabled && <option value="network_ip">Network IP Printer</option>}
            {printers.wifi.enabled && <option value="wifi">WiFi Printer</option>}
          </select>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionState.statusMsg && (
        <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-[11px] font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{actionState.statusMsg}</span>
        </div>
      )}
      {actionState.errorMsg && (
        <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-200 text-[11px] font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{actionState.errorMsg}</span>
        </div>
      )}

      {/* 4 Printer Type Cards with Individual Toggle Switches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. BLUETOOTH PRINTER */}
        <div
          className={`p-3.5 rounded-xl border transition space-y-3 ${
            printers.bluetooth.enabled
              ? 'bg-slate-900/90 border-blue-500/40'
              : 'bg-slate-900/40 border-slate-800/80 opacity-80'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-lg flex-shrink-0 ${
                  printers.bluetooth.enabled
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                <Bluetooth className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                  <span>Bluetooth Printer</span>
                  {printers.preferredType === 'bluetooth' && printers.bluetooth.enabled && (
                    <span className="text-[10px] font-semibold text-blue-300">· Default</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {printers.bluetooth.enabled
                    ? liveStatus.bluetoothConnected
                      ? `Connected: ${liveStatus.bluetoothDeviceName}`
                      : printers.bluetooth.deviceName
                        ? `Paired: ${printers.bluetooth.deviceName}`
                        : 'Enabled · BLE 58mm / 80mm ESC/POS'
                    : 'Disabled · Toggle on to enable Bluetooth printing'}
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={printers.bluetooth.enabled}
              aria-label="Enable or disable Bluetooth printer"
              onClick={() => togglePrinterEnabled('bluetooth')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                printers.bluetooth.enabled ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                  printers.bluetooth.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {printers.bluetooth.enabled && (
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <label htmlFor="bt-chunk-size" className="text-slate-400 font-medium">
                  BLE Chunk Size:
                </label>
                <select
                  id="bt-chunk-size"
                  value={printers.bluetooth.chunkSizeBytes || 100}
                  onChange={e =>
                    commit({
                      ...printers,
                      bluetooth: {
                        ...printers.bluetooth,
                        chunkSizeBytes: Number(e.target.value) || 100,
                      },
                    })
                  }
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white tabular-nums"
                >
                  <option value={60}>60 bytes (High Compatibility)</option>
                  <option value={100}>100 bytes (Balanced)</option>
                  <option value={180}>180 bytes (Fast BLE 5)</option>
                </select>
              </div>

              {!capabilities.bluetoothSupported && (
                <p className="text-[10.5px] text-amber-300/90 leading-snug">
                  Web Bluetooth requires Chrome or Edge on desktop/Android over HTTPS.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {liveStatus.bluetoothConnected ? (
                  <button
                    type="button"
                    onClick={handleDisconnectBluetooth}
                    className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                  >
                    <Unplug className="w-3.5 h-3.5 text-rose-400" />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionState.busyType === 'bluetooth'}
                    onClick={handleConnectBluetooth}
                    className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition"
                  >
                    {actionState.busyType === 'bluetooth' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                    <span>Pair Bluetooth</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!liveStatus.bluetoothConnected || actionState.busyType === 'bluetooth'}
                  onClick={() => handleTestPrint('bluetooth')}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-45 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                >
                  <Send className="w-3.5 h-3.5 text-blue-400" />
                  <span>Test Print</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2. USB PRINTER */}
        <div
          className={`p-3.5 rounded-xl border transition space-y-3 ${
            printers.usb.enabled
              ? 'bg-slate-900/90 border-indigo-500/40'
              : 'bg-slate-900/40 border-slate-800/80 opacity-80'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-lg flex-shrink-0 ${
                  printers.usb.enabled
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                <Usb className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                  <span>USB Printer</span>
                  {printers.preferredType === 'usb' && printers.usb.enabled && (
                    <span className="text-[10px] font-semibold text-indigo-300">· Default</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {printers.usb.enabled
                    ? liveStatus.usbConnected
                      ? `Connected: ${liveStatus.usbDeviceName}`
                      : printers.usb.deviceName
                        ? `Last device: ${printers.usb.deviceName}`
                        : 'Enabled · Direct WebUSB or USB-Serial POS'
                    : 'Disabled · Toggle on to enable USB printing'}
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={printers.usb.enabled}
              aria-label="Enable or disable USB printer"
              onClick={() => togglePrinterEnabled('usb')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                printers.usb.enabled ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                  printers.usb.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {printers.usb.enabled && (
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="USB driver transport"
                  value={printers.usb.transport}
                  onChange={e =>
                    commit({
                      ...printers,
                      usb: {
                        ...printers.usb,
                        transport: e.target.value as 'webusb' | 'serial',
                      },
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                >
                  <option value="webusb">WebUSB Direct</option>
                  <option value="serial">USB Serial (COM)</option>
                </select>

                {printers.usb.transport === 'serial' ? (
                  <select
                    aria-label="USB Serial baud rate"
                    value={printers.usb.baudRate || 9600}
                    onChange={e =>
                      commit({
                        ...printers,
                        usb: {
                          ...printers.usb,
                          baudRate: Number(e.target.value) || 9600,
                        },
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white tabular-nums"
                  >
                    <option value={9600}>9600 baud</option>
                    <option value={19200}>19200 baud</option>
                    <option value={38400}>38400 baud</option>
                    <option value={115200}>115200 baud</option>
                  </select>
                ) : (
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 flex items-center">
                    Bulk OUT ESC/POS
                  </div>
                )}
              </div>

              {!capabilities.webUsbSupported && !capabilities.webSerialSupported && (
                <p className="text-[10.5px] text-amber-300/90 leading-snug">
                  Direct WebUSB/Serial requires Chrome or Edge with USB OTG/cable access.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {liveStatus.usbConnected ? (
                  <button
                    type="button"
                    onClick={handleDisconnectUsb}
                    className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                  >
                    <Unplug className="w-3.5 h-3.5 text-rose-400" />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionState.busyType === 'usb'}
                    onClick={handleConnectUsb}
                    className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition"
                  >
                    {actionState.busyType === 'usb' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                    <span>Connect USB</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!liveStatus.usbConnected || actionState.busyType === 'usb'}
                  onClick={() => handleTestPrint('usb')}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-45 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                >
                  <Send className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Test Print</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. NETWORK IP PRINTER */}
        <div
          className={`p-3.5 rounded-xl border transition space-y-3 ${
            printers.networkIp.enabled
              ? 'bg-slate-900/90 border-emerald-500/40'
              : 'bg-slate-900/40 border-slate-800/80 opacity-80'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-lg flex-shrink-0 ${
                  printers.networkIp.enabled
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                <Network className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                  <span>Network IP Printer</span>
                  {printers.preferredType === 'network_ip' && printers.networkIp.enabled && (
                    <span className="text-[10px] font-semibold text-emerald-300">· Default</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate tabular-nums">
                  {printers.networkIp.enabled
                    ? `${printers.networkIp.host || 'Not set'}:${printers.networkIp.port || 9100}`
                    : 'Disabled · Toggle on for LAN Ethernet IP printing'}
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={printers.networkIp.enabled}
              aria-label="Enable or disable Network IP printer"
              onClick={() => togglePrinterEnabled('network_ip')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                printers.networkIp.enabled ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                  printers.networkIp.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {printers.networkIp.enabled && (
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-8 space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 block">
                    LAN IP / Hostname
                  </label>
                  <input
                    type="text"
                    value={printers.networkIp.host}
                    onChange={e =>
                      commit({
                        ...printers,
                        networkIp: { ...printers.networkIp, host: e.target.value },
                      })
                    }
                    placeholder="192.168.1.100"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="col-span-4 space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 block">
                    TCP Port
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={printers.networkIp.port || 9100}
                    onChange={e =>
                      commit({
                        ...printers,
                        networkIp: {
                          ...printers.networkIp,
                          port: parseInt(e.target.value, 10) || 9100,
                        },
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white tabular-nums focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {tcpPingResult.network_ip && (
                <div
                  className={`text-[10.5px] font-medium tabular-nums ${
                    tcpPingResult.network_ip.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {tcpPingResult.network_ip.text}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={
                    !printers.networkIp.host.trim() || actionState.busyType === 'tcp_test_ip'
                  }
                  onClick={() => handleTestTcp('network_ip')}
                  className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-50 border border-emerald-500/40 text-xs font-bold text-emerald-300 flex items-center justify-center gap-1.5 transition"
                >
                  {actionState.busyType === 'tcp_test_ip' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="w-3.5 h-3.5" />
                  )}
                  <span>Ping IP</span>
                </button>

                <button
                  type="button"
                  disabled={
                    !printers.networkIp.host.trim() || actionState.busyType === 'network_ip'
                  }
                  onClick={() => handleTestPrint('network_ip')}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                >
                  {actionState.busyType === 'network_ip' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>Test Print</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 4. WIFI PRINTER */}
        <div
          className={`p-3.5 rounded-xl border transition space-y-3 ${
            printers.wifi.enabled
              ? 'bg-slate-900/90 border-cyan-500/40'
              : 'bg-slate-900/40 border-slate-800/80 opacity-80'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-lg flex-shrink-0 ${
                  printers.wifi.enabled
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                <Wifi className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                  <span>WiFi Printer</span>
                  {printers.preferredType === 'wifi' && printers.wifi.enabled && (
                    <span className="text-[10px] font-semibold text-cyan-300">· Default</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate tabular-nums">
                  {printers.wifi.enabled
                    ? printers.wifi.mode === 'system_wifi'
                      ? `Wireless System Print${printers.wifi.ssidLabel ? ` (${printers.wifi.ssidLabel})` : ''}`
                      : `Raw TCP · ${printers.wifi.host || 'Not set'}:${printers.wifi.port || 9100}`
                    : 'Disabled · Toggle on for WiFi / AirPrint printers'}
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={printers.wifi.enabled}
              aria-label="Enable or disable WiFi printer"
              onClick={() => togglePrinterEnabled('wifi')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                printers.wifi.enabled ? 'bg-cyan-600' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                  printers.wifi.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {printers.wifi.enabled && (
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="WiFi printer protocol mode"
                  value={printers.wifi.mode}
                  onChange={e =>
                    commit({
                      ...printers,
                      wifi: {
                        ...printers.wifi,
                        mode: e.target.value as 'raw_tcp' | 'system_wifi',
                      },
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                >
                  <option value="raw_tcp">WiFi Raw TCP (9100)</option>
                  <option value="system_wifi">AirPrint / WiFi Sheet</option>
                </select>

                <input
                  type="text"
                  value={printers.wifi.ssidLabel || ''}
                  onChange={e =>
                    commit({
                      ...printers,
                      wifi: { ...printers.wifi, ssidLabel: e.target.value },
                    })
                  }
                  placeholder="WiFi SSID (optional)"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {printers.wifi.mode === 'raw_tcp' && (
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8 space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 block">
                      WiFi IP / mDNS Host
                    </label>
                    <input
                      type="text"
                      value={printers.wifi.host}
                      onChange={e =>
                        commit({
                          ...printers,
                          wifi: { ...printers.wifi, host: e.target.value },
                        })
                      }
                      placeholder="192.168.1.150"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="col-span-4 space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 block">
                      Port
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={printers.wifi.port || 9100}
                      onChange={e =>
                        commit({
                          ...printers,
                          wifi: {
                            ...printers.wifi,
                            port: parseInt(e.target.value, 10) || 9100,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white tabular-nums focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}

              {printers.wifi.mode === 'raw_tcp' && tcpPingResult.wifi && (
                <div
                  className={`text-[10.5px] font-medium tabular-nums ${
                    tcpPingResult.wifi.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {tcpPingResult.wifi.text}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {printers.wifi.mode === 'raw_tcp' && (
                  <button
                    type="button"
                    disabled={
                      !printers.wifi.host.trim() || actionState.busyType === 'tcp_test_wifi'
                    }
                    onClick={() => handleTestTcp('wifi')}
                    className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 disabled:opacity-50 border border-cyan-500/40 text-xs font-bold text-cyan-300 flex items-center justify-center gap-1.5 transition"
                  >
                    {actionState.busyType === 'tcp_test_wifi' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                    <span>Test WiFi</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    (printers.wifi.mode === 'raw_tcp' && !printers.wifi.host.trim()) ||
                    actionState.busyType === 'wifi'
                  }
                  onClick={() => handleTestPrint('wifi')}
                  className="min-h-[40px] flex-1 px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                >
                  {actionState.busyType === 'wifi' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>
                    {printers.wifi.mode === 'system_wifi' ? 'Open WiFi Print' : 'Test Print'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ESC/POS Hardware Commands Footer (Auto-Cutter Mode, Cash Drawer & Feed) */}
      <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Scissors className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-slate-200 truncate">
                  Thermal Auto-Cutter
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={printers.autoCutPaper}
                aria-label="Toggle thermal printer auto-cutter"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  commit({ ...printers, autoCutPaper: !printers.autoCutPaper });
                }}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  printers.autoCutPaper ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    printers.autoCutPaper ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {printers.autoCutPaper && (
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                {(
                  [
                    { id: 'partial', label: 'Partial Cut' },
                    { id: 'full', label: 'Full Cut' },
                  ] as const
                ).map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      commit({ ...printers, autoCutMode: mode.id });
                    }}
                    className={`px-2 py-1 rounded border text-[10px] font-bold transition whitespace-nowrap ${
                      (printers.autoCutMode || 'partial') === mode.id
                        ? 'bg-sky-600/25 border-sky-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Archive className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-slate-200 truncate">
                Kick Cash Drawer
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={printers.openCashDrawer}
              aria-label="Toggle cash drawer pulse on print"
              onClick={() => {
                soundManager.playMechanicalClick();
                commit({ ...printers, openCashDrawer: !printers.openCashDrawer });
              }}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                printers.openCashDrawer ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  printers.openCashDrawer ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2">
            <label
              htmlFor="feed-lines-select"
              className="text-[11px] font-semibold text-slate-200 whitespace-nowrap"
            >
              Feed Lines:
            </label>
            <select
              id="feed-lines-select"
              value={printers.feedLinesAfterPrint}
              onChange={e =>
                commit({
                  ...printers,
                  feedLinesAfterPrint: Number(e.target.value) || 3,
                })
              }
              className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-white tabular-nums"
            >
              {[2, 3, 4, 5, 6].map(n => (
                <option key={n} value={n}>
                  {n} lines
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Thermal Paper Roll Monitor & Low-Paper Alert */}
        <div
          className={`p-3 rounded-xl border space-y-2.5 transition ${
            paperIsLow
              ? 'bg-amber-950/25 border-amber-500/45'
              : 'bg-slate-900/70 border-slate-800'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              {paperIsLow ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              ) : (
                <ScrollText className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                  <span>Thermal Paper Roll &amp; Low-Paper Alerts</span>
                  {paperIsLow && (
                    <span className="text-[10.5px] font-bold text-amber-300 tabular-nums">
                      · Low Paper ({Math.round(paperMetrics.remainingPct)}% · {paperMetrics.remainingMeters.toFixed(1)}m left)
                    </span>
                  )}
                </div>
                <p className="text-[10.5px] text-slate-400">
                  Tracks remaining meters from your custom roll length across prints and triggers POS warnings below your threshold.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-shrink-0">
              {paperRoll.lowPaperAlertEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    updatePaperRoll({
                      alertSoundOnLowPaper: !(paperRoll.alertSoundOnLowPaper !== false),
                    });
                  }}
                  className={`px-2 py-1 rounded-lg border text-[10.5px] font-semibold flex items-center gap-1 transition whitespace-nowrap ${
                    paperRoll.alertSoundOnLowPaper !== false
                      ? 'bg-amber-600/20 border-amber-500/40 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                  title="Play warning beep when receipt roll crosses low-paper threshold"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Beep {paperRoll.alertSoundOnLowPaper !== false ? 'On' : 'Off'}</span>
                </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={paperRoll.lowPaperAlertEnabled}
                aria-label="Toggle low-paper alerts"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  updatePaperRoll({
                    lowPaperAlertEnabled: !paperRoll.lowPaperAlertEnabled,
                  });
                }}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  paperRoll.lowPaperAlertEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    paperRoll.lowPaperAlertEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Remaining Roll Progress Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] tabular-nums">
              <span className="text-slate-300 font-semibold">
                Estimated Roll Left:{' '}
                <strong
                  className={
                    paperIsLow
                      ? 'text-amber-300'
                      : paperMetrics.remainingPct <= 30
                        ? 'text-sky-300'
                        : 'text-emerald-300'
                  }
                >
                  {Math.round(paperMetrics.remainingPct)}%
                </strong>
                <span className="text-slate-500 ml-1.5">
                  ({paperMetrics.remainingMeters.toFixed(1)}m of {paperMetrics.totalMeters}m
                  {paperMetrics.usedMeters > 0 ? ` · ${paperMetrics.usedMeters.toFixed(2)}m used` : ''})
                </span>
              </span>
              <span className="text-slate-400">
                {paperRoll.billsPrintedSinceReset || 0} prints on roll
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, Math.max(0, paperMetrics.remainingPct))}%` }}
                className={`h-full transition-all duration-300 ${
                  paperMetrics.remainingPct <= 8
                    ? 'bg-rose-500'
                    : paperIsLow
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1.5">
                <label
                  htmlFor="roll-length-meters-input"
                  className="text-[10px] font-semibold text-slate-400 whitespace-nowrap"
                >
                  Paper Length (m)
                </label>
                <div className="flex items-center gap-1">
                  {[30, 50, 80].map(presetMeters => (
                    <button
                      key={presetMeters}
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setRollLengthDraft(String(presetMeters));
                        applyCustomPaperLength(presetMeters);
                      }}
                      className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold tabular-nums border transition ${
                        customPaperLength === presetMeters
                          ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {presetMeters}m
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <input
                  id="roll-length-meters-input"
                  type="number"
                  min={1}
                  max={500}
                  step="any"
                  inputMode="decimal"
                  aria-label="Custom thermal paper roll length in meters"
                  value={rollLengthDraft}
                  onFocus={() => setIsRollLengthFocused(true)}
                  onChange={e => {
                    const raw = e.target.value;
                    setRollLengthDraft(raw);
                    const parsed = parseFloat(raw);
                    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500) {
                      applyCustomPaperLength(parsed);
                    }
                  }}
                  onBlur={() => {
                    setIsRollLengthFocused(false);
                    const parsed = parseFloat(rollLengthDraft);
                    const clamped = Number.isFinite(parsed)
                      ? normalizeRollLengthMeters(parsed)
                      : customPaperLength;
                    setRollLengthDraft(String(clamped));
                    if (clamped !== customPaperLength) {
                      applyCustomPaperLength(clamped);
                    }
                  }}
                  placeholder="30"
                  className="w-full pl-2.5 pr-16 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] font-semibold text-slate-400">
                  meters
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="low-paper-threshold-select"
                className="text-[10px] font-semibold text-slate-400 block"
              >
                Low-Paper Alert Threshold
              </label>
              <select
                id="low-paper-threshold-select"
                value={paperRoll.lowPaperThresholdPct}
                onChange={e =>
                  updatePaperRoll({
                    lowPaperThresholdPct: Number(e.target.value) || 15,
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white tabular-nums"
              >
                {[10, 15, 20, 25].map(pct => (
                  <option key={pct} value={pct}>
                    Alert below {pct}%
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  soundManager.playCheckoutSuccess();
                  updatePaperRoll({
                    estimatedRemainingPct: 100,
                    usedMetersSinceReset: 0,
                    billsPrintedSinceReset: 0,
                    lastResetAt: new Date().toISOString(),
                  });
                  setActionState({
                    statusMsg: `Thermal paper roll reset to 100% (${paperMetrics.totalMeters}m available).`,
                  });
                }}
                className="flex-1 min-h-[34px] px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-[11px] font-bold text-emerald-200 flex items-center justify-center gap-1 transition whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>New Roll (100%)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const testPct = Math.max(5, paperRoll.lowPaperThresholdPct - 3);
                  const simulatedUsedMeters = Number(
                    (paperMetrics.totalMeters * (1 - testPct / 100)).toFixed(4)
                  );
                  updatePaperRoll({
                    estimatedRemainingPct: testPct,
                    usedMetersSinceReset: simulatedUsedMeters,
                  });
                  if (paperRoll.lowPaperAlertEnabled && paperRoll.alertSoundOnLowPaper !== false) {
                    soundManager.playAlertSound();
                  } else {
                    soundManager.playMechanicalClick();
                  }
                }}
                className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300 transition whitespace-nowrap"
                title="Drop simulated paper level below alert threshold to test warnings"
              >
                Test Low
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
