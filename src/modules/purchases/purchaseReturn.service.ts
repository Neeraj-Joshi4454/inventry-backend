import { Types, type ClientSession } from 'mongoose';
import { Purchase, PurchaseItem } from '../../models/purchase.model';
import { PurchaseReturn, PurchaseReturnItem } from '../../models/purchaseReturn.model';
import { applyStockChange } from '../inventory/inventory.service';
import { InventoryTransactionType, ReferenceType, TaxType } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { roundMoney } from '../../utils/money';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreatePurchaseReturnInput } from './purchase.validators';

async function nextPurchaseReturnNumber(tenantId: Types.ObjectId): Promise<string> {
  const count = await PurchaseReturn.countDocuments({ tenantId });
  return `PR-${String(count + 1).padStart(6, '0')}`;
}

/** Mirrors sale.service.ts::getReturnedQuantitiesBySaleItem for the purchase side. */
export async function getReturnedQuantitiesByPurchaseItem(
  tenantId: Types.ObjectId,
  purchaseId: Types.ObjectId,
  session?: ClientSession
): Promise<Map<string, number>> {
  const rows = await PurchaseReturnItem.aggregate(
    [
      { $match: { tenantId, purchaseId } },
      { $group: { _id: '$purchaseItemId', returned: { $sum: '$quantity' } } },
    ],
    { session }
  );
  return new Map(rows.map((row) => [row._id.toString(), row.returned as number]));
}

/**
 * Atomically: validates the original Purchase and, for each requested
 * line, that (already returned + requested) never exceeds what was
 * originally purchased on that line — then creates the PurchaseReturn +
 * PurchaseReturnItems and decreases stock per item via applyStockChange
 * (PURCHASE_RETURN, a *guarded* decrease). That guard is also what
 * satisfies "ensure current inventory has enough stock before processing
 * the return" — a supplier return can't take stock negative even if the
 * quantity is otherwise valid against the original purchase, e.g. because
 * some of it was already sold onward.
 */
