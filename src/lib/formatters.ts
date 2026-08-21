export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatSSN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length < 4) return digits;
  if (digits.length < 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function sanitizeFolderSegment(raw: string): string {
  return raw.replace(/[/\\]/g, '').trim();
}

// Displays a DOB in MM-DD-YYYY. Input comes from an HTML <input type="date">
// field, so it arrives as YYYY-MM-DD (or empty) — this is a display-only
// reformat and does NOT change how DOB is stored or parsed anywhere else
// (database, W-4 autofill, etc. all keep using the raw YYYY-MM-DD value).
export function formatDobDisplay(raw: string): string {
  if (!raw) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const [, yyyy, mm, dd] = match;
  return `${mm}-${dd}-${yyyy}`;
}
