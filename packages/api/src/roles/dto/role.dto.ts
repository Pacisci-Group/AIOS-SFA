import { DataScope } from '@sfa/shared';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  /**
   * Defaults to `own` — the narrowest. A new role that silently saw the whole
   * agency would be the wrong direction for this to fail in.
   */
  @IsOptional()
  @IsEnum(DataScope)
  dataScope?: DataScope;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsOptional()
  @IsEnum(DataScope)
  dataScope?: DataScope;
}