export async function createPurchaseReturn(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  purchaseId: string;
  input: CreatePurchaseReturnInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, purchaseId, input, ipAddress } = params;
  const purchaseObjectId = new Types.ObjectId(purchaseId);

  return runInTransaction(async (session) => {
    const purchase = await Purchase.findOne({ _id: purchaseObjectId, tenantId }).session(session);
    if (!purchase) {
      throw new NotFoundError('Purchase not found');
    }

    const purchaseItemIds = input.items.map((item) => new Types.ObjectId(item.purchaseItemId));
    const purchaseItems = await PurchaseItem.find({
      _id: { $in: purchaseItemIds },
      tenantId,
      purchaseId: purchaseObjectId,
    }).session(session);
    const purchaseItemById = new Map(purchaseItems.map((item) => [item._id.toString(), item]));

    const alreadyReturned = await getReturnedQuantitiesByPurchaseItem(
      tenantId,
      purchaseObjectId,
      session
    );

    // Tax is reversed proportionally from what THIS purchase item was
    // actually charged — see the identical comment in
    // saleReturn.service.ts::createSaleReturn.
    let totalAmount = 0;
    let taxableAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let taxAmount = 0;
    const taxTypesUsed = new Set<string>();

    const lineItems = input.items.map((item) => {
      const purchaseItem = purchaseItemById.get(item.purchaseItemId);
      if (!purchaseItem) {
        throw new NotFoundError(`Purchase item ${item.purchaseItemId} not found on this purchase`);
      }

      const returnedSoFar = alreadyReturned.get(item.purchaseItemId) ?? 0;
      const remaining = purchaseItem.quantity - returnedSoFar;
      if (item.quantity > remaining) {
        throw new BadRequestError(
          `Cannot return ${item.quantity} units of this item — only ${remaining} remaining ` +
            `(${purchaseItem.quantity} purchased, ${returnedSoFar} already returned)`
        );
      }

      const unitPrice = Number(purchaseItem.unitPrice.toString());
      const originalQuantity = purchaseItem.quantity;
      const fraction = item.quantity / originalQuantity;
      const lineTaxable = roundMoney(Number(purchaseItem.taxableAmount.toString()) * fraction);
      const lineCgst = roundMoney(Number(purchaseItem.cgstAmount.toString()) * fraction);
      const lineSgst = roundMoney(Number(purchaseItem.sgstAmount.toString()) * fraction);
      const lineIgst = roundMoney(Number(purchaseItem.igstAmount.toString()) * fraction);
      const lineTax = roundMoney(lineCgst + lineSgst + lineIgst);
      const lineTotal = roundMoney(lineTaxable + lineTax);

      totalAmount += lineTotal;
      taxableAmount = roundMoney(taxableAmount + lineTaxable);
      cgstAmount = roundMoney(cgstAmount + lineCgst);
      sgstAmount = roundMoney(sgstAmount + lineSgst);
      igstAmount = roundMoney(igstAmount + lineIgst);
      taxAmount = roundMoney(taxAmount + lineTax);
      if (lineIgst > 0) taxTypesUsed.add(TaxType.IGST);
      else if (lineCgst > 0 || lineSgst > 0) taxTypesUsed.add(TaxType.CGST_SGST);

      return {
        purchaseItemId: purchaseItem._id,
        productId: purchaseItem.productId,
        quantity: item.quantity,
        unitPrice,
        taxRate: purchaseItem.taxRate,
        taxableAmount: lineTaxable,
        cgstAmount: lineCgst,
        sgstAmount: lineSgst,
        igstAmount: lineIgst,
        lineTotal,
      };
    });

    const returnNumber = await nextPurchaseReturnNumber(tenantId);

    const [purchaseReturn] = await PurchaseReturn.create(
      [
        {
          tenantId,
          purchaseId: purchaseObjectId,
          returnNumber,
          taxableAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          taxAmount,
          taxType: taxTypesUsed.size === 1 ? [...taxTypesUsed][0] : purchase.taxType,
          totalAmount,
          notes: input.notes,
          createdBy: userId,
        },
      ],
      { session }
    );

    await PurchaseReturnItem.insertMany(
      lineItems.map((item) => ({
        ...item,
        tenantId,
        purchaseId: purchaseObjectId,
        purchaseReturnId: purchaseReturn._id,
      })),
      { session }
    );

    // Guarded decrease — throws InsufficientStockError (which aborts this
    // whole transaction) if stock has since dropped below the return
    // quantity, e.g. because it was already resold.
    for (const item of lineItems) {
      await applyStockChange({
        tenantId,
        productId: item.productId,
        type: InventoryTransactionType.PURCHASE_RETURN,
        quantity: item.quantity,
        referenceType: ReferenceType.PURCHASE_RETURN,
        referenceId: purchaseReturn._id,
        performedBy: userId,
        session,
      });
    }

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.PURCHASE_RETURN_CREATED,
      entityType: 'PurchaseReturn',
      entityId: purchaseReturn._id,
      changes: { after: { returnNumber, totalAmount, itemCount: lineItems.length } },
      ipAddress,
      session,
    });

    return purchaseReturn;
  });
}

export async function listPurchaseReturns(
  tenantId: Types.ObjectId,
  purchaseId: string,
  pagination: PaginationParams
) {
  const purchase = await Purchase.findOne({ _id: purchaseId, tenantId });
  if (!purchase) {
    throw new NotFoundError('Purchase not found');
  }

  const filter = { tenantId, purchaseId: purchase._id };
  const [returns, total] = await Promise.all([
    PurchaseReturn.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    PurchaseReturn.countDocuments(filter),
  ]);

  const returnIds = returns.map((r) => r._id);
  const items = await PurchaseReturnItem.find({
    tenantId,
    purchaseReturnId: { $in: returnIds },
  }).populate('productId', 'name sku');
  const itemsByReturnId = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.purchaseReturnId.toString();
    if (!itemsByReturnId.has(key)) itemsByReturnId.set(key, []);
    itemsByReturnId.get(key)!.push(item);
  }

  const data = returns.map((r) => ({
    ...r.toJSON(),
    items: itemsByReturnId.get(r._id.toString()) ?? [],
  }));

  return { returns: data, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}
