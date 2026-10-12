import { BadRequestException } from '@nestjs/common';
import {
  assertNotAfter,
  assertNotBefore,
  assertNotInFuture,
} from './business-date-rules';
import { businessDateInstant } from './business-dates';

const CHICAGO = 'America/Chicago';
const on = (iso: string) => businessDateInstant(iso, CHICAGO);

describe('business date rules (PAC-159 §1b)', () => {
  describe('assertNotInFuture', () => {
    // 01:00Z on Aug 6 is still Aug 5 in Chicago.
    const now = new Date('2026-08-06T01:00:00.000Z');

    it('accepts today on the agency calendar and anything earlier', () => {
      expect(() =>
        assertNotInFuture('Sold date', '2026-08-05', CHICAGO, now),
      ).not.toThrow();
      expect(() =>
        assertNotInFuture('Sold date', '2020-01-01', CHICAGO, now),
      ).not.toThrow();
    });

    it('rejects tomorrow — which is today in UTC', () => {
      expect(() =>
        assertNotInFuture('Quote date', '2026-08-06', CHICAGO, now),
      ).toThrow(new BadRequestException('Quote date cannot be in the future'));
    });
  });

  describe('assertNotBefore', () => {
    const quoted = on('2026-05-10');

    it('allows the same day and later', () => {
      expect(() =>
        assertNotBefore(
          'Sold date',
          '2026-05-10',
          quoted,
          'the quote date',
          CHICAGO,
        ),
      ).not.toThrow();
      expect(() =>
        assertNotBefore(
          'Sold date',
          '2026-05-11',
          quoted,
          'the quote date',
          CHICAGO,
        ),
      ).not.toThrow();
    });

    it('rejects an earlier day, naming the floor', () => {
      expect(() =>
        assertNotBefore(
          'Sold date',
          '2026-05-09',
          quoted,
          'the quote date',
          CHICAGO,
        ),
      ).toThrow(
        new BadRequestException(
          'Sold date cannot be before the quote date (2026-05-10)',
        ),
      );
    });

    it('compares agency days, not instants', () => {
      // 23:30 CDT on May 10, which is already May 11 in UTC.
      const lateQuote = new Date('2026-05-11T04:30:00.000Z');
      expect(() =>
        assertNotBefore(
          'Sold date',
          '2026-05-10',
          lateQuote,
          'the quote date',
          CHICAGO,
        ),
      ).not.toThrow();
    });

    it('bounds nothing without a floor', () => {
      expect(() =>
        assertNotBefore(
          'Sold date',
          '2000-01-01',
          null,
          'the quote date',
          CHICAGO,
        ),
      ).not.toThrow();
    });
  });

  describe('assertNotAfter', () => {
    const sold = on('2026-05-20');

    it('allows the same day and earlier, rejects later', () => {
      expect(() =>
        assertNotAfter(
          'Quote date',
          '2026-05-20',
          sold,
          'the sale it was sold on',
          CHICAGO,
        ),
      ).not.toThrow();
      expect(() =>
        assertNotAfter(
          'Quote date',
          '2026-05-21',
          sold,
          'the sale it was sold on',
          CHICAGO,
        ),
      ).toThrow(
        new BadRequestException(
          'Quote date cannot be after the sale it was sold on (2026-05-20)',
        ),
      );
      expect(() =>
        assertNotAfter('Quote date', '2026-05-21', undefined, 'x', CHICAGO),
      ).not.toThrow();
    });
  });
});
