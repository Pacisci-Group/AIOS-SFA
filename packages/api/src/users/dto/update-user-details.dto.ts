import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';
import {
  allstateBindIdField,
  allstateSubProducerCodeField,
} from './allstate-codes.dto';

/**
 * `PATCH /users/:userId/details` — the owner corrects someone's name or
 * Allstate codes (PAC-173). Every field is `clearable`: a value sets, `null`
 * or `''` clears, absent leaves it.
 */
export const updateUserDetailsSchema = z.object({
  firstName: clearable(trimmedText(100)),
  lastName: clearable(trimmedText(100)),
  allstateBindId: clearable(allstateBindIdField),
  allstateSubProducerCode: clearable(allstateSubProducerCodeField),
});
export type UpdateUserDetailsDto = z.infer<typeof updateUserDetailsSchema>;
