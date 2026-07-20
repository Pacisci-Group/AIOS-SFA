# The Policies Table

**Table ID:** `6941fc5b08644a5fbf05a781`

**Field counts:** total: 27, linkedrecordfield: 5, lookupfield: 4

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Policy Number | `title` | string (title) | required; unique | `"Record 1"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "<div class=\"rendered\">\n \n</div>" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "on": "2020-06-05T22:46:20.336000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2020-06-19T19:11:46.042000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Household | `s5cb27d5d9` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single |  |
| 9 | Policy Type | `sc0d2e4b72` | single-select | choices: `Zgsh3`=Auto, `eCEuV`=Home, `F3oxm`=Renters, `AiFB5`=Landlord, `le1BC`=Umbrella, `gGKei`=Motorcycle | `"Zgsh3" (Auto)` |
| 10 | Carrier | `s33be9b77d` | single-select | choices: `B4tEH`=Allstate | `"B4tEH" (Allstate)` |
| 11 | Active | `sd4ff7d9f7` | boolean |  | `true` |
| 12 | Effective Date | `s17370a3f9` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 13 | Expiration Date | `sb0fdb18f6` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 14 | Renewal Date | `sa2c7585b5` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 15 | Premium | `s59b4726cc` | number (currency) |  | `"232.00$"` |
| 16 | Items | `s7839a0aac` | number |  | `"0.10"` |
| 17 | Notes | `se356ed81c` | string (multi-line) |  | `"lorem ipsiu"` |
| 18 | Policy Status | `s87f83281a` | single-select | choices: `wSd3a`=Quoted, `QsrnM`=Active, `hLpfg`=Cancelled, `v7ho8`=Pending, `uUVZd`=Lapsed | `"wSd3a" (Quoted)` |
| 19 | Link to Service Tickets | `sr2ulci8` | link[] | → **The Service Tickets Table** (`6941fdb3dc9a6d024fd8d23d`), multiple |  |
| 20 | Documents | `s4624292` | link[] | → **_(external)_** (`69422a7d19c89735e27c78f6`), multiple |  |
| 21 | Deal | `s63e96e0b6` | link | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), single |  |
| 22 | Link to Interested Parties | `sgs4kv85` | link[] | → **The Interested Parties Table** (`694240c03d897b7099d73340`), multiple |  |
| 23 | Count | `s98c097a6b` | number |  | `"0.10"` |
| 24 | Household Name | `s578e4893f` | lookup (system) | lookup via `s5cb27d5d9` |  |
| 25 | Client Relations Manager Name | `sjv3dmcc` | lookup (system) | lookup via `sfa2fwi8` |  |
| 26 | Sold Date | `s97440d85d` | lookup (system) | lookup via `s63e96e0b6` |  |
| 27 | Producer Name | `s6b9f4646e` | lookup (system) | lookup via `s63e96e0b6` |  |
| 28 | New Business Application | `sd61f05a5f` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |

## Linked tables

- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Service Tickets** → The Service Tickets Table (`6941fdb3dc9a6d024fd8d23d`)
- **Documents** → _(external — not in provided docs)_ (`69422a7d19c89735e27c78f6`)
- **Deal** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Link to Interested Parties** → The Interested Parties Table (`694240c03d897b7099d73340`)
