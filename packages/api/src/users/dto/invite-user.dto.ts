import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `class-transformer` types `TransformFnParams.value` as `any`, so an inline
 * arrow returning it trips `no-unsafe-return`. Narrowing to `unknown` at the
 * boundary keeps the lint honest without an escape hatch — the `@Is*` decorator
 * below each one is what actually asserts the type.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * `POST /users/invite` body.
 *
 * Before PAC-58 this route took an inline body type, which meant the global
 * `ValidationPipe` had nothing to validate against — any shape reached the
 * service and `roleIds` went straight into `new Types.ObjectId(...)`, turning a
 * typo into a 500. A real DTO is what makes the email/role rules enforceable.
 *
 * `firstName` / `lastName` stay **optional here** even though the invite form
 * marks them required. The form is the place that rule belongs (PAC-58 Scope 3);
 * the API also serves the seed and the SmartSuite migration, which create users
 * whose legacy records carry no split name.
 */
export class InviteUserDto {
  /**
   * Lowercased here rather than only in the service, so the uniqueness check and
   * the stored value can never disagree about casing.
   */
  @IsEmail()
  @Transform(trimLower)
  email: string;

  /**
   * The invite UI assigns exactly one role (PAC-58 decision), but the contract
   * stays an array: role assignment is already many-per-user elsewhere
   * (`PATCH /users/:userId/roles`), and narrowing it here would make the two
   * endpoints disagree.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one role is required' })
  @IsMongoId({ each: true, message: 'Each role must be a valid id' })
  roleIds: string[];

  @IsOptional()
  @IsMongoId({ message: 'branchId must be a valid id' })
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  lastName?: string;
}
