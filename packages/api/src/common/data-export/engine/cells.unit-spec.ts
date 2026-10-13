import { Types } from 'mongoose';
import { agencyCalendarDate, csvCell, xlsxCell, ymdDate } from './cells';

describe('data export cells', () => {
  const id = new Types.ObjectId('64b7f0c2a1b2c3d4e5f60718');

  describe('csvCell', () => {
    it('renders a missing value as an empty field, never "null"', () => {
      for (const type of [
        'string',
        'number',
        'boolean',
        'date',
        'datetime',
        'id',
        'list',
      ] as const) {
        expect(csvCell(null, type)).toBe('');
        expect(csvCell(undefined, type)).toBe('');
      }
    });

    it('writes a date as YYYY-MM-DD and a datetime as ISO UTC', () => {
      const at = new Date('2026-03-05T14:30:00.000Z');
      expect(csvCell(at, 'date')).toBe('2026-03-05');
      expect(csvCell(at, 'datetime')).toBe('2026-03-05T14:30:00.000Z');
    });

    it('writes an ObjectId as its hex string', () => {
      expect(csvCell(id, 'id')).toBe('64b7f0c2a1b2c3d4e5f60718');
    });

    it('keeps numbers and booleans typed, dropping a non-finite number', () => {
      expect(csvCell(1234.5, 'number')).toBe(1234.5);
      expect(csvCell(-50, 'number')).toBe(-50);
      expect(csvCell(Number.NaN, 'number')).toBe('');
      // Words, not csv-stringify's 1 / empty: false must not read as missing.
      expect(csvCell(false, 'boolean')).toBe('false');
      expect(csvCell(true, 'boolean')).toBe('true');
    });

    it('joins a list and keeps blank items, so aligned lists stay aligned', () => {
      expect(csvCell(['Ann', '', 'Bo'], 'list')).toBe('Ann; ; Bo');
      expect(csvCell([id, null], 'list')).toBe('64b7f0c2a1b2c3d4e5f60718; ');
      expect(csvCell([], 'list')).toBe('');
    });
  });

  describe('xlsxCell', () => {
    it('gives dates as Date cells and numbers as numbers', () => {
      const at = new Date('2026-03-05T00:00:00.000Z');
      expect(xlsxCell(at, 'date')).toEqual(at);
      expect(xlsxCell(42, 'number')).toBe(42);
    });

    it('gives ids as text, so a leading zero survives', () => {
      expect(xlsxCell('00123', 'id')).toBe('00123');
      expect(xlsxCell(id, 'id')).toBe('64b7f0c2a1b2c3d4e5f60718');
    });

    it('gives a missing value as an empty cell', () => {
      expect(xlsxCell(null, 'string')).toBeNull();
      expect(xlsxCell('', 'string')).toBeNull();
    });
  });

  describe('ymdDate', () => {
    it('turns YYYYMMDD into that UTC midnight', () => {
      expect(ymdDate(20240229)?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
      expect(ymdDate(undefined)).toBeNull();
    });
  });

  describe('agencyCalendarDate', () => {
    it("cuts a real instant on the agency's calendar", () => {
      // 02:00 UTC on the 6th is still the 5th in Chicago.
      const instant = new Date('2026-10-06T02:00:00.000Z');
      expect(
        agencyCalendarDate(instant, 'America/Chicago')?.toISOString(),
      ).toBe('2026-10-05T00:00:00.000Z');
    });

    it('reads a UTC-midnight value as the date it names (migrated date-only fields)', () => {
      const migrated = new Date('2026-06-01T00:00:00.000Z');
      expect(
        agencyCalendarDate(migrated, 'America/Chicago')?.toISOString(),
      ).toBe('2026-06-01T00:00:00.000Z');
    });
  });
});
