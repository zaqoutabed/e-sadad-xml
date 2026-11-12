const pad = (n: number) => String(n).padStart(2, '0');

/** Local date-time as `YYYY-MM-DDTHH:mm:ss` (the format used in `TmStp`). */
export function formatTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Accepts a `Date` or a string and returns the `YYYY-MM-DDTHH:mm:ss` form. Strings pass through unchanged. */
export function toXmlDate(value: string | Date | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value instanceof Date ? formatTimestamp(value) : value;
}
