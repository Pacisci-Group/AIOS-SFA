# The Contacts Table

**Table ID:** `6941fb21eea41b87f26cd10d`

**Field counts:** total: 26, linkedrecordfield: 7, formulafield: 1, lookupfield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | SS Contact ID | `title` | string (title) | required; unique | `"#C00001"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-22T18:41:49.169000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2026-01-13T04:53:48.302000Z", "by": "656114694e903033aaa696f4" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Contact ID | `autonumber` | number (system) | unique | `1` |
| 8 | First Name | `sa5a6956b1` | string |  | `"Sample"` |
| 9 | Last Name | `s463f12943` | string |  | `"Primary"` |
| 10 | Email | `s311269c0c` | string[] (emails) |  | `[ "po@lol.com" ]` |
| 11 | Phone | `s03c983a27` | phone[] |  | `[ { "phone_country": "US", "phone_number": "918-555-5555", "phone_extension":...` |
| 12 | Date of Birth | `s1fb9a8813` | date { date, include_time } |  | `{ "date": "2025-12-22T00:00:00Z", "include_time": false }` |
| 13 | Role in Household | `se79ae4f7f` | single-select | choices: `iqGZ5`=Name Insured, `W7qil`=Spouse, `5ddmB`=Driver, `fZHxn`=Child, `ZOVDs`=Parent, `SCJxW`=Other, `lzh7a`=Named Insured | `"iqGZ5" (Name Insured)` |
| 14 | Is Primary | `s413f031d4` | boolean |  | `true` |
| 15 | Notes | `s39661d2f6` | string (multi-line) |  | `"lorem ipsiu"` |
| 16 | Full Name | `sdc040b3ea` | object { first_name, middle_name, last_name } |  | `"1" (Mr.)` |
| 17 | Household | `s66cf9402f` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single |  |
| 18 | Household Primary Contact | `sljrnhhg` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |
| 19 | Household Member | `su8pm1bp` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |
| 20 | Primary to Leads | `sq4lymj8` | link[] | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), multiple | `[ "69499170bce823a45357bc03", "694994629324d75f7fed5457" ]` |
| 21 | Household Members to Leads | `soq1xccz` | link[] | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), multiple | `[ "69499170bce823a45357bc03", "694994629324d75f7fed5457" ]` |
| 22 | System ID Helper | `sec0d4e5ef` | formula (system) | formula: `RECORD_ID()` | `"694990ed71cb010f29409397"` |
| 23 | Link to Deals (Sold Log)-Primary | `syu9ac3d` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 24 | Link to Quote Recaps | `soqeqlgq` | link[] | → **The Quote Recaps Table** (`6941fdb2dc9a6d024fd8bc53`), multiple |  |
| 25 | household rec id | `sa614b3c10` | lookup (system) | lookup via `s66cf9402f` |  |
| 26 | fillout household | `seb68a04aa` | string |  | `"Start one"` |
| 27 | Fillout | `s90112a634` | boolean |  | `true` |

## Linked tables

- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Household Primary Contact** → The Households Table (`6941fa11964c58f31380427c`)
- **Household Member** → The Households Table (`6941fa11964c58f31380427c`)
- **Primary to Leads** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Household Members to Leads** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Link to Deals (Sold Log)-Primary** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Link to Quote Recaps** → The Quote Recaps Table (`6941fdb2dc9a6d024fd8bc53`)
