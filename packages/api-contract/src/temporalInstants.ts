import { z } from "zod";

/** PostgreSQL's exact timestamp precision. Additional trailing zeroes are exact. */
export const exactInstantSchema = z
  .string()
  .datetime({ offset: true })
  .regex(
    /^(?!.*\.\d{6}\d*[1-9])/,
    "An instant must be representable at microsecond precision.",
  )
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }, "An instant must stay within years 0001–9999 in UTC.")
  .describe(
    "A timezone-qualified instant exact to six fractional digits, with UTC year 0001–9999. Additional fractional zeros are allowed.",
  );

/** Keep the established millisecond spelling unless additional precision exists. */
export function normalizeInstant(value: Date | string): string {
  const iso = new Date(value).toISOString();
  if (value instanceof Date) return iso;
  const fraction = /\.(\d+)(?=Z|[+-])/.exec(value)?.[1] ?? "";
  if (/[1-9]/.test(fraction.slice(6)))
    throw new RangeError("Instant exceeds microsecond precision.");
  const precise = fraction
    .slice(0, 6)
    .padEnd(3, "0")
    .replace(/0+$/, "")
    .padEnd(3, "0");
  return `${iso.slice(0, -4)}${precise}Z`;
}

export function instantMicroseconds(value: Date | string): bigint {
  const normalized = normalizeInstant(value);
  const fraction = /\.(\d+)Z$/.exec(normalized)![1]!.padEnd(6, "0");
  return BigInt(Date.parse(normalized)) * 1000n + BigInt(fraction.slice(3));
}

export function compareInstants(
  left: Date | string,
  right: Date | string,
): number {
  const a = instantMicroseconds(left),
    b = instantMicroseconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
