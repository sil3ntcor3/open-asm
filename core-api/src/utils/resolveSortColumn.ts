/**
 * Resolves a client-supplied `sortBy` value to a safe, whitelisted column name.
 *
 * TypeORM's `orderBy(column, order)` interpolates the column expression
 * directly into the generated SQL (it does not parameterize it). Passing a raw,
 * user-controlled `sortBy` into `orderBy(`alias.${sortBy}`, ...)` is therefore a
 * SQL-injection sink. Always run untrusted sort fields through this helper.
 *
 * @param sortBy    The raw sort field from the request (may be undefined).
 * @param allowed   The set of column names that are safe to sort by.
 * @param fallback  The column used when `sortBy` is missing or not allowed.
 * @returns A column name guaranteed to be a member of `allowed`.
 */
export function resolveSortColumn<T extends string>(
  sortBy: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (sortBy && (allowed as readonly string[]).includes(sortBy)) {
    return sortBy as T;
  }
  return fallback;
}
