import { BadRequestException } from '@nestjs/common';
import type { Connection } from 'mongoose';

/** MongoDB's code for `$dateToString` given a zone its table does not hold. */
const UNRECOGNIZED_TIME_ZONE = 40485;

/**
 * Ask MongoDB whether it can format a date in `timeZone` (PAC-141).
 *
 * Two zone tables are in play. Node resolves names through ICU, which is
 * what `isIanaTimeZone` consults; the Owner and Manager dashboards format lead
 * creation dates **inside Mongo** (`leadCreatedYmdExpr` → `$dateToString`),
 * which consults the server's own bundled tzdata. The two disagree at the
 * edges — ICU is case-insensitive where Mongo is not, accepts abbreviations
 * such as `EST`, and may know a zone renamed or added after the server's
 * table was cut. A name that passes the first and fails the second would be
 * stored fine and then 500 every Owner and Manager page for that agency.
 *
 * So the write paths — onboarding and the agency profile — probe the server
 * once before saving: a one-document aggregate that does nothing but format
 * `$$NOW` in the zone. A rejection becomes a 400 at the moment of choice.
 */
export async function assertMongoKnowsTimeZone(
  connection: Connection,
  timeZone: string,
): Promise<void> {
  const db = connection.db;
  if (!db) {
    throw new Error(
      'Mongo connection is not open; cannot validate a time zone.',
    );
  }
  try {
    await db
      .aggregate([
        { $documents: [{}] },
        {
          $project: {
            ok: { $dateToString: { date: '$$NOW', timezone: timeZone } },
          },
        },
      ])
      .toArray();
  } catch (error) {
    if ((error as { code?: number }).code === UNRECOGNIZED_TIME_ZONE) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          fieldErrors: {
            timezone: [
              `The database does not recognise the time zone ${timeZone}. Choose one from the list.`,
            ],
          },
        },
      });
    }
    throw error;
  }
}
