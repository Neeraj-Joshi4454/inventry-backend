import type { ClientSession, Types } from 'mongoose';
import { Notification } from '../../models/notification.model';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';

/**
 * Called once, from inventory.service.ts::applyStockChange — the single
 * choke point every stock mutation passes through — right after a stock
 * change commits. Deliberately simple (see "Important Rules": no complex
 * notification system):
 *
 * - Stock at or below zero: upsert one unread OUT_OF_STOCK alert per
 *   product (never a second one while the first is still unread).
 * - Stock positive but at/under the threshold: upsert one unread
 *   LOW_STOCK alert the same way, and resolve (mark read) any stale
 *   OUT_OF_STOCK alert for this product — stock recovered from zero.
 * - Stock back above the threshold: resolve any stale LOW_STOCK/
 *   OUT_OF_STOCK alert for this product.
 *
 * Runs inside the caller's transaction session, so an alert never appears
 * for a stock change that later rolls back.
 */
export async function checkStockThresholds(params: {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  productName: string;
  resultingStock: number;
  lowStockThreshold: number;
  session: ClientSession;
}) {
  const { tenantId, productId, productName, resultingStock, lowStockThreshold, session } = params;

  if (resultingStock <= 0) {
    await resolveAlert({ tenantId, productId, type: 'LOW_STOCK', session });
    await upsertAlert({
      tenantId,
      productId,
      productName,
      type: 'OUT_OF_STOCK',
      title: 'Out of stock',
      message: `${productName} is out of stock.`,
      session,
    });
  } else if (resultingStock <= lowStockThreshold) {
    await resolveAlert({ tenantId, productId, type: 'OUT_OF_STOCK', session });
    await upsertAlert({
      tenantId,
      productId,
      productName,
      type: 'LOW_STOCK',
      title: 'Low stock',
      message: `${productName} is low on stock (${resultingStock} left).`,
      session,
    });
  } else {
    await resolveAlert({ tenantId, productId, type: 'OUT_OF_STOCK', session });
    await resolveAlert({ tenantId, productId, type: 'LOW_STOCK', session });
  }
}

async function upsertAlert(params: {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  productName: string;
  type: 'LOW_STOCK' | 'OUT_OF_STOCK';
  title: string;
  message: string;
  session: ClientSession;
}) {
  const { tenantId, productId, productName, type, title, message, session } = params;
  const existing = await Notification.findOne({
    tenantId,
    type,
    isRead: false,
    'metadata.productId': productId,
  }).session(session);
  if (existing) return;

  await Notification.create(
    [
      {
        tenantId,
        type,
        title,
        message,
        metadata: { productId, productName },
      },
    ],
    { session }
  );
}

async function resolveAlert(params: {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  type: 'LOW_STOCK' | 'OUT_OF_STOCK';
  session: ClientSession;
}) {
  const { tenantId, productId, type, session } = params;
  await Notification.updateMany(
    { tenantId, type, isRead: false, 'metadata.productId': productId },
    { $set: { isRead: true } },
    { session }
  );
}

export async function listNotifications(
  tenantId: Types.ObjectId,
  query: { unreadOnly?: boolean },
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.unreadOnly) filter.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ tenantId, isRead: false }),
  ]);

  return {
    notifications,
    unreadCount,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
}

export async function markNotificationRead(tenantId: Types.ObjectId, notificationId: string) {
  await Notification.updateOne({ _id: notificationId, tenantId }, { $set: { isRead: true } });
}

export async function markAllNotificationsRead(tenantId: Types.ObjectId) {
  await Notification.updateMany({ tenantId, isRead: false }, { $set: { isRead: true } });
}
