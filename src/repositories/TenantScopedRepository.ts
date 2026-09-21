import type {
  ClientSession,
  FilterQuery,
  Model,
  ProjectionType,
  QueryOptions,
  Types,
  UpdateQuery,
} from 'mongoose';
import { NotFoundError } from '../utils/errors';

/**
 * Wraps a Mongoose model so every query is force-scoped to a single tenant.
 * This exists so tenant isolation does not depend on every controller
 * remembering to add `{ tenantId }` by hand — the filter is merged in here,
 * once, for every read/write path.
 *
 * Usage:
 *   const repo = new TenantScopedRepository(Product, req.user.tenantId);
 *   await repo.find({ isActive: true });
 */
export class TenantScopedRepository<T extends { tenantId: Types.ObjectId }> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly tenantId: Types.ObjectId
  ) {}

  private scoped(filter: FilterQuery<T> = {}): FilterQuery<T> {
    return { ...filter, tenantId: this.tenantId } as FilterQuery<T>;
  }

  find(filter: FilterQuery<T> = {}, projection?: ProjectionType<T>, options?: QueryOptions<T>) {
    return this.model.find(this.scoped(filter), projection, options);
  }

  findOne(filter: FilterQuery<T> = {}, projection?: ProjectionType<T>, options?: QueryOptions<T>) {
    return this.model.findOne(this.scoped(filter), projection, options);
  }

  async findByIdOrThrow(id: Types.ObjectId | string, projection?: ProjectionType<T>) {
    const doc = await this.model.findOne(this.scoped({ _id: id } as FilterQuery<T>), projection);
    if (!doc) {
      throw new NotFoundError(`${this.model.modelName} not found`);
    }
    return doc;
  }

  create(doc: Partial<T>, options?: { session?: ClientSession }) {
    return this.model
      .create([{ ...doc, tenantId: this.tenantId }], options)
      .then((docs) => docs[0]);
  }

  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: { session?: ClientSession }) {
    return this.model.updateOne(this.scoped(filter), update, options ?? {});
  }

  async findByIdAndUpdateOrThrow(
    id: Types.ObjectId | string,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>
  ) {
    const doc = await this.model.findOneAndUpdate(
      this.scoped({ _id: id } as FilterQuery<T>),
      update,
      { new: true, ...options }
    );
    if (!doc) {
      throw new NotFoundError(`${this.model.modelName} not found`);
    }
    return doc;
  }

  countDocuments(filter: FilterQuery<T> = {}) {
    return this.model.countDocuments(this.scoped(filter));
  }
}

/**
 * Defense-in-depth check for mutation paths that fetch a document by a raw id
 * (e.g. from a URL param) before writing to it — guards against IDOR where a
 * valid ObjectId belonging to another tenant is guessed/passed.
 */
export function assertSameTenant(
  docTenantId: Types.ObjectId,
  requestTenantId: Types.ObjectId,
  entityName = 'Resource'
): void {
  if (!docTenantId.equals(requestTenantId)) {
    throw new NotFoundError(`${entityName} not found`);
  }
}
