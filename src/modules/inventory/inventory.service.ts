import type { ClientSession, Types } from 'mongoose';
import { Inventory } from '../../models/inventory.model';
import { InventoryTransaction } from '../../models/inventoryTransaction.model';
import { Product } from '../../models/product.model';
import { checkStockThresholds } from '../notifications/notification.service';
import {
  STOCK_INCREASING_TYPES,
  STOCK_DECREASING_TYPES,
  type InventoryTransactionType,
  type ReferenceType,
} from '../../types/enums';
import { InsufficientStockError } from '../../utils/errors';

export interface ApplyStockChangeInput {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  type: InventoryTransactionType;
  quantity: number; // always positive
  referenceType: ReferenceType;
  referenceId: Types.ObjectId;
  performedBy: Types.ObjectId;
  notes?: string;
  session: ClientSession; // caller owns the transaction (see modules/sales, modules/purchases)
}

/**
 * The single choke point through which every stock mutation in the system
 * must pass. Two properties make this safe under concurrency without any
 * external locking:
 *
 * 1. The stock mutation is a single `findOneAndUpdate` — MongoDB guarantees
 *    document-level atomicity, so concurrent callers can never interleave
 *    reads and writes on the same Inventory document.
 * 2. For decreasing operations, the filter includes `currentStock: { $gte: quantity }`.
 *    If two concurrent sales would both succeed against the pre-read stock
 *    value but not against each other, only the one whose atomic update
 *    executes first will match the filter; the second gets `null` back and
 *    this throws InsufficientStockError, which the caller's transaction
 *    catches and aborts. No negative stock is ever possible.
 *
 * Must always be called inside the caller's `session.withTransaction(...)`
 * alongside creation of the parent document (Sale, Purchase, StockAdjustment)
 * so the whole operation commits or rolls back together.
 */
export async function applyStockChange(input: ApplyStockChangeInput) {
  const {
    tenantId,
    productId,
    type,
    quantity,
    referenceType,
    referenceId,
    performedBy,
    notes,
    session,
  } = input;

  if (quantity <= 0) {
    throw new Error('applyStockChange: quantity must be positive');
  }

  const isIncrease = STOCK_INCREASING_TYPES.has(type);
  const isDecrease = STOCK_DECREASING_TYPES.has(type);
  if (!isIncrease && !isDecrease) {
    throw new Error(`applyStockChange: unknown transaction type "${type}"`);
  }

  // Ensure an Inventory document exists for this (tenant, product) pair.
  // upsert is itself atomic; safe to race across concurrent first-time writes.
  await Inventory.updateOne(
    { tenantId, productId },
    { $setOnInsert: { tenantId, productId, currentStock: 0, reservedStock: 0, version: 0 } },
    { upsert: true, session }
  );

  const beforeDoc = await Inventory.findOne({ tenantId, productId }, { currentStock: 1 }).session(
    session
  );
  const previousStock = beforeDoc?.currentStock ?? 0;

  const filter = isIncrease
    ? { tenantId, productId }
    : { tenantId, productId, currentStock: { $gte: quantity } };

  const update = {
    $inc: { currentStock: isIncrease ? quantity : -quantity, version: 1 },
  };

  const updatedInventory = await Inventory.findOneAndUpdate(filter, update, {
    new: true,
    session,
  });

  if (!updatedInventory) {
    // Either the guard failed (insufficient stock) or, in a pathological
    // race, the doc vanished between upsert and update — both surface as
    // insufficient stock to the caller, which is the correct client-facing signal.
    throw new InsufficientStockError(productId.toString(), quantity, previousStock);
  }

  const resultingStock = updatedInventory.currentStock;

  const [transaction] = await InventoryTransaction.create(
    [
      {
        tenantId,
        productId,
        inventoryId: updatedInventory._id,
        type,
        quantity,
        previousStock,
        resultingStock,
        referenceType,
        referenceId,
        performedBy,
        notes,
      },
    ],
    { session }
  );

  await Inventory.updateOne(
    { _id: updatedInventory._id },
    { $set: { lastTransactionId: transaction._id } },
    { session }
  );

  // Low/out-of-stock alerts — see notification.service.ts. Runs in the
  // same session, so an alert only ever exists for a stock change that
  // actually committed. A product missing here (deleted between the stock
  // change and this read — cannot happen within one transaction, but
  // defensively) just skips the alert rather than failing the operation.
  const product = await Product.findById(productId, { name: 1, lowStockThreshold: 1 }).session(
    session
  );
  if (product) {
    await checkStockThresholds({
      tenantId,
      productId,
      productName: product.name,
      resultingStock,
      lowStockThreshold: product.lowStockThreshold,
      session,
    });
  }

  return { inventory: updatedInventory, transaction };
}
