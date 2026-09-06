import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `class-transformer` types `TransformFnParams.value` as `any`, so an inline
 * arrow returning it trips `no-unsafe-return`. Narrowing to `unknown` at the
 * boundary keeps the lint honest; the `@Is*` decorators assert the type.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class LoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;
}

export class RefreshTokenDto {
  @IsNotEmpty()
  refreshToken: string;
}

export class AcceptInviteDto {
  @IsNotEmpty()
  token: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;

  /**
   * Optional name corrections (PAC-69).
   *
   * The invitee's names are already on the record — the inviter typed them —
   * and the onboarding wizard shows them prefilled so they can be fixed before
   * the account goes live. Optional because the accept-invite page shipped
   * without them and an older client sends neither; absent means "leave what is
   * there", which is not the same as clearing it.
   */
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

/**
 * `POST /auth/reset-password`. A twin of {@link AcceptInviteDto} — same shape,
 * same 8-character floor, different token namespace.
 *
 * Must stay a real class rather than an inline body type: the global
 * `ValidationPipe` runs `whitelist` + `forbidNonWhitelisted` off the DTO's
 * metadata, and an inline type gets no validation at all on an unauthenticated
 * route.
 */
export class ResetPasswordDto {
  @IsNotEmpty()
  token: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;
}

/**
 * `POST /auth/change-password` (PAC-81). Only the new password carries the
 * 8-character floor — the current one is whatever it is, and a length rule on
 * it would lock out anyone whose password predates the rule.
 */
export class ChangePasswordDto {
  @IsNotEmpty()
  currentPassword: string;

  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

/** `POST /auth/forgot-password` (PAC-81) — public, so validation is the only gate. */
export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}
