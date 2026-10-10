import { Types } from 'mongoose';
import { Expense } from '../../models/expense.model';
import { ExpenseCategory } from '../../models/expenseCategory.model';
import { ExpenseStatus } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { buildSearchFilter } from '../../utils/queryFilters';
import { convertDecimals } from '../../utils/schemaJson';
import { dayBounds, monthBounds, previousMonthBounds } from '../../utils/dateRanges';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  SetExpenseStatusInput,
  UpdateExpenseInput,
} from './expense.validators';

function clean<T>(value: T): T {
  return convertDecimals(value) as T;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

async function getActiveCategoryOrThrow(tenantId: Types.ObjectId, categoryId: string) {
  const category = await ExpenseCategory.findOne({ _id: categoryId, tenantId });
  if (!category) {
    throw new NotFoundError('Expense category not found');
  }
  if (!category.isActive) {
    throw new BadRequestError(`Expense category "${category.name}" is inactive`);
  }
  return category;
}

export async function createExpense(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateExpenseInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  await getActiveCategoryOrThrow(tenantId, input.categoryId);

  const expense = await Expense.create({
    tenantId,
    ...input,
    createdBy: userId,
  });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_CREATED,
    entityType: 'Expense',
    entityId: expense._id,
    changes: { after: { title: expense.title, amount: input.amount } },
    ipAddress,
  });

  return expense;
}

export async function listExpenses(
  tenantId: Types.ObjectId,
  query: Partial<ListExpensesQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (!query.status || query.status === 'active') {
    filter.status = ExpenseStatus.ACTIVE;
  } else if (query.status === 'cancelled') {
    filter.status = ExpenseStatus.CANCELLED;
  }
  // status === 'all' leaves status unfiltered.

  if (query.search?.trim()) {
    Object.assign(filter, buildSearchFilter('title', query.search.trim()));
  }
  if (query.categoryId) {
    filter.categoryId = new Types.ObjectId(query.categoryId);
  }
  if (query.paymentMethod) {
    filter.paymentMethod = query.paymentMethod;
  }
  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = query.fromDate;
    if (query.toDate) range.$lte = query.toDate;
    filter.expenseDate = range;
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .sort({ expenseDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('categoryId', 'name')
      .populate('createdBy', 'name'),
    Expense.countDocuments(filter),
  ]);

  return { expenses, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getExpenseById(tenantId: Types.ObjectId, expenseId: string) {
  const expense = await Expense.findOne({ _id: expenseId, tenantId })
    .populate('categoryId', 'name')
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name');
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  return expense;
}

export async function updateExpense(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  expenseId: string;
  input: UpdateExpenseInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, expenseId, input, ipAddress } = params;

  const expense = await Expense.findOne({ _id: expenseId, tenantId });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }

  if (input.categoryId) {
    await getActiveCategoryOrThrow(tenantId, input.categoryId);
  }

  Object.assign(expense, input);
  expense.updatedBy = userId;
  await expense.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_UPDATED,
    entityType: 'Expense',
    entityId: expense._id,
    changes: { after: input },
    ipAddress,
  });

  return expense;
}

/**
 * Deliberately a status flag, never a delete — see "Important Rules": no
 * physical deletion of financial records. Cancelling an expense excludes
 * it from summaries/reports (see listExpenses/getExpenseSummary and
 * report.service.ts::getExpenseReport/getProfitSummary) without ever
 * removing the row.
 */
export async function setExpenseStatus(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  expenseId: string;
  input: SetExpenseStatusInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, expenseId, input, ipAddress } = params;

  const expense = await Expense.findOne({ _id: expenseId, tenantId });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }

  expense.status = input.status as ExpenseStatus;
  expense.updatedBy = userId;
  await expense.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_STATUS_CHANGED,
    entityType: 'Expense',
    entityId: expense._id,
    changes: { after: { status: input.status } },
    ipAddress,
  });

  return expense;
}

/**
 * Today/this-month/all-time totals, category and payment-method
 * breakdowns, and a previous-month comparison — the numbers the Expenses
 * screen and dashboard cards read directly. Cancelled expenses are always
 * excluded (mirrors listExpenses's default `status=active` filter).
 */
export async function getExpenseSummary(tenantId: Types.ObjectId) {
  const now = new Date();
  const { start: todayStart, end: todayEnd } = dayBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);
  const { start: prevMonthStart, end: prevMonthEnd } = previousMonthBounds(now);

  const activeMatch = { tenantId, status: ExpenseStatus.ACTIVE };

  const [todayAgg, monthAgg, totalAgg, prevMonthAgg, byCategoryAgg, byMethodAgg] =
    await Promise.all([
      Expense.aggregate([
        { $match: { ...activeMatch, expenseDate: { $gte: todayStart, $lt: todayEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: { ...activeMatch, expenseDate: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: activeMatch },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: { ...activeMatch, expenseDate: { $gte: prevMonthStart, $lt: prevMonthEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: activeMatch },
        { $group: { _id: '$categoryId', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        {
          $lookup: {
            from: 'expensecategories',
            localField: '_id',
            foreignField: '_id',
            as: 'category',
          },
        },
        { $unwind: '$category' },
        { $sort: { amount: -1 } },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            categoryName: '$category.name',
            amount: 1,
            count: 1,
          },
        },
      ]),
      Expense.aggregate([
        { $match: activeMatch },
        { $group: { _id: '$paymentMethod', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
        { $project: { _id: 0, paymentMethod: '$_id', amount: 1, count: 1 } },
      ]),
    ]);

  const today = todayAgg[0] ?? { count: 0, amount: 0 };
  const month = monthAgg[0] ?? { count: 0, amount: 0 };
  const total = totalAgg[0] ?? { count: 0, amount: 0 };
  const prevMonth = prevMonthAgg[0] ?? { count: 0, amount: 0 };

  const currentMonthAmount = toNumber(clean(month)?.amount);
  const previousMonthAmount = toNumber(clean(prevMonth)?.amount);
  const change = currentMonthAmount - previousMonthAmount;
  const changePercent =
    previousMonthAmount > 0
      ? (change / previousMonthAmount) * 100
      : currentMonthAmount > 0
        ? 100
        : 0;

  return clean({
    todayExpenses: { count: today.count, amount: today.amount },
    thisMonthExpenses: { count: month.count, amount: month.amount },
    totalExpenses: { count: total.count, amount: total.amount },
    previousMonthComparison: {
      previousMonthAmount,
      currentMonthAmount,
      change,
      changePercent: Math.round(changePercent * 100) / 100,
    },
    expensesByCategory: byCategoryAgg,
    expensesByPaymentMethod: byMethodAgg,
  });
}
