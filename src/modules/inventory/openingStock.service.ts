import { Types } from 'mongoose';
import { Product } from '../../models/product.model';
import { InventoryTransaction } from '../../models/inventoryTransaction.model';
import { InventoryTransactionType, ReferenceType, type UserRole } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { runInTransaction } from '../../utils/withTransaction';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import { applyStockChange } from './inventory.service';
import type { OpeningStockInput } from './inventory.validators';

/**
 * Sets the one-time starting stock level for a product. Deliberately
 * one-shot: opening stock is a baseline, not a repeatable stock-in — if a
 * product's true starting quantity was wrong, that's an off-book fact you
 * discovered later, which is what stock adjustments (a future module) are
 * for, not a second "opening stock" entry that would silently double-count.
 *
 * previousStock + quantity = resultingStock is enforced by
 * inventory.service.ts::applyStockChange, inside the same MongoDB
 * transaction as the audit log write — see that file for how concurrent
 * writers to the same product are kept safe.
 */
export async function createOpeningStock(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: OpeningStockInput;
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
      throw new BadRequestError('Cannot set opening stock for an inactive product');
    }

    const alreadySet = await InventoryTransaction.exists({
      tenantId,
      productId,
      type: InventoryTransactionType.OPENING_STOCK,
    }).session(session);
    if (alreadySet) {
      throw new ConflictError('Opening stock has already been set for this product');
    }

    const { inventory, transaction } = await applyStockChange({
      tenantId,
      productId,
      type: InventoryTransactionType.OPENING_STOCK,
      quantity: input.quantity,
      referenceType: ReferenceType.SYSTEM,
      referenceId: productId,
      performedBy: userId,
      notes: input.notes,
      session,
    });

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.OPENING_STOCK_CREATED,
      entityType: 'Product',
      entityId: productId,
      changes: { after: { quantity: input.quantity, resultingStock: inventory.currentStock } },
      ipAddress,
      session,
    });

    return { inventory, transaction };
  });
}
