# The Leads Table

**Table ID:** `6941fdb1dc9a6d024fd8b505`

**Field counts:** total: 36, linkedrecordfield: 8, lookupfield: 2

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | SS Lead ID | `title` | string (title) | required; unique | `"#001"` |
| 2 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-22T18:44:00.236000Z" }` |
| 3 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-25T21:03:07.417000Z" }` |
| 4 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 5 | Open Comments | `comments_count` | number (system) |  | `1` |
| 6 | Lead ID | `autonumber` | number (system) | unique | `1` |
| 7 | Created Date | `created_date` | date { date, include_time } |  | `{ "date": "2025-02-13T00:00:00Z", "include_time": false }` |
| 8 | Lead Source | `lead_source` | single-select | choices: `Mail`=Mail, `Referral Partner`=Referral Partner, `Customer Referral`=Customer Referral, `Web`=Web, `Walk-In`=Walk-In, `Other`=Other | `"Mail" (Mail)` |
| 9 | Temperature | `temperature` | single-select | choices: `Hot`=Hot, `Warm`=Warm, `Cold`=Cold | `"Hot" (Hot)` |
| 10 | Status | `status` | single-select | choices: `New`=New, `Contacted`=Contacted, `Quoted`=Quoted, `Sold`=Sold, `Not Qualified`=Not Qualified, `Closed`=Closed, `arW7O`=Requote, `phjnb`=Converted, `jp76g`=Lost, `hfwda`=Qualified | `"New" (New)` |
| 11 | First Name | `first_name` | string |  | `"William"` |
| 12 | Last Name | `last_name` | string |  | `"Davis"` |
| 13 | Primary Email | `email` | string[] (emails) |  | `[ "william.davis@example.com" ]` |
| 14 | Phone | `phone` | phone[] |  | `[ { "phone_country": "US", "phone_number": "555 437 6488", "phone_extension":...` |
| 15 | Notes | `notes` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [ { "type": "paragraph", "attrs": { "te...` |
| 16 | Quote Control Number | `s120960602` | string |  | `"QCN-11741"` |
| 17 | Property Address | `sfd5ba053e` | object (address) |  | `{ "location_address": "100 Generic St, Jenks, Oklahoma, 74037, United States"...` |
| 18 | Producer | `s2431092ba` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "6949ea8ce7bd47c74b04e630" ]` |
| 19 | Household | `s4f5f73a22` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single | `[ "6949c1441944dea84727da33" ]` |
| 20 | Link to Quote Recaps | `soilrknn` | link[] | → **The Quote Recaps Table** (`6941fdb2dc9a6d024fd8bc53`), multiple |  |
| 21 | Link to Deals (Sold Log) | `sxta6w2v` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 22 | Producer Name | `se684e4b41` | lookup (system) | lookup via `s2431092ba` | `[ [ { "title": "", "first_name": "Sample", "middle_name": "", "last_name": "S...` |
| 23 | Producer Email | `s1jxogzr` | lookup (system) | lookup via `s2431092ba` | `[ [ [ "david.classicchevy@gmail.com" ] ] ]` |
| 24 | Link to Partner Submissions | `si6b06xz` | link[] | → **_(external)_** (`6942d44727af14b8219638b5`), multiple |  |
| 25 | Purchase Amount | `s31084bef0` | number (currency) |  | `"299112.00"` |
| 26 | Loan Amount | `s75f6a774f` | number (currency) |  | `"239289.00"` |
| 27 | Date of Birth | `sb0cf90c4c` | date { date, include_time } |  | `{ "date": "1968-11-15T00:00:00Z", "include_time": false }` |
| 28 | Referral Partner | `s83c5c7ebd` | link | → **_(external)_** (`694248a23a39e661719febd3`), single |  |
| 29 | Primary Insured | `s8754c9e3b` | link | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), single | `[ "694990ed71cb010f29409397" ]` |
| 30 | Primary First Name | `s21afcca18` | string |  | `"Start one"` |
| 31 | Loan Type | `s4a462baf8` | single-select | choices: `yy3Xl`=Conventional, `zfpH4`=FHA, `VNqej`=VA, `IC5ZL`=Jumbo, `lxFzG`=Refinance, `3aQlv`=USDA | `"yy3Xl" (Conventional)` |
| 32 | Closing Date | `s4f40be65e` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 33 | Files and Images | `s8619f5112` | file[] |  | `{ "handle": "b9JqU3JScO5xjhk2byXp", "metadata": { "container": "smart-suite-m...` |
| 34 | Preferred Method of Contact | `sc28deef85` | single-select | choices: `Gz1f6`=Email, `ZMKoW`=Call, `B2EBO`=Text | `"Gz1f6" (Email)` |
| 35 | Best Time Contact | `s465c990b5` | single-select | choices: `hgMvV`=Morning, `e2jBE`=Afternoon, `xQAVn`=Evening | `"hgMvV" (Morning)` |
| 36 | Household Members | `sa3501b7c2` | link | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), single | `[ "6949913bafe80e86631c0a2e" ]` |
| 37 | Assigned Date | `sc72b507e0` | date { date, include_time } |  | `{ "date": "2025-10-21T00:00:00Z", "include_time": false }` |

## Linked tables

- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Quote Recaps** → The Quote Recaps Table (`6941fdb2dc9a6d024fd8bc53`)
- **Link to Deals (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Link to Partner Submissions** → _(external — not in provided docs)_ (`6942d44727af14b8219638b5`)
- **Referral Partner** → _(external — not in provided docs)_ (`694248a23a39e661719febd3`)
- **Primary Insured** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
- **Household Members** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
