import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

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
