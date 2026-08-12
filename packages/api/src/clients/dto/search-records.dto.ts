import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Query for the household / policy typeahead endpoints. */
export class SearchRecordsQueryDto {
  /** Free-text term. Omitted or blank returns the first page unfiltered. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * Policy search only: restrict results to one household's policies.
   *
   * Used by the New Ticket dialog opened from a household page, where offering
   * the whole agency's book would let a CSR file a ticket against a policy
   * belonging to a different client. Ignored by the household search.
   */
  @IsOptional()
  @IsMongoId()
  householdId?: string;
}
