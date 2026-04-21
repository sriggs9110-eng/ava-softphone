/**
 * Render a phone number in the rep's reading-voice format.
 *   +12514425572  →  (251) 442-5572
 *   12514425572   →  (251) 442-5572
 *   2514425572    →  (251) 442-5572
 *   anything else →  returned unchanged (best-effort)
 *
 * Non-NANP numbers (digit count outside 10 or 11) fall back to the raw
 * string so we don't mangle international numbers.
 */
export function formatUSPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
      ? digits
      : null;
  if (!ten) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
