# The Deal Audits Table

**Table ID:** `6941fdb2dc9a6d024fd8caef`

**Field counts:** total: 17, linkedrecordfield: 2, lookupfield: 3, formulafield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"#A-001 -"` |
| 2 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-02-04T21:04:30.187000Z" }` |
| 3 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2026-02-11T23:34:51.846000Z", "by": "65550784e0d0dcc6fe3fc3aa" }` |
| 4 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 5 | Open Comments | `comments_count` | number (system) |  | `1` |
| 6 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 7 | Audit ID | `audit_id` | string |  | `"Start one"` |
| 8 | Audit Date | `audit_date` | date { date, include_time } |  | `{ "date": "2026-02-04T21:04:29.502000Z", "include_time": true }` |
| 9 | Result | `result` | single-select | choices: `Pass`=Pass, `Fail`=Fail | `"Pass" (Pass)` |
| 10 | Reason Codes | `reason_codes` | multi-select | choices: `Missing Docs`=Missing Docs, `Coverage Not Offered`=Coverage Not Offered, `Incorrect Named Insured`=Incorrect Named Insured, `Incorrect Address`=Incorrect Address, `Underwriting Issue`=Underwriting Issue, `Other`=Other | `"Missing Docs" (Missing Docs)` |
| 11 | Notes | `notes` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 12 | Deals | `s1841790f6` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple | `[ "6983b5c8561fddc0f30a10d4" ]` |
| 13 | Total Audit Items | `sf6c7aec41` | lookup (system) | lookup via `s1841790f6` | `[ [ "9" ] ]` |
| 14 | Passed Audit Items | `stgwd3vm` | lookup (system) | lookup via `s1841790f6` | `[ [ "7" ] ]` |
| 15 | Failed Audit Items | `sqmi6cm7` | lookup (system) | lookup via `s1841790f6` | `[ [ "2" ] ]` |
| 16 | Audit Score | `sadb5c0227` | formula (system) | formula: `NUMBER([stgwd3vm]) / Number([sf6c7aec41])` | `"1"` |
| 17 | Audit Notes | `sbe10476c6` | string (multi-line) |  | `"Total: 10, Passed: 7, Failed: 0. Missing required: Prior Insurance; Quote Re...` |
| 18 | Completed By | `sf82cacaca` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |

## Linked tables

- **Deals** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Completed By** → The Households Table (`6941fa11964c58f31380427c`)
