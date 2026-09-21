import { Types, type ClientSession } from 'mongoose';
import { Sale, SaleItem } from '../../models/sale.model';
import { SaleReturn, SaleReturnItem } from '../../models/saleReturn.model';
import { applyStockChange } from '../inventory/inventory.service';
import { InventoryTransactionType, ReferenceType, TaxType } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { roundMoney } from '../../utils/money';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreateSaleReturnInput } from './sale.validators';

async function nextSaleReturnNumber(tenantId: Types.ObjectId): Promise<string> {
  const count = await SaleReturn.countDocuments({ tenantId });
  return `SR-${String(count + 1).padStart(6, '0')}`;
}

/**
 * Sums, per saleItemId, how much has already been returned across every
 * SaleReturn ever created for this sale — the number a new return request
 * must be checked against (originalQty - alreadyReturned = remaining
 * returnable). Denormalized `saleId` on SaleReturnItem means this is a
 * single collection scan, no join through SaleReturn needed.
 */
export async function getReturnedQuantitiesBySaleItem(
  tenantId: Types.ObjectId,
  saleId: Types.ObjectId,
  session?: ClientSession
): Promise<Map<string, number>> {
  const rows = await SaleReturnItem.aggregate(
    [
      { $match: { tenantId, saleId } },
      { $group: { _id: '$saleItemId', returned: { $sum: '$quantity' } } },
    ],
    { session }
  );
  return new Map(rows.map((row) => [row._id.toString(), row.returned as number]));
}

/**
 * Atomically: validates the original Sale and, for each requested line,
 * that (already returned + requested) never exceeds what was originally
 * sold on that line — then creates the SaleReturn + SaleReturnItems and
 * increases stock per item via applyStockChange (SALE_RETURN, an unguarded
 * increase). The original Sale/SaleItem documents are never modified; the
 * return is a new, independent, immutable record — see saleReturn.model.ts.
 */
export async function createSaleReturn(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  saleId: string;
  input: CreateSaleReturnInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, saleId, input, ipAddress } = params;
  const saleObjectId = new Types.ObjectId(saleId);

  return runInTransaction(async (session) => {
    const sale = await Sale.findOne({ _id: saleObjectId, tenantId }).session(session);
    if (!sale) {
      throw new NotFoundError('Sale not found');
    }

    const saleItemIds = input.items.map((item) => new Types.ObjectId(item.saleItemId));
    const saleItems = await SaleItem.find({
      _id: { $in: saleItemIds },
      tenantId,
      saleId: saleObjectId,
    }).session(session);
    const saleItemById = new Map(saleItems.map((item) => [item._id.toString(), item]));

    const alreadyReturned = await getReturnedQuantitiesBySaleItem(tenantId, saleObjectId, session);

    // Tax is reversed proportionally from what THIS sale item was actually
    // charged (its persisted taxableAmount/cgst/sgst/igst, divided by the
    // quantity originally sold) — never recomputed from today's tax
    // config, so a return's tax always matches what was actually charged,
    // even if tax settings changed since the sale (see "Important Rules":
    // historical invoices must not change).
    let totalAmount = 0;
    let taxableAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let taxAmount = 0;
    const taxTypesUsed = new Set<string>();

    const lineItems = input.items.map((item) => {
      const saleItem = saleItemById.get(item.saleItemId);
      if (!saleItem) {
        throw new NotFoundError(`Sale item ${item.saleItemId} not found on this sale`);
      }

      const returnedSoFar = alreadyReturned.get(item.saleItemId) ?? 0;
      const remaining = saleItem.quantity - returnedSoFar;
      if (item.quantity > remaining) {
        throw new BadRequestError(
          `Cannot return ${item.quantity} units of this item — only ${remaining} remaining ` +
            `(${saleItem.quantity} sold, ${returnedSoFar} already returned)`
        );
      }

      const unitPrice = Number(saleItem.unitPrice.toString());
      const originalQuantity = saleItem.quantity;
      const fraction = item.quantity / originalQuantity;
      const lineTaxable = roundMoney(Number(saleItem.taxableAmount.toString()) * fraction);
      const lineCgst = roundMoney(Number(saleItem.cgstAmount.toString()) * fraction);
      const lineSgst = roundMoney(Number(saleItem.sgstAmount.toString()) * fraction);
      const lineIgst = roundMoney(Number(saleItem.igstAmount.toString()) * fraction);
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
        saleItemId: saleItem._id,
        productId: saleItem.productId,
        quantity: item.quantity,
        unitPrice,
        taxRate: saleItem.taxRate,
        taxableAmount: lineTaxable,
        cgstAmount: lineCgst,
        sgstAmount: lineSgst,
        igstAmount: lineIgst,
        lineTotal,
      };
    });

    const returnNumber = await nextSaleReturnNumber(tenantId);

    const [saleReturn] = await SaleReturn.create(
      [
        {
          tenantId,
          saleId: saleObjectId,
          returnNumber,
          taxableAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          taxAmount,
          taxType: taxTypesUsed.size === 1 ? [...taxTypesUsed][0] : sale.taxType,
          totalAmount,
          notes: input.notes,
          createdBy: userId,
        },
      ],
      { session }
    );

    await SaleReturnItem.insertMany(
      lineItems.map((item) => ({ ...item, tenantId, saleId: saleObjectId, saleReturnId: saleReturn._id })),
      { session }
    );

    for (const item of lineItems) {
      await applyStockChange({
        tenantId,
        productId: item.productId,
        type: InventoryTransactionType.SALE_RETURN,
        quantity: item.quantity,
        referenceType: ReferenceType.SALE_RETURN,
        referenceId: saleReturn._id,
        performedBy: userId,
        session,
      });
    }

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.SALE_RETURN_CREATED,
      entityType: 'SaleReturn',
      entityId: saleReturn._id,
      changes: { after: { returnNumber, totalAmount, itemCount: lineItems.length } },
      ipAddress,
      session,
    });

    return saleReturn;
  });
}

export async function listSaleReturns(
  tenantId: Types.ObjectId,
  saleId: string,
  pagination: PaginationParams
) {
  const sale = await Sale.findOne({ _id: saleId, tenantId });
  if (!sale) {
    throw new NotFoundError('Sale not found');
  }

  const filter = { tenantId, saleId: sale._id };
  const [returns, total] = await Promise.all([
    SaleReturn.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    SaleReturn.countDocuments(filter),
  ]);

  const returnIds = returns.map((r) => r._id);
  const items = await SaleReturnItem.find({ tenantId, saleReturnId: { $in: returnIds } }).populate(
    'productId',
    'name sku'
  );
  const itemsByReturnId = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.saleReturnId.toString();
    if (!itemsByReturnId.has(key)) itemsByReturnId.set(key, []);
    itemsByReturnId.get(key)!.push(item);
  }

  const data = returns.map((r) => ({
    ...r.toJSON(),
    items: itemsByReturnId.get(r._id.toString()) ?? [],
  }));

  return { returns: data, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}
