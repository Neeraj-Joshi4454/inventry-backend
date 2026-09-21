import type { FilterQuery } from 'mongoose';

/**
 * Builds a safe Mongo filter from raw query-string input by only ever
 * copying values for an explicit field allowlist — user input is never
 * used as an object key, and no Mongo operator ($gt, $where, etc.) can be
 * injected this way, since we only read `req.query[<known field>]` as a
 * plain scalar and place it under an equality (or explicitly-typed) key
 * that WE choose.
 *
 * This deliberately does NOT expose a generic "pass through req.query as a
 * filter" option — that is exactly the unsafe query-builder pattern the
 * architecture forbids.
 */
export function buildAllowedFilter<T>(
  query: Record<string, unknown>,
  allowedFields: readonly (keyof T & string)[]
): FilterQuery<T> {
  const filter: Record<string, unknown> = {};
  for (const field of allowedFields) {
    const value = query[field];
    if (value === undefined || value === null || value === '') continue;
    filter[field] = value;
  }
  return filter as FilterQuery<T>;
}

/**
 * Escapes regex metacharacters so a user-supplied search string can be used
 * safely in a MongoDB $regex without behaving as an unintended pattern
 * (or, worse, a catastrophic-backtracking ReDoS payload).
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" filter for a single field, safe against regex injection. */
export function buildSearchFilter(field: string, term: string | undefined) {
  if (!term) return {};
  return { [field]: { $regex: escapeRegex(term.trim()), $options: 'i' } };
}

/**
 * Validates a requested sort field against an allowlist and returns a
 * Mongoose-compatible sort object. Falls back to `defaultSort` for any
 * unrecognized field, rather than passing the raw string through.
 */
export function buildSortOption(
  sortBy: string | undefined,
  order: string | undefined,
  allowedFields: readonly string[],
  defaultSort: Record<string, 1 | -1>
): Record<string, 1 | -1> {
  if (!sortBy || !allowedFields.includes(sortBy)) return defaultSort;
  return { [sortBy]: order === 'asc' ? 1 : -1 };
}
