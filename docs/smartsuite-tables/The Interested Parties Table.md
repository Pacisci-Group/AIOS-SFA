# The Interested Parties Table

**Table ID:** `694240c03d897b7099d73340`

**Field counts:** total: 20, linkedrecordfield: 3, lookupfield: 4

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Interested Party ID | `title` | string (title) | required; unique | `"Record 1"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "<div class=\"rendered\">\n \n</div>" }` |
| 3 | Status | `status` | status | choices: `backlog`=Not Started, `ready_for_review`=Sent, `complete`=Confirmed | `"backlog" (Not Started)` |
| 4 | Due Date | `due_date` | daterange { from_date, to_date } |  | `{ "from_date": { "date": "2021-09-03T03:00:00Z", "include_time": true }, "to_...` |
| 5 | Priority | `priority` | single-select | choices: `urgent`=Urgent, `high`=High, `normal`=Normal, `low`=Low | `"urgent" (Urgent)` |
| 6 | First Created | `first_created` | object { by, on } (system) |  | `{ "on": "2020-06-05T22:46:20.336000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 7 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2020-06-19T19:11:46.042000Z", "by": "5ec1df770a8617c27a73e3c3" }` |
| 8 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 9 | Open Comments | `comments_count` | number (system) |  | `1` |
| 10 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 11 | Notes | `scdc78adaa` | string (multi-line) |  | `"lorem ipsiu"` |
| 12 | Policy | `se907854ce` | link | → **The Policies Table** (`6941fc5b08644a5fbf05a781`), single |  |
| 13 | Mortgagee | `s2fb0c5024` | string |  | `"Start one"` |
| 14 | Address | `s6a36e6f8f` | object (address) |  | `{ "location_address": "", "location_address2": "", "location_city": "Southamp...` |
| 15 | Loan Number | `s19be4460e` | string |  | `"Start one"` |
| 16 | Policy Number | `s0d394d2ed` | lookup (system) | lookup via `se907854ce` |  |
| 17 | Policy Type | `spspwukg` | lookup (system) | lookup via `se907854ce` |  |
| 18 | Houehold ID | `s005931699` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single |  |
| 19 | Household Name | `s831b108f7` | lookup (system) | lookup via `s005931699` |  |
| 20 | Assigned CRM Name | `shdds7ll` | lookup (system) | lookup via `s005931699` |  |
| 21 | Link to Deals (Sold Log) | `svcscux8` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |

## Linked tables

- **Policy** → The Policies Table (`6941fc5b08644a5fbf05a781`)
- **Houehold ID** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Deals (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
