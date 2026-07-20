# The Quote Recaps Table

**Table ID:** `6941fdb2dc9a6d024fd8bc53`

**Field counts:** total: 31, linkedrecordfield: 5, lookupfield: 4, formulafield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"#001"` |
| 2 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-26T01:19:44.758000Z" }` |
| 3 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-26T01:19:44.758000Z" }` |
| 4 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 5 | Open Comments | `comments_count` | number (system) |  | `1` |
| 6 | Quote Recap ID | `autonumber` | number (system) | unique | `1` |
| 7 | Created Date | `created_date` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 8 | Quote Notes / Recap | `quote_notes_recap` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 9 | Next Steps | `next_steps` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 10 | Recap Status | `recap_status` | single-select | choices: `Draft`=Draft, `Submitted`=Submitted | `"Draft" (Draft)` |
| 11 | Lead | `sbcb3c8b31` | link | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), single | `[ "6949e937f9ff8c2759c29018" ]` |
| 12 | Producer | `sf9e2dcdfb` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "6949ea8ce7bd47c74b04e630" ]` |
| 13 | Household | `se84b0aa3d` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single | `[ "6949e93cdbbd487b0f7a850f" ]` |
| 14 | Quote Date | `s376d7a544` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 15 | Mail Quote Control | `sb9f72cb5c` | string |  | `"QCN-29899"` |
| 16 | Insurance X Month | `s69d7c3f64` | single-select | choices: `0897f82f-de3a-4bbb-b973-c56bb1f4fecb`=January, `db14e7a4-6268-49ca-8b3f-aed9d15e77ae`=February, `cbaf9fb5-815c-4e2f-932e-a2f87d903606`=March, `8cec2f37-8e1e-479b-8434-671a789a2d49`=April, `0448d31d-5232-4cb5-9381-22f5e99f1970`=May, `a78db315-2e35-4f2b-868e-a98bcd61d180`=June, `9d6f93f2-0ca1-4d83-9955-0c6dc4bcac55`=July, `c1789842-dfed-4ccb-bb14-7b103bf9cade`=August, `a0cac70f-bc52-4f9e-8e2d-81cd2156061c`=September, `196233f9-c8f0-4861-94eb-8c36be0c713f`=October, `2a0ea166-84e7-4c2d-84f4-478c5e203495`=November, `a5868d88-f0cf-4ad4-9fc8-c68a15b925c3`=December | `"0897f82f-de3a-4bbb-b973-c56bb1f4fecb" (January)` |
| 17 | Product(s) Quoted | `s1e17612aa` | multi-select | choices: `PYgez`=Auto, `sNMRK`=Home, `Hn155`=Renters, `OMJjl`=Motorcycle, `mCt4m`=Landlords, `uBjtw`=Valuable Item Protection, `UAOk8`=Auto - Special, `NlLBc`=Boat Owners, `fltex`=Umbrella, `EGGWR`=Life, `mrzQD`=Condominium | `"PYgez" (Auto)` |
| 18 | Total Quoted Premium | `s98af0638c` | number (currency) |  | `"232.00$"` |
| 19 | Total Items | `sd19cab342` | number |  | `"0.10"` |
| 20 | Quote | `s0e915261d` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 21 | Lead Manager | `s610f349f9` | single-select | choices: `bXQ03`=Yes, `e0lfR`=No | `"bXQ03" (Yes)` |
| 22 | Life Included | `s74miabq` | single-select | choices: `bXQ03`=Yes, `e0lfR`=No | `"bXQ03" (Yes)` |
| 23 | Link to Deals (Sold Log) | `sdi9bbn6` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 24 | Producer Name | `s746f22d71` | lookup (system) | lookup via `sf9e2dcdfb` | `[ [ { "title": "", "first_name": "Sample", "middle_name": "", "last_name": "S...` |
| 25 | Lead Status | `sa6f0d0fd9` | lookup (system) | lookup via `sbcb3c8b31` | `[ [ "phjnb" ] ]` |
| 26 | Lead Source | `s6629e0a52` | lookup (system) | lookup via `sbcb3c8b31` | `[ [ "Other" ] ]` |
| 27 | Household Name | `s16114d0ca` | lookup (system) | lookup via `se84b0aa3d` | `[ [ "One" ] ]` |
| 28 | Count | `s71662a6f7` | number |  | `"0.10"` |
| 29 | Notes | `s5156e5b7d` | string (multi-line) |  | `"lorem ipsiu"` |
| 30 | Number of Drivers | `s7e82006a5` | number |  | `"0.10"` |
| 31 | Update URL | `s3c3e9c558` | formula (system) | formula: `CONCAT("https://paciscigroup.fillout.com/t/cusXRDS52ous?id=", RECORD_ID())` | `"https://paciscigroup.fillout.com/t/cusXRDS52ous?id=694de2b0e53a126458a81467"` |
| 32 | Household Members | `s48d0714c0` | link[] | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), multiple |  |

## Linked tables

- **Lead** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Deals (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Household Members** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
