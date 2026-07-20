# The Prior Policies Table

**Table ID:** `69423e89ea5c9f2798e4bc00`

**Field counts:** total: 21, linkedrecordfield: 4, lookupfield: 3

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Prior Policy Number | `title` | string (title) | required; unique | `"Record 1"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "<div class=\"rendered\">\n \n</div>" }` |
| 3 | Cancellation Status | `status` | status | choices: `backlog`=Not Started, `in_progress`=In Progress, `ready_for_review`=Submitted, `complete`=Confirm, `aFuHB`=Not Needed | `"backlog" (Not Started)` |
| 4 | First Created | `first_created` | object { by, on } (system) |  | `{ "on": "2020-06-05T22:46:20.336000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 5 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2020-06-19T19:11:46.042000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 6 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 7 | Open Comments | `comments_count` | number (system) |  | `1` |
| 8 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 9 | Deal | `sc59cc32b8` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 10 | Prior Insurance ID | `sb04421c43` | link[] | → **The Prior Insurance Table** (`69423c25d4f749d1e15c017a`), multiple |  |
| 11 | Policy Type | `sb3cc60eb5` | single-select | choices: `XT6s7`=Auto, `fr4Ge`=Home, `RWdTl`=Other | `"XT6s7" (Auto)` |
| 12 | Needs Cancellation | `s9fecf50b8` | single-select | choices: `yes`=Yes, `no`=No | `"yes" (Yes)` |
| 13 | Cancellation Date | `sb5bc8466d` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 14 | Accord Form Needed | `sd12264dbf` | single-select | choices: `yes`=Yes, `no`=No | `"yes" (Yes)` |
| 15 | Previous Carrier | `sbd76ff6b4` | string |  | `"Start one"` |
| 16 | Notes | `se683bb2aa` | string (multi-line) |  | `"lorem ipsiu"` |
| 17 | Completed Date | `s596e17941` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 18 | Completed By | `sb58fca17e` | link[] | → **The Users Table** (`69422c487eafe925c8e4bbfa`), multiple |  |
| 19 | Cancellation Responsibility | `s45b58b429` | lookup (system) | lookup via `sb04421c43` |  |
| 20 | Onboarding Client Relations Manager Name | `s28e8194d1` | lookup (system) | lookup via `sc59cc32b8` |  |
| 21 | Household | `s07708c46c` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |
| 22 | Household Name | `s908e15ae2` | lookup (system) | lookup via `s07708c46c` |  |

## Linked tables

- **Deal** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Prior Insurance ID** → The Prior Insurance Table (`69423c25d4f749d1e15c017a`)
- **Completed By** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Household** → The Households Table (`6941fa11964c58f31380427c`)
