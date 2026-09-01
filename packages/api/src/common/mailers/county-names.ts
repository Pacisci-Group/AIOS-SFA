/**
 * FIPS county code → county name, for the Mailers drawer (PAC-61).
 *
 * The source ships `county` as a zero-padded FIPS code (`'017'`) and legacy
 * rendered it raw — producers were shown "County: 083". This is the lookup that
 * fixes it.
 *
 * ## Why it is resolved server-side
 *
 * The drawer would otherwise have to carry the table into the web bundle to
 * render one label. The API already projects a mailer into a view model
 * (`MailerLookupView`), so resolving here costs nothing and keeps the table on
 * one side of the wire.
 *
 * ## Why Oklahoma only
 *
 * All three reference RTP files, and 100% of the committed test fixture, are
 * Smith Family Agency in Oklahoma. Carrying all ~3,140 US counties for a
 * dataset with 77 of them is weight with no reader. **Adding a state is one
 * object literal** — `resolveCountyName` is already keyed on the USPS
 * abbreviation and needs no change. Do not restructure this to add one.
 *
 * An unmapped state or code resolves to `undefined`, and the drawer omits the
 * county row entirely rather than falling back to the raw code or to a dash: a
 * dash claims we looked the county up and it was not there, which is a
 * different and false statement.
 *
 * Codes are the Census county FIPS for state 40 (Oklahoma), odd `001`–`153`.
 * Note the FIPS ordering puts `Mc…` before `Ma…` (`087 McClain` … `093 Major`),
 * which is why this list is not in plain alphabetical order.
 */
export const COUNTY_NAMES_BY_STATE: Record<string, Record<string, string>> = {
  OK: {
    '001': 'Adair',
    '003': 'Alfalfa',
    '005': 'Atoka',
    '007': 'Beaver',
    '009': 'Beckham',
    '011': 'Blaine',
    '013': 'Bryan',
    '015': 'Caddo',
    '017': 'Canadian',
    '019': 'Carter',
    '021': 'Cherokee',
    '023': 'Choctaw',
    '025': 'Cimarron',
    '027': 'Cleveland',
    '029': 'Coal',
    '031': 'Comanche',
    '033': 'Cotton',
    '035': 'Craig',
    '037': 'Creek',
    '039': 'Custer',
    '041': 'Delaware',
    '043': 'Dewey',
    '045': 'Ellis',
    '047': 'Garfield',
    '049': 'Garvin',
    '051': 'Grady',
    '053': 'Grant',
    '055': 'Greer',
    '057': 'Harmon',
    '059': 'Harper',
    '061': 'Haskell',
    '063': 'Hughes',
    '065': 'Jackson',
    '067': 'Jefferson',
    '069': 'Johnston',
    '071': 'Kay',
    '073': 'Kingfisher',
    '075': 'Kiowa',
    '077': 'Latimer',
    '079': 'Le Flore',
    '081': 'Lincoln',
    '083': 'Logan',
    '085': 'Love',
    '087': 'McClain',
    '089': 'McCurtain',
    '091': 'McIntosh',
    '093': 'Major',
    '095': 'Marshall',
    '097': 'Mayes',
    '099': 'Murray',
    '101': 'Muskogee',
    '103': 'Noble',
    '105': 'Nowata',
    '107': 'Okfuskee',
    '109': 'Oklahoma',
    '111': 'Okmulgee',
    '113': 'Osage',
    '115': 'Ottawa',
    '117': 'Pawnee',
    '119': 'Payne',
    '121': 'Pittsburg',
    '123': 'Pontotoc',
    '125': 'Pottawatomie',
    '127': 'Pushmataha',
    '129': 'Roger Mills',
    '131': 'Rogers',
    '133': 'Seminole',
    '135': 'Sequoyah',
    '137': 'Stephens',
    '139': 'Texas',
    '141': 'Tillman',
    '143': 'Tulsa',
    '145': 'Wagoner',
    '147': 'Washington',
    '149': 'Washita',
    '151': 'Woods',
    '153': 'Woodward',
  },
};

/**
 * The display name for a county, e.g. `'Tulsa County'`.
 *
 * `undefined` — never the raw code, never a placeholder — when the state is
 * unknown, the code is unmapped, or either is missing. The caller omits the
 * field rather than rendering a stand-in.
 *
 * Tolerant of how the code arrives, because two importers feed this collection:
 * the RTP upload stores the zero-padded string it was given, while some feeds
 * carry the full 5-digit state+county code. Non-digits are stripped, the last
 * three digits are taken, and a short code is re-padded — so `'17'`, `'017'`
 * and `'40017'` all resolve.
 */
export function resolveCountyName(
  state?: string | null,
  fips?: string | null,
): string | undefined {
  const stateKey = state?.trim().toUpperCase();
  if (!stateKey) return undefined;

  const counties = COUNTY_NAMES_BY_STATE[stateKey];
  if (!counties) return undefined;

  const digits = String(fips ?? '').replace(/\D/g, '');
  if (!digits) return undefined;

  const code = digits.slice(-3).padStart(3, '0');
  const name = counties[code];
  return name ? `${name} County` : undefined;
}
