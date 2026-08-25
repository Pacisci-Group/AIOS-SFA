import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

/**
 * Validates and transforms a request value against a zod schema.
 *
 * Applied per-parameter (e.g. `@Query(new ZodValidationPipe(schema))`) so it
 * coexists with the global class-validator `ValidationPipe` without conflict.
 * On failure it throws a 400 with the flattened field/form issues.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
    }
    return result.data;
  }
}
