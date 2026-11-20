import {
  SystemNotification,
  SystemNotificationCategory,
  SystemNotificationSeverity,
} from '../types';

const NOTIFICATION_LOG_STORAGE_KEY = 'sq_pos_notification_log_v1';
const NOTIFICATION_READ_IDS_STORAGE_KEY = 'sq_pos_notification_read_ids_v1';
const MAX_NOTIFICATION_LOG_ITEMS = 100;

export function getStoredNotificationLogs(): SystemNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATION_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SystemNotification =>
        Boolean(item && typeof item.id === 'string' && typeof item.message === 'string')
    );
  } catch {
    return [];
  }
}

export function saveNotificationLogs(logs: SystemNotification[]): void {
  try {
    localStorage.setItem(
      NOTIFICATION_LOG_STORAGE_KEY,
      JSON.stringify(logs.slice(0, MAX_NOTIFICATION_LOG_ITEMS))
    );
  } catch {
    // Ignore storage write errors
  }
}

export function createNotificationEntry(params: {
  category: SystemNotificationCategory;
  severity: SystemNotificationSeverity;
  title: string;
  message: string;
  read?: boolean;
  meta?: SystemNotification['meta'];
}): SystemNotification {
  return {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    category: params.category,
    severity: params.severity,
    title: params.title,
    message: params.message,
    timestamp: new Date().toISOString(),
    read: params.read ?? false,
    meta: params.meta,
  };
}

export function appendStoredNotificationLog(
  current: SystemNotification[],
  params: {
    category: SystemNotificationCategory;
    severity: SystemNotificationSeverity;
    title: string;
    message: string;
    meta?: SystemNotification['meta'];
  }
): SystemNotification[] {
  // Collapse immediate identical consecutive entries within 10s
  const latest = current[0];
  if (
    latest &&
    latest.category === params.category &&
    latest.title === params.title &&
    latest.message === params.message &&
    Date.now() - new Date(latest.timestamp).getTime() < 10000
  ) {
    return current;
  }

  const next = [createNotificationEntry(params), ...current].slice(
    0,
    MAX_NOTIFICATION_LOG_ITEMS
  );
  saveNotificationLogs(next);
  return next;
}

export function getStoredAcknowledgedAlertIds(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFICATION_READ_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveAcknowledgedAlertIds(ids: string[]): void {
  try {
    localStorage.setItem(
      NOTIFICATION_READ_IDS_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(ids)).slice(-300))
    );
  } catch {
    // Ignore storage write errors
  }
}
