import { z } from 'zod';
import { isIanaTimeZone } from './time-zones';

/**
 * The shape of an IANA zone name as the API accepts it on a write (PAC-141).
 *
 * `Area/Location` with optional further segments (`America/Argentina/Buenos_Aires`),
 * or a single word (`UTC`). The leading-letter rule is what refuses a raw
 * offset such as `+05:30`: the runtime would resolve one, but it is not a
 * zone — it has no DST and no history — and the picker never offers one.
 *
 * `isIanaTimeZone` then asks the runtime. What the runtime accepts is not
 * necessarily what MongoDB accepts, so every write path also runs
 * `assertMongoKnowsTimeZone` before saving; this schema is the cheap half.
 */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, 'Choose a time zone.')
  .max(64, 'Not a time zone name.')
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/, {
    message: 'Not a time zone name — use an IANA name such as America/Chicago.',
  })
  .refine(isIanaTimeZone, {
    message: 'Unknown time zone — use an IANA name such as America/Chicago.',
  });
