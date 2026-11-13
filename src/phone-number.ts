const FORMATTING_CHARACTERS = /[\s().,\/-]/gu;

/** Remove human-readable grouping while preserving an optional international + prefix. */
export function normalizePhoneNumber(value: string): string {
  return value.replace(FORMATTING_CHARACTERS, '');
}

export function isDialablePhoneNumber(value: string): boolean {
  return /^\+?\d{3,20}$/.test(value);
}
