import { HOUSEHOLD_ADDRESS_LABEL_MAX } from '@sfa/shared';
import { z } from 'zod';

const required = (max: number) => z.string().trim().min(1, 'Required').max(max);

/**
 * `POST /households/:id/addresses` — add an address to the household's book,
 * optionally as its new primary.
 *
 * The four parts are required, matching the New Lead form's household address
 * rather than `create-lead.dto.ts`'s lax one: that DTO is lax because a public
 * submission that still identifies a person is worth more than a 400, whereas
 * this is a service rep typing the address the client just gave them. The
 * lengths are the lead DTO's, so an address that fits one fits the other.
 *
 * A blank `street2` / `label` is the same as an absent one.
 */
export const addHouseholdAddressSchema = z.object({
  street: required(200),
  street2: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((value) => value || null),
  city: required(120),
  state: required(60),
  zip: required(20),
  label: z
    .string()
    .trim()
    .max(HOUSEHOLD_ADDRESS_LABEL_MAX)
    .nullable()
    .optional()
    .transform((value) => value || null),
  makePrimary: z.boolean(),
});

export type AddHouseholdAddressDto = z.infer<typeof addHouseholdAddressSchema>;
