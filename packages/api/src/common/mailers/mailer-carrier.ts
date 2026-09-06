/**
 * The carrier a mailer file is assumed to come from when nothing says otherwise
 * (PAC-93, PAC-71).
 *
 * ⚠ **A real assumption, not a placeholder default.** The vendor file format is
 * Allstate's — the 124/132-column Quote Burst contract, with
 * `agents.allstate.com` in the agency block — so a file's `agencyid` column is
 * an Allstate agency code and can only be matched against an Allstate
 * appointment. A vendor file from another carrier will arrive in some other
 * shape and needs its own column contract before it needs its own carrier
 * resolution.
 *
 * From PAC-71 a campaign carries its **own** `carrierId`, chosen from the global
 * catalog, and that is what the assignment lookup uses. This constant is only
 * what the "Run a campaign" form prefills with, and what the backfill assumes
 * for mailers that predate campaigns. Named and exported so the day a second
 * carrier arrives is one grep.
 *
 * Lives in `common/` rather than beside a service because the worker, the
 * campaign service and an offline backfill all need it, and the worker's import
 * boundary admits `common/` but not a feature directory.
 */
export const DEFAULT_MAILER_CARRIER = 'Allstate';
