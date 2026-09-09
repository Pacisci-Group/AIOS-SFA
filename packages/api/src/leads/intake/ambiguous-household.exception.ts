import { ConflictException } from '@nestjs/common';
import type { AmbiguousHouseholdCandidate } from '@sfa/shared';
import { AMBIGUOUS_HOUSEHOLD_CODE } from '@sfa/shared';

/**
 * The submitter belongs to several households and named none of them
 * (PAC-91 §5).
 *
 * Membership is many-to-many, so "the contact's household" stopped being a
 * lookup. The old single `Contact.householdId` answered it by holding whichever
 * household was linked *last* — an arbitrary choice, made silently, on a record
 * that determines which policies and which producer a new inquiry lands
 * against. Guessing there is worse than failing there, so this asks.
 *
 * A 409 rather than a 400: the request is well-formed and nothing about it is
 * wrong. It carries the candidates so the authenticated New Lead form can show
 * a chooser and resubmit with `householdId` pinned, which is the one way the
 * household gets decided rather than inferred.
 *
 * ⚠ The **public** share-link path cannot pin a household (`householdId` is not
 * in `publicCreateLeadSchema`, deliberately — a public body must never choose
 * the household it lands in), so a public submission from a multi-household
 * contact fails here and needs the office to log it. That is rare by
 * construction — 14 of 3,082 contacts on the 2026-09-04 production data belong
 * to more than one household — and the alternative is filing an inquiry against
 * the wrong household's policies without anybody knowing.
 */
export class AmbiguousHouseholdException extends ConflictException {
  constructor(contactId: string, households: AmbiguousHouseholdCandidate[]) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: AMBIGUOUS_HOUSEHOLD_CODE,
      message:
        'This person belongs to more than one household. Choose which one ' +
        'this lead belongs to and submit again.',
      contactId,
      households,
    });
  }
}
