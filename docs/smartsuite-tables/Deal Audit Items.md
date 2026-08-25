# The Deal Audit Items Table

**Table ID:** `69533b022b0995e027431c02`

**Field counts:** total: 32, linkedrecordfield: 3, formulafield: 7, lookupfield: 4

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"\| #001"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-21T22:32:45.080000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2026-02-11T23:34:51.846000Z", "by": "65550784e0d0dcc6fe3fc3aa" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Deal | `s05ab1053c` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 9 | Audit Category | `sa38a2d635` | single-select | choices: `VeW4i`=Auto, `m1LoO`=Home, `ehjDd`=Landlord, `hQrq6`=Common | `"VeW4i" (Auto)` |
| 10 | Audit Item Name | `s9fa744e78` | single-select | choices: `iSSXH`=Defensive Driver, `m0k6n`=Fire Subscription, `puXG7`=Actual Cash Value, `v4qnW`=(Mortgagee) Escrow Payment, `7yDnF`=Good Student, `Qmqzr`=Drivewise, `DcAq8`=Hail Resistant Roof, `zmyVX`=Home Inspection, `guhUP`=Correct Sold Date, `LYJfx`=Correct Effective Date, `jKjFr`=Prior Insurance, `m7FKN`=Accord Cancellation, `pWrw5`=Quote Recap, `QcOSN`=Lead Manager, `Lbo2i`=Drivers Verified, `0Y3Xs`=Evidence of Insurance | `"iSSXH" (Defensive Driver)` |
| 11 | Status | `sdb5069dbd` | status | choices: `backlog`=Not Started, `in_progress`=Failed, `complete`=Complete | `"backlog" (Not Started)` |
| 12 | Required | `s68ec160c0` | boolean |  | `true` |
| 13 | Completed By | `sbcceed033` | link[] | → **The Users Table** (`69422c487eafe925c8e4bbfa`), multiple |  |
| 14 | Completion Date | `sa3ca6b5dc` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 15 | Notes | `s648254a5b` | string (multi-line) |  | `"lorem ipsiu"` |
| 16 | Blocking | `sowlcvdy` | boolean |  | `true` |
| 17 | Applicable | `s14phmo9` | boolean |  | `true` |
| 18 | Count | `s207d389b0` | number |  | `"1"` |
| 19 | submission_token | `s5c6abdd01` | string |  | `"c9949a47-59bf-4a32-8a04-82fe1c90b1aa"` |
| 20 | template_id | `s65578468f` | link | → **The Audit Templates Table** (`69532d09f018acf38e53443a`), single |  |
| 21 | Client Name | `s6e2115f72` | lookup (system) | lookup via `s05ab1053c` |  |
| 22 | Producer | `ss125ogh` | lookup (system) | lookup via `s05ab1053c` |  |
| 23 | Update Status | `s5cd2f1d5a` | status | choices: `backlog`=Missing, `in_progress`=Submitted - Ready for Review, `complete`=Verified - Complete | `"backlog" (Missing)` |
| 24 | Normalized Client Name | `sd1a6233f4` | formula (system) | formula: `TEXT([s6e2115f72])` |  |
| 25 | Normalized Producer Name | `s10lakqv` | formula (system) | formula: `TEXT([ss125ogh])` |  |
| 26 | CRM | `se67e6e718` | lookup (system) | lookup via `s05ab1053c` |  |
| 27 | Normalized Client Relations Manager | `s3neaotq` | formula (system) | formula: `TEXT([se67e6e718])` |  |
| 28 | Update Completed O | `s2c3aed14b` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 29 | Sold Date | `s1882e616f` | lookup (system) | lookup via `s05ab1053c` |  |
| 30 | Days Open | `s939cb7bec` | formula (system) | formula: `DATEDIFF([s9dc163dd1],[sb4db4bc6f],"days")` |  |
| 31 | Formula sold date | `sb4db4bc6f` | formula (system) | formula: `DATE([s1882e616f])` | `{ "date": null, "include_time": false }` |
| 32 | Formula for Failed Completion | `s9dc163dd1` | formula (system) | formula: `IF( AND([sdb5069dbd] == "Failed", [s5cd2f1d5a] == "Verified - Complete"), [s2c3aed14b], TODAY() )` | `{ "date": "2026-03-16T00:00:00Z", "include_time": false }` |
| 33 | Formula | `sf1ef34a9e` | formula (system) | formula: `RECORD_ID()` | `"6971540d09a50d070e1e461e"` |

## Linked tables

- **Deal** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Completed By** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **template_id** → The Audit Templates Table (`69532d09f018acf38e53443a`)
