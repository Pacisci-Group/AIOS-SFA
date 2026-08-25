import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { mongo } from 'mongoose';

/** Mongo's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * Turns a Mongo duplicate-key violation into a 409 instead of a 500.
 *
 * Without this an E11000 escapes to the default handler, so the caller gets an
 * opaque "Internal server error" and the driver's raw message — which echoes
 * the *stored values* that collided — lands in the logs. A duplicate is a
 * conflict the caller can act on, not a server fault.
 *
 * The response names the fields that collided and never the values: `keyValue`
 * contains real record data, so it stays server-side.
 *
 * `mongo.MongoServerError` is reached through Mongoose rather than by importing
 * `mongodb` directly — the driver is a transitive dependency here, not a
 * declared one.
 */
@Catch(mongo.MongoServerError)
export class MongoDuplicateKeyFilter implements ExceptionFilter {
  private readonly logger = new Logger(MongoDuplicateKeyFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: mongo.MongoServerError, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;

    // Any other server error is not ours to translate — hand it back to the
    // default handler rather than dressing it up as a conflict.
    if (exception.code !== DUPLICATE_KEY) {
      throw exception;
    }

    // `keyPattern` is loosely typed on the driver error; its keys are always
    // the plain field names of the violated index.
    const keyPattern = (exception.keyPattern ?? {}) as Record<string, unknown>;
    const fields = Object.keys(keyPattern);
    const { url = '' } = host.switchToHttp().getRequest<{ url?: string }>();

    this.logger.warn(
      `Duplicate key on ${fields.join(' + ') || 'unknown index'} (${url})`,
    );

    httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode: 409,
        error: 'Conflict',
        message: fields.length
          ? `A record with this ${fields.join(' + ')} already exists.`
          : 'A record with these details already exists.',
      },
      409,
    );
  }
}
