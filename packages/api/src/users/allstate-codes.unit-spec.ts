import { ConflictException } from '@nestjs/common';
import { ALLSTATE_CODE_DUPLICATE } from '@sfa/shared';
import type { Model } from 'mongoose';
import {
  allstateCodeConflict,
  allstateCodesForInsert,
  applyAllstateCodes,
} from './allstate-codes';
import type { UserDocument } from './schemas/user.schema';

describe('allstateCodesForInsert', () => {
  it('normalises what was typed and leaves blanks off', () => {
    expect(
      allstateCodesForInsert({
        allstateBindId: ' sok5pe0t ',
        allstateSubProducerCode: '34',
      }),
    ).toEqual({ allstateBindId: 'SOK5PE0T', allstateSubProducerCode: '034' });
    expect(
      allstateCodesForInsert({
        allstateBindId: '',
        allstateSubProducerCode: null,
      }),
    ).toEqual({});
  });
});

describe('applyAllstateCodes', () => {
  const user = () =>
    ({
      allstateBindId: 'SOKOLD01',
      allstateSubProducerCode: '011',
    }) as UserDocument;

  it('sets a sent code, clears a null or blank one, and leaves an absent one', () => {
    const target = user();
    applyAllstateCodes(target, { allstateBindId: 'sok5pe0t' });
    expect(target.allstateBindId).toBe('SOK5PE0T');
    expect(target.allstateSubProducerCode).toBe('011');

    applyAllstateCodes(target, {
      allstateBindId: null,
      allstateSubProducerCode: '',
    });
    expect(target.allstateBindId).toBeUndefined();
    expect(target.allstateSubProducerCode).toBeUndefined();
  });
});

describe('allstateCodeConflict', () => {
  const holder = { firstName: 'Jessica', lastName: 'Yates', email: 'j@x.test' };
  const userModel = {
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(holder) })),
  } as unknown as Model<UserDocument>;

  it('names who already holds the code', async () => {
    const error = Object.assign(new Error('E11000'), {
      code: 11000,
      keyValue: { agencyId: 'a1', allstateBindId: 'SOK5PE0T' },
    });
    const conflict = await allstateCodeConflict(error, userModel);
    expect(conflict).toBeInstanceOf(ConflictException);
    expect(conflict?.getResponse()).toEqual({
      code: ALLSTATE_CODE_DUPLICATE,
      field: 'allstateBindId',
      message: 'Allstate Bind ID SOK5PE0T is already on Jessica Yates.',
    });
  });

  it('passes on any other error, duplicate keys on other indexes included', async () => {
    expect(await allstateCodeConflict(new Error('boom'), userModel)).toBeNull();
    const email = Object.assign(new Error('E11000'), {
      code: 11000,
      keyValue: { email: 'j@x.test' },
    });
    expect(await allstateCodeConflict(email, userModel)).toBeNull();
  });
});
