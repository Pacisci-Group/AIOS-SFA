# The Prior Insurance Table

**Table ID:** `69423c25d4f749d1e15c017a`

**Field counts:** total: 21, linkedrecordfield: 4, lookupfield: 4

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Prior Insurance ID | `title` | string (title) | required; unique | `"Record 1"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "<div class=\"rendered\">\n \n</div>" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "on": "2020-06-05T22:46:20.336000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2020-06-19T19:11:46.042000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Deal | `sc59cc32b8` | link | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), single |  |
| 9 | Household | `sb04421c43` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single |  |
| 10 | Cancellation Responsibility | `sb3cc60eb5` | single-select | choices: `XT6s7`=SFA Call, `fr4Ge`=Customer Call | `"XT6s7" (SFA Call)` |
| 11 | Cancelled Previous Insurance | `s9fecf50b8` | single-select | choices: `yes`=Yes, `no`=No | `"yes" (Yes)` |
| 12 | Cancellation Date | `sb5bc8466d` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 13 | Auto & Home Same Carrier? | `sd12264dbf` | single-select | choices: `yes`=Yes, `no`=No | `"yes" (Yes)` |
| 14 | Previous Carrier Auto | `sbd76ff6b4` | string |  | `"Start one"` |
| 15 | Previous Carrier Home | `s005xf2q` | string |  | `"Start one"` |
| 16 | Previous Agent Name | `s7f775dc83` | string |  | `"Start one"` |
| 17 | Link to Prior Policy ID | `segq761j` | link[] | → **The Prior Policies Table** (`69423e89ea5c9f2798e4bc00`), multiple |  |
| 18 | Deal Status | `s87c64d70c` | lookup (system) | lookup via `sc59cc32b8` |  |
| 19 | Sold Date | `sbuuh8j5` | lookup (system) | lookup via `sc59cc32b8` |  |
| 20 | Household Name | `s5e0c72a50` | lookup (system) | lookup via `sb04421c43` |  |
| 21 | Producer | `s3dc982787` | link[] | → **The Users Table** (`69422c487eafe925c8e4bbfa`), multiple |  |
| 22 | Producer Name | `s98b183861` | lookup (system) | lookup via `s3dc982787` |  |

## Linked tables

- **Deal** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Prior Policy ID** → The Prior Policies Table (`69423e89ea5c9f2798e4bc00`)
- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
