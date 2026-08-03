import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/access.decorators';

export function isPublicRoute(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

/**
 * Narrows an untyped route param / query value / header to a usable id. Ids only
 * ever arrive as plain non-empty strings; anything else (an array header, a JSON
 * body operator object) is not an id and yields `undefined`.
 */
export function asIdString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
