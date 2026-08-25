# The Deals (Sold Log) Table

**Table ID:** `6941fdb2dc9a6d024fd8c3a1`

**Field counts:** total: 97, linkedrecordfield: 15, lookupfield: 10, rollupfield: 6, formulafield: 11

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"Demaij Mayo - #001"` |
| 2 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "656114694e903033aaa696f4", "on": "2026-01-15T05:18:12.280000Z" }` |
| 3 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-28T14:47:56.768000Z" }` |
| 4 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 5 | Open Comments | `comments_count` | number (system) |  | `1` |
| 6 | Deal ID | `autonumber` | number (system) | unique | `1` |
| 7 | Sold Date | `sold_date` | date { date, include_time } |  | `{ "date": "2025-08-12T00:00:00Z", "include_time": false }` |
| 8 | Deal Audit Status | `deal_audit_status` | single-select | choices: `Not Submitted`=Not Started, `Pending`=In Progress, `Pass`=Complete, `Fail`=Overdue | `"Not Submitted" (Not Started)` |
| 9 | Audit Notes / Failure Reason | `audit_notes_failure_reason` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 10 | Missing Items | `missing_items` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 11 | Total Premium (Snapshot) | `total_premium_snapshot` | number (currency) |  | `"3042.78"` |
| 12 | Link to Document Index | `si1m6ke1` | link[] | → **_(external)_** (`69422a7d19c89735e27c78f6`), multiple |  |
| 13 | Policy Number(s) | `shcd6rhm` | link[] | → **The Policies Table** (`6941fc5b08644a5fbf05a781`), multiple | `[ "6968734f3852d860110a072d" ]` |
| 14 | Producer | `s5c3f8f062` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "69613aed0ff4e450871ce2d9" ]` |
| 15 | Quote Recap | `s74c0950b7` | link | → **The Quote Recaps Table** (`6941fdb2dc9a6d024fd8bc53`), single |  |
| 16 | Onboarding Client Relations Manager | `sfae79b119` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fd60a37eddb6b8d46eb6b" ]` |
| 17 | Lead | `s29ac27a8a` | link | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), single |  |
| 18 | Link to Prior Insurance | `sb0viyg7` | link[] | → **The Prior Insurance Table** (`69423c25d4f749d1e15c017a`), multiple |  |
| 19 | Link to Prior Policy ID | `s2fm2g7w` | link[] | → **The Prior Policies Table** (`69423e89ea5c9f2798e4bc00`), multiple |  |
| 20 | Producer Name | `sd4a8e9b02` | lookup (system) | lookup via `s5c3f8f062` | `[ [ { "title": "", "first_name": "Brandon", "middle_name": "", "last_name": "...` |
| 21 | Onboarding CRM Name | `s365813977` | lookup (system) | lookup via `sfae79b119` | `[ [ { "title": "", "first_name": "Ashley", "middle_name": "", "last_name": "M...` |
| 22 | Onboarding CRM Email | `s8kkeyse` | lookup (system) | lookup via `sfae79b119` | `[ [ [ "ashleymedina2@allstate.com" ] ] ]` |
| 23 | Household ID | `s640bdcd7d` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single | `[ "6965c41798f8cd8ca74423a3" ]` |
| 24 | Household Name | `s29312b03c` | lookup (system) | lookup via `s640bdcd7d` | `[ [ "Demaij Mayo" ] ]` |
| 25 | Assigned CSR (Household) | `s54eee8d29` | lookup (system) | lookup via `s640bdcd7d` | `[ [ [ "695fd60a37eddb6b8d46eb6b" ] ] ]` |
| 26 | Policy Count | `s8e1f0c85d` | rollup (system) | rollup via `shcd6rhm` | `"1"` |
| 27 | Total Premium | `s0675d21ce` | rollup (system) | rollup via `shcd6rhm` | `"3042.78"` |
| 28 | Service Tickets | `s7b73de124` | link | → **The Service Tickets Table** (`6941fdb3dc9a6d024fd8d23d`), single |  |
| 29 | Open Service Tickets | `s90f64afd9` | lookup (system) | lookup via `s7b73de124` |  |
| 30 | Mortgage Information | `s88710f355` | link | → **The Interested Parties Table** (`694240c03d897b7099d73340`), single |  |
| 31 | Onboarding Due Date | `s0025f1ef3` | daterange { from_date, to_date } |  | `{ "from_date": { "date": null, "include_time": false }, "to_date": { "date": ...` |
| 32 | Assignment Count | `s0d51d94e9` | number |  | `"0.10"` |
| 33 | Auto_New Business Application | `s17ce83873` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 34 | Home_New Business Application | `sdngtmm9` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 35 | Landlord_New Business Application | `s8cha8g3` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 36 | Renters_New Business Application | `s8f4k3x1` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 37 | Other_New Business Application | `spt1ik38` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 38 | Defensive Driver | `s9321f9398` | boolean |  | `true` |
| 39 | Good Student/Student Away from Home | `sxbpwlrl` | boolean |  | `true` |
| 40 | Hail Resistant | `soe2t5j8` | boolean |  | `true` |
| 41 | Fire Subscription | `snj9dkqf` | boolean |  | `true` |
| 42 | Passed Home Inspection | `sqmmybna` | boolean |  | `true` |
| 43 | Lead Manager | `sd1013cx` | boolean |  | `true` |
| 44 | Actual Cash Value Sold Log Answer | `s8al91hl` | boolean |  | `true` |
| 45 | Deal Audit Items | `satt1b2j` | link[] | → **The Deal Audit Items Table** (`69533b022b0995e027431c02`), multiple |  |
| 46 | Policy Type(s) | `s37fb9a5b2` | lookup (system) | lookup via `shcd6rhm` | `[ [ "AiFB5" ] ]` |
| 47 | Policies Types Formula | `s5c2bfbde3` | formula (system) | formula: `TEXT([s37fb9a5b2])` | `"Landlord"` |
| 48 | Audit Items Count | `sad176245d` | rollup (system) | rollup via `satt1b2j` | `1` |
| 49 | Household Members | `s59e221204` | link[] | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), multiple |  |
| 50 | Total Items | `sc76a6a409` | rollup (system) | rollup via `shcd6rhm` | `"1"` |
| 51 | Actual Cash Value Deal Audit | `shurr402` | boolean |  | `true` |
| 52 | Actual Cash Value Personal Property | `sdr7xwyq` | boolean |  | `true` |
| 53 | Actual Cash Value Dwelling Protection | `sai9zuvm` | boolean |  | `true` |
| 54 | ACV Signature Status | `sb2711f6c6` | status | choices: `backlog`=N/A, `in_progress`=Pending, `complete`=Signed | `"backlog" (N/A)` |
| 55 | ACV Signed Date | `s3a4e6a8f3` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 56 | ACV Sent Date | `s4ndswxg` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 57 | ACV Doc URL | `sf4039d405` | string (url) |  | `[ "http://www.google.com" ]` |
| 58 | Drivewise | `scfe11c3ed` | boolean |  | `true` |
| 59 | rec | `s84d803ab2` | formula (system) | formula: `RECORD_ID()` | `"69687890b68d96fdbfa23d37"` |
| 60 | Household rec id | `s65c210068` | lookup (system) | lookup via `s640bdcd7d` | `[ [ "6965c41798f8cd8ca74423a3" ] ]` |
| 61 | Producer rec id | `s274954640` | lookup (system) | lookup via `s5c3f8f062` | `[ [ "69613aed0ff4e450871ce2d9" ] ]` |
| 62 | VIP_Formula | `s79b18ce64` | string |  | `"Start one"` |
| 63 | Assigned_CSR | `sd2790cc0e` | string |  | `"Ashley Medina"` |
| 64 | Lead_Source | `s35e000f65` | string |  | `"Start one"` |
| 65 | Client Name | `sac58e9b8f` | lookup (system) | lookup via `s640bdcd7d` | `[ [ { "title": "", "first_name": "Demaij Mayo", "middle_name": "", "last_name...` |
| 66 | Entered in Sold Log on Time | `s79e9a311c` | boolean |  | `true` |
| 67 | Fillout Lead Source | `s989aa45e7` | single-select | choices: `WCO7l`=Mailer, `GVCgc`=Book of Business Lead, `UqEUq`=Allstate Lead Marketplace, `Eos2j`=Customer Referral, `oayGb`=Data Lot, `X2Wrh`=Facebook, `30sDe`=Google, `DmjDy`=Mail Referral, `xjtnZ`=Quotewizard, `gjJUG`=Live Call Transfer, `qmWQA`=Stride, `FdgIw`=Waterstone, `ENEJP`=Test, `ymZHL`=JYA, `65o7M`=House, `hqGGu`=Mailer-JYA, `YtWBU`=MGO, `Z8lxN`=MES | `"WCO7l" (Mailer)` |
| 68 | Escrow Payment | `ss0mphm6` | boolean |  | `true` |
| 69 | Status | `s30e41153c` | status | choices: `backlog`=Sold, `in_progress`=Passed Deal Audit, `QKDLv`=Overdue, `complete`=Complete and Onboarded | `"backlog" (Sold)` |
| 70 | Bundle | `sir4pvkc` | boolean |  | `true` |
| 71 | submission_token | `sed87ce95b` | string |  | `"Start one"` |
| 72 | Normalized Client Name | `sb0fd70600` | formula (system) | formula: `TEXT([sac58e9b8f])` | `"Demaij Mayo"` |
| 73 | EOI | `s45c195103` | boolean |  | `true` |
| 74 | sold_date_ymd | `sd85ca4126` | formula (system) | formula: `NUMBER(CONCAT(YEAR([sold_date]), RIGHT("0" + TEXT(MONTH([sold_date])), 2), RIGHT("0" + TEXT(DAY([sold_date])), 2)))` | `"20250812"` |
| 75 | Link to Deal Audits | `sqd7of1p` | link[] | → **The Deal Audits Table** (`6941fdb2dc9a6d024fd8caef`), multiple |  |
| 76 | Failed Audit Items | `sb011b4cc5` | rollup (system) | rollup via `satt1b2j` | `1` |
| 77 | Passed Audit Items | `sr8m74bw` | rollup (system) | rollup via `satt1b2j` | `1` |
| 78 | Sold Year | `sd814b7cbf` | formula (system) | formula: `YEAR([sold_date])` | `"2025"` |
| 79 | Sold Month | `sctc0m3q` | formula (system) | formula: `IF(MONTH([sold_date]) = 1, "January", IF(MONTH([sold_date]) = 2, "February", IF(MONTH([sold_date]) = 3, "March", IF(MONTH([sold_date]) = 4, "April", IF(MONTH([sold_date]) = 5, "May", IF(MONTH([sold_date]) = 6, "June", IF(MONTH([sold_date]) = 7, "July", IF(MONTH([sold_date]) = 8, "August", IF(MONTH([sold_date]) = 9, "September", IF(MONTH([sold_date]) = 10, "October", IF(MONTH([sold_date]) = 11, "November", "December")))))))))))` | `"August"` |
| 80 | sold_yyyymmdd_num | `s6476659a2` | number |  | `"20250812"` |
| 81 | Yes / No | `s01d634146` | boolean |  | `true` |
| 82 | Normalized Producer Name | `s734163725` | formula (system) | formula: `TEXT([sd4a8e9b02])` | `"Brandon Spencer"` |
| 83 | onboarding_yyyymmdd_num | `stmmrkwy` | number |  | `"0"` |
| 84 | onboarding_date_ymd | `smz0kwry` | formula (system) | formula: `NUMBER(CONCAT(YEAR([s0025f1ef3]), RIGHT("0" + TEXT(MONTH([s0025f1ef3])), 2), RIGHT("0" + TEXT(DAY([s0025f1ef3])), 2)))` | `"0"` |
| 85 | Normalized CRM Name | `s1re9xtv` | formula (system) | formula: `TEXT([s365813977])` | `"Ashley Medina"` |
| 86 | Onboarding Status | `sryo6fkk` | status | choices: `backlog`=Not Started, `in_progress`=In Progress, `QKDLv`=Overdue, `complete`=Complete | `"backlog" (Not Started)` |
| 87 | Audit Due Date | `s318c353b0` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 88 | started_at | `s5186fdc96` | string |  | `"Start one"` |
| 89 | finalized_at | `sqn1npiv` | string |  | `"Start one"` |
| 90 | audit_yyyymmdd_num | `sg03tc6t` | number |  | `"20250812"` |
| 91 | audit_date_ymd | `stjkewku` | formula (system) | formula: `NUMBER(CONCAT(YEAR([s318c353b0]), RIGHT("0" + TEXT(MONTH([s318c353b0])), 2), RIGHT("0" + TEXT(DAY([s318c353b0])), 2)))` | `"0"` |
| 92 | manual test | `s66cb5e2de` | boolean |  | `true` |
| 93 | Link to Commission Ledger | `sw72cztt` | link[] | → **_(external)_** (`6984aa6b0e79f7575da0956d`), multiple |  |
| 94 | Edit Sold | `se294fa48f` | formula (system) | formula: `CONCAT("https://paciscigroup.fillout.com/t/782Dc42qhSus?id=", RECORD_ID())` | `"https://paciscigroup.fillout.com/t/782Dc42qhSus?id=69687890b68d96fdbfa23d37"` |
| 95 | crm_assigned_at | `sf167337ba` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 96 | crm_assignment_status | `s237149cf7` | single-select | choices: `SiuOy`=assigned, `r36b8`=skipped_already_assigned, `44Jsm`=skipped_not_sold, `i0Yfc`=failed, `du2mf`=retrying | `"SiuOy" (assigned)` |
| 97 | crm_assignment_error | `s290093ae0` | string (multi-line) |  | `"lorem ipsiu"` |
| 98 | Spanish Speaking | `s686ca15ea` | boolean |  | `true` |

## Linked tables

- **Link to Document Index** → _(external — not in provided docs)_ (`69422a7d19c89735e27c78f6`)
- **Policy Number(s)** → The Policies Table (`6941fc5b08644a5fbf05a781`)
- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Quote Recap** → The Quote Recaps Table (`6941fdb2dc9a6d024fd8bc53`)
- **Onboarding Client Relations Manager** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Lead** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Link to Prior Insurance** → The Prior Insurance Table (`69423c25d4f749d1e15c017a`)
- **Link to Prior Policy ID** → The Prior Policies Table (`69423e89ea5c9f2798e4bc00`)
- **Household ID** → The Households Table (`6941fa11964c58f31380427c`)
- **Service Tickets** → The Service Tickets Table (`6941fdb3dc9a6d024fd8d23d`)
- **Mortgage Information** → The Interested Parties Table (`694240c03d897b7099d73340`)
- **Deal Audit Items** → The Deal Audit Items Table (`69533b022b0995e027431c02`)
- **Household Members** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
- **Link to Deal Audits** → The Deal Audits Table (`6941fdb2dc9a6d024fd8caef`)
- **Link to Commission Ledger** → _(external — not in provided docs)_ (`6984aa6b0e79f7575da0956d`)
