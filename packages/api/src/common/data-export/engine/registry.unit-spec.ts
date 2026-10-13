import { DATA_EXPORT_DATASET_KEYS } from '@sfa/shared';
import { DATASETS, describeAll } from './registry';

describe('data export registry', () => {
  const datasets = DATA_EXPORT_DATASET_KEYS.map((key) => DATASETS[key]);

  it('defines every shared dataset key, under its own key', () => {
    for (const key of DATA_EXPORT_DATASET_KEYS) {
      expect(DATASETS[key].key).toBe(key);
    }
  });

  it.each(DATA_EXPORT_DATASET_KEYS)(
    '%s has unique snake_case headers',
    (key) => {
      const headers = DATASETS[key].columns.map((column) => column.key);
      expect(new Set(headers).size).toBe(headers.length);
      for (const header of headers) {
        expect(header).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    },
  );

  /**
   * The page hands out PII by design, but never credentials or object-store
   * keys. A header shaped like one is the tell that somebody exported a raw
   * field without thinking about it.
   */
  it.each(DATA_EXPORT_DATASET_KEYS)(
    '%s exports no secret- or key-shaped column',
    (key) => {
      for (const column of DATASETS[key].columns) {
        expect(column.key).not.toMatch(
          /(^|_)(key|token|secret|hash|password)s?$/,
        );
      }
    },
  );

  it.each(DATA_EXPORT_DATASET_KEYS)(
    '%s has exactly one default date field',
    (key) => {
      expect(
        DATASETS[key].dateFields.filter((field) => field.isDefault),
      ).toHaveLength(1);
    },
  );

  it('declares a status vocabulary wherever it offers the status filter', () => {
    for (const def of datasets) {
      expect(def.filters.includes('status')).toBe(Boolean(def.status));
    }
  });

  it('describes every column, and the dictionary is plain JSON', () => {
    const dictionary = describeAll();
    expect(dictionary.map((d) => d.key)).toEqual([...DATA_EXPORT_DATASET_KEYS]);
    for (const dataset of dictionary) {
      for (const column of dataset.columns) {
        expect(column.description.length).toBeGreaterThan(0);
      }
    }
    expect(JSON.parse(JSON.stringify(dictionary))).toEqual(dictionary);
  });
});
