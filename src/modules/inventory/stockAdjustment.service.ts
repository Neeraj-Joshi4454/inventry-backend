import { Types } from 'mongoose';
import { Product } from '../../models/product.model';
import { applyStockChange } from './inventory.service';
import { InventoryTransactionType, ReferenceType } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { runInTransaction } from '../../utils/withTransaction';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { StockAdjustmentInput } from './stockAdjustment.validators';

/**
 * Corrects inventory for damage, miscount, physical-recount mismatches,
 * etc. There is no separate "StockAdjustment" document — the
 * InventoryTransaction created by applyStockChange (type
 * STOCK_ADJUSTMENT_IN/OUT, carrying `reason`) *is* the adjustment record;
 * see docs on inventoryTransaction.model.ts for why this is the ledger's
 * single source of truth rather than a mutation of Inventory.currentStock
 * anywhere else.
 */
export async function createStockAdjustment(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: StockAdjustmentInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;
  const productId = new Types.ObjectId(input.productId);

  return runInTransaction(async (session) => {
    const product = await Product.findOne({ _id: productId, tenantId }).session(session);
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    if (!product.isActive) {
      throw new BadRequestError('Cannot adjust stock for an inactive product');
    }

    const type =
      input.type === 'IN'
        ? InventoryTransactionType.STOCK_ADJUSTMENT_IN
        : InventoryTransactionType.STOCK_ADJUSTMENT_OUT;

    const { inventory, transaction } = await applyStockChange({
      tenantId,
      productId,
      type,
      quantity: input.quantity,
      referenceType: ReferenceType.STOCK_ADJUSTMENT,
      referenceId: productId,
      performedBy: userId,
      notes: input.notes,
      session,
    });

    // applyStockChange only accepts `notes`; write `reason` onto the
    // transaction it just created rather than widening that shared
    // function's signature for a field only adjustments use.
    transaction.reason = input.reason;
    await transaction.save({ session });

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.STOCK_ADJUSTMENT_CREATED,
      entityType: 'InventoryTransaction',
      entityId: transaction._id,
      changes: { after: { type, quantity: input.quantity, reason: input.reason } },
      ipAddress,
      session,
    });

    return { inventory, transaction };
  });
}
