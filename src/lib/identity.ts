/**
 * Lets staff log in with a plain username instead of a real email address.
 * If what's typed already looks like an email, use it as-is (so the
 * original owner account with a real Gmail address keeps working).
 * Otherwise treat it as a username and map it to a synthetic address.
 */
export function toAuthEmail(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.toLowerCase().replace(/\s+/g, "")}@staff.local`;
}

/** For display: hide the synthetic domain so usernames don't look like fake emails. */
export function displayIdentity(email: string): string {
  return email.endsWith("@staff.local") ? email.slice(0, -"@staff.local".length) : email;
}
