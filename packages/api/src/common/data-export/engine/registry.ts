import {
  DATA_EXPORT_DATASET_KEYS,
  type DataExportDatasetDescriptor,
  type DataExportDatasetKey,
} from '@sfa/shared';
import { contactsDataset } from '../datasets/contacts.dataset';
import { householdsDataset } from '../datasets/households.dataset';
import { leadsDataset } from '../datasets/leads.dataset';
import { policiesDataset } from '../datasets/policies.dataset';
import { quoteRecapsDataset } from '../datasets/quote-recaps.dataset';
import { soldDealsDataset } from '../datasets/sold-deals.dataset';
import { Contact } from '../../../contacts/schemas/contact.schema';
import { Deal } from '../../../deals/schemas/deal.schema';
import { Household } from '../../../households/schemas/household.schema';
import { Lead } from '../../../leads/schemas/lead.schema';
import { Policy } from '../../../policies/schemas/policy.schema';
import { QuoteRecap } from '../../../quote-recaps/schemas/quote-recap.schema';
import type { AnyDatasetDef } from './dataset.types';
import type { ExportModels } from './lookups';

/**
 * Every dataset, by key. `Record<DataExportDatasetKey, …>` makes a key added
 * to the shared list a compile error here until its definition exists.
 */
export const DATASETS: Record<DataExportDatasetKey, AnyDatasetDef> = {
  leads: leadsDataset,
  quote_recaps: quoteRecapsDataset,
  sold_deals: soldDealsDataset,
  policies: policiesDataset,
  households: householdsDataset,
  contacts: contactsDataset,
};

/** A dataset as the data dictionary describes it: no `pick`, no `joins`. */
export function describeDataset(
  def: AnyDatasetDef,
): DataExportDatasetDescriptor {
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    scope: def.scope,
    dateFields: def.dateFields.map((field) => ({
      key: field.key,
      label: field.label,
      isDefault: field.isDefault === true,
    })),
    filters: [...def.filters],
    ...(def.status ? { statusValues: [...def.status.values] } : {}),
    columns: def.columns.map(({ key, type, description }) => ({
      key,
      type,
      description,
    })),
  };
}

/** The dictionary in display order (the shared key list's order). */
export function describeAll(): DataExportDatasetDescriptor[] {
  return DATA_EXPORT_DATASET_KEYS.map((key) => describeDataset(DATASETS[key]));
}

/**
 * The model a dataset reads, from the set every export run is built with. One
 * table, shared by the API (which counts) and the worker (which writes), so
 * the two cannot disagree about where a dataset's rows come from.
 */
export function modelFor(def: AnyDatasetDef, models: ExportModels) {
  const byName: Record<string, ExportModels[keyof ExportModels]> = {
    [Lead.name]: models.lead,
    [Deal.name]: models.deal,
    [QuoteRecap.name]: models.quoteRecap,
    [Policy.name]: models.policy,
    [Household.name]: models.household,
    [Contact.name]: models.contact,
  };
  const model = byName[def.model];
  if (!model) throw new Error(`No model registered for ${def.model}`);
  return model;
}
