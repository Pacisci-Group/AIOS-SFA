import {
  ALLSTATE_BIND_ID_MAX_LENGTH,
  bindIdError,
  subProducerCodeError,
} from '@sfa/shared';
import { ValidateBy } from 'class-validator';
import { z } from 'zod';

/**
 * The two Allstate codes (PAC-173) as every DTO validates them. The rules are
 * `@sfa/shared`'s, so the web form and the API refuse the same values;
 * normalising (upper-case, zero-pad) happens in `users/allstate-codes.ts`,
 * after validation, so an error names the value the caller typed.
 *
 * A blank passes: on a create it means "none", on an edit it clears.
 */
const checked = (
  problem: (value: string) => string | null,
  max: number,
): z.ZodType<string> =>
  z
    .string()
    .trim()
    .max(max)
    .superRefine((value, ctx) => {
      const message = problem(value);
      if (message) ctx.addIssue({ code: 'custom', message });
    });

/** zod fragments, for the zod DTOs (profile, the owner's edit, onboarding). */
export const allstateBindIdField = checked(
  bindIdError,
  ALLSTATE_BIND_ID_MAX_LENGTH,
);
export const allstateSubProducerCodeField = checked(subProducerCodeError, 3);

/** class-validator twins, for the class DTOs (invite, accept invite). */
export function IsAllstateBindId(): PropertyDecorator {
  return ValidateBy({
    name: 'isAllstateBindId',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && !bindIdError(value),
      defaultMessage: (args) =>
        (typeof args?.value === 'string' && bindIdError(args.value)) ||
        'allstateBindId must be a string',
    },
  });
}

export function IsAllstateSubProducerCode(): PropertyDecorator {
  return ValidateBy({
    name: 'isAllstateSubProducerCode',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && !subProducerCodeError(value),
      defaultMessage: (args) =>
        (typeof args?.value === 'string' && subProducerCodeError(args.value)) ||
        'allstateSubProducerCode must be a string',
    },
  });
}
