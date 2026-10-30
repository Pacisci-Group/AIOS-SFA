import { ConflictException } from '@nestjs/common';
import {
  ALLSTATE_CODE_DUPLICATE,
  ALLSTATE_CODE_FIELDS,
  ALLSTATE_CODE_LABELS,
  normalizeBindId,
  normalizeSubProducerCode,
  type AllstateCodeField,
} from '@sfa/shared';
import type { Model } from 'mongoose';
import { displayName } from '../common/domain/user-names';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key';
import type { UserDocument } from './schemas/user.schema';

/**
 * A user's Allstate codes (PAC-173) as a write path receives them: a value
 * sets, `null` or `''` clears, absent leaves the stored value alone. The DTOs
 * have already refused a malformed code (`dto/allstate-codes.dto.ts`); this
 * file only normalises and reports clashes, so every path — invite, accept,
 * profile, the owner's edit, agency onboarding — stores the same spelling and
 * answers a clash the same way.
 */
export type AllstateCodesInput = Partial<
  Record<AllstateCodeField, string | null>
>;

/** The stored value, or `undefined` for a blank (the field is then unset). */
function normalized(
  field: AllstateCodeField,
  value: string,
): string | undefined {
  const code =
    field === 'allstateBindId'
      ? normalizeBindId(value)
      : normalizeSubProducerCode(value);
  return code ?? undefined;
}

/** The codes to store on a new user — blanks left off the document. */
export function allstateCodesForInsert(
  input: AllstateCodesInput,
): Partial<Record<AllstateCodeField, string>> {
  const codes: Partial<Record<AllstateCodeField, string>> = {};
  for (const field of ALLSTATE_CODE_FIELDS) {
    const value = input[field];
    const code = value ? normalized(field, value) : undefined;
    if (code) codes[field] = code;
  }
  return codes;
}

/**
 * Apply the sent codes to a loaded user. Clearing assigns `undefined`, which
 * Mongoose saves as `$unset` — the unique indexes are partial on the field
 * being a string, so an absent code never collides.
 */
export function applyAllstateCodes(
  user: UserDocument,
  input: AllstateCodesInput,
): void {
  for (const field of ALLSTATE_CODE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    user[field] = value ? normalized(field, value) : undefined;
  }
}

/**
 * A 409 naming who already holds the code, when `error` is a clash on one of
 * the two code indexes; `null` for any other error, which the caller rethrows.
 *
 * Read off the error's `keyValue` rather than pre-checked, so two owners
 * saving the same code at once cannot both succeed.
 */
export async function allstateCodeConflict(
  error: unknown,
  userModel: Model<UserDocument>,
): Promise<ConflictException | null> {
  if (!isDuplicateKeyError(error)) return null;
  const keyValue = (error as { keyValue?: Record<string, unknown> }).keyValue;
  const field = ALLSTATE_CODE_FIELDS.find(
    (candidate) => keyValue && candidate in keyValue,
  );
  if (!field || !keyValue) return null;

  const code = String(keyValue[field]);
  const holder = await userModel
    .findOne(
      { agencyId: keyValue.agencyId, [field]: code },
      { firstName: 1, lastName: 1, email: 1 },
    )
    .lean<{ firstName?: string; lastName?: string; email: string }>();
  return new ConflictException({
    code: ALLSTATE_CODE_DUPLICATE,
    field,
    message: `${ALLSTATE_CODE_LABELS[field]} ${code} is already on ${holder ? displayName(holder) : 'another user'}.`,
  });
}
