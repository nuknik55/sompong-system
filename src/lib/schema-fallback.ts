/**
 * A read of a view or table the database does not have YET: PostgREST's
 * "Could not find the table ... in the schema cache" (PGRST205), or Postgres's
 * undefined table (42P01). Code that reads a view a migration adds uses it to
 * fall back to the old read until the migration has run, so the code can ship
 * first. Deliberately NOT a missing column (42703): that is a real error.
 */
export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table/i.test(error.message ?? "");
}

/**
 * A read that names a column a migration adds, before the migration has run:
 * Postgres's undefined column (42703) naming THAT column. Any other missing
 * column stays a real error.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error || error.code !== "42703") return false;
  return (error.message ?? "").includes(column);
}
