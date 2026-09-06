import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import { ObjectIdType } from './object-id';

const SRC = join(__dirname, '..', '..');

function schemaFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) schemaFiles(full, out);
    else if (entry.endsWith('.schema.ts')) out.push(full);
  }
  return out;
}

describe('ObjectIdType', () => {
  /*
   * The canary for the whole trap: `@Prop({ type: Types.ObjectId })` silently
   * yields a **Mixed** path under `SchemaFactory`, and `ObjectIdType` is the
   * form that does not. Both halves are asserted so this fails loudly if a
   * future `@nestjs/mongoose` changes either behaviour — including the happy
   * case where the broken form starts working and this indirection can go.
   */
  it('produces an ObjectId path where the bson class produces Mixed', () => {
    @Schema()
    class Correct {
      @Prop({ type: ObjectIdType, ref: 'User' })
      userId: Types.ObjectId;
    }

    @Schema()
    class Trap {
      @Prop({ type: Types.ObjectId, ref: 'User' })
      userId: Types.ObjectId;
    }

    expect(SchemaFactory.createForClass(Correct).path('userId').instance).toBe(
      'ObjectId',
    );
    expect(SchemaFactory.createForClass(Trap).path('userId').instance).toBe(
      'Mixed',
    );
  });

  it('casts a 24-hex string rather than storing it verbatim', () => {
    @Schema()
    class Linked {
      @Prop({ type: ObjectIdType })
      userId: Types.ObjectId;
    }

    const id = '507f1f77bcf86cd799439011';
    const cast = SchemaFactory.createForClass(Linked)
      .path('userId')
      .cast(id) as Types.ObjectId;

    expect(cast).toBeInstanceOf(Types.ObjectId);
    expect(String(cast)).toBe(id);
  });

  /*
   * A grep, not a schema walk, because the point is to catch the *source*
   * pattern the moment someone reaches for the obvious import — before it
   * reaches a database and turns into rows nothing can query.
   */
  it('is the only ObjectId schema type used across the API schemas', () => {
    const offenders = schemaFiles(SRC).filter((file) =>
      /type: Types\.ObjectId\b/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders.map((f) => f.replace(SRC + '/', ''))).toEqual([]);
  });
});
