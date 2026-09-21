import { Types, type Schema } from 'mongoose';

/**
 * Mongoose serializes `Decimal128` fields to `{ "$numberDecimal": "123.45" }`
 * when a document is JSON-stringified (e.g. by `res.json()`) — there is no
 * built-in option to make it emit a plain number instead. Left unfixed,
 * every money field in every API response (Product prices, Purchase/Sale
 * totals and line items, Customer/Supplier balances) comes back as that
 * nested object instead of a number a client can just read or do math on.
 *
 * Applied per-schema (rather than once globally via `mongoose.plugin()`)
 * because a global plugin only affects schemas *compiled after* the call —
 * a fragile thing to depend on given models are pulled in via scattered
 * imports. This walks the whole serialized object recursively, so nested
 * subdocuments/arrays are covered too.
 */
export function applyDecimalToJson(schema: Schema): void {
  schema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => convertDecimals(ret),
  });
}

/**
 * Exported separately from applyDecimalToJson for raw aggregation results
 * (Model.aggregate(...)) — those are plain JS objects, not Mongoose
 * documents, so a schema's `toJSON` transform never runs on them. Any
 * report/service that sums/reads Decimal128 fields via $group or $project
 * must run its result through this before sending it in a response.
 */
export function convertDecimals(value: unknown): unknown {
  if (value instanceof Types.Decimal128) {
    return Number(value.toString());
  }
  if (Array.isArray(value)) {
    return value.map(convertDecimals);
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      (value as Record<string, unknown>)[key] = convertDecimals(
        (value as Record<string, unknown>)[key]
      );
    }
  }
  return value;
}
