# The Time Off Request Table

**Table ID:** `696dd246b1bf4b889f2fb4fa`

**Field counts:** total: 21, linkedrecordfield: 2, lookupfield: 1, formulafield: 3

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"Record 1"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "<div class=\"rendered\">\n \n</div>" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "on": "2020-06-05T22:46:20.336000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2020-06-19T19:11:46.042000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Producer | `s11756232f` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single |  |
| 9 | Start Date | `s797e8e425` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 10 | End Date | `sfc03f2e87` | date { date, include_time } |  | `"2020-03-18T16:53:21.743000Z"` |
| 11 | Request Type | `s4de941e84` | single-select | choices: `FEJyv`=Full Day(s), `sbIWx`=Partial Day (Hours) | `"FEJyv" (Full Day(s))` |
| 12 | Hours Requested | `s69a804f9d` | number |  | `"0.10"` |
| 13 | Status | `s15cf96e61` | status | choices: `backlog`=Submitted, `in_progress`=Approved, `ready_for_review`=Denied, `complete`=Cancelled | `"backlog" (Submitted)` |
| 14 | Approved by | `s6d8a8e5ee` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |
| 15 | Producer Name | `s7214abdd4` | lookup (system) | lookup via `s11756232f` |  |
| 16 | Normalized Producer Name | `se0c4e0755` | formula (system) | formula: `TEXT([s7214abdd4])` |  |
| 17 | start_date_ymd | `s74318e631` | formula (system) | formula: `NUMBER(CONCAT(YEAR([s797e8e425]), RIGHT("0" + TEXT(MONTH([s797e8e425])), 2), RIGHT("0" + TEXT(DAY([s797e8e425])), 2)))` |  |
| 18 | end_date_ymd | `sm1mg4zu` | formula (system) | formula: `NUMBER(CONCAT(YEAR([sfc03f2e87]), RIGHT("0" + TEXT(MONTH([sfc03f2e87])), 2), RIGHT("0" + TEXT(DAY([sfc03f2e87])), 2)))` |  |
| 19 | start_yyyymmdd_num | `s1fad5da88` | number |  | `"0.10"` |
| 20 | end_yyyymmdd_num | `s487c69767` | number |  | `"0.10"` |
| 21 | Type | `sec9109888` | single-select | choices: `Aw0Xh`=Unpaid, `ROgIb`=PTO, `FaIkv`=Sick | `"Aw0Xh" (Unpaid )` |
| 22 | Decision | `s9f9622cf9` | single-select | choices: `yX9Ig`=Approve, `4sKn5`=Deny | `"yX9Ig" (Approve)` |

## Linked tables

- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Approved by** → The Households Table (`6941fa11964c58f31380427c`)
