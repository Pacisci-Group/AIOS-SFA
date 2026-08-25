# The Service Tickets Table

**Table ID:** `6941fdb3dc9a6d024fd8d23d`

**Field counts:** total: 31, linkedrecordfield: 5, lookupfield: 4, formulafield: 8

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"#SFAS-002"` |
| 2 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-10T18:02:56.402000Z" }` |
| 3 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-10T23:56:19.905000Z" }` |
| 4 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 5 | Open Comments | `comments_count` | number (system) |  | `1` |
| 6 | Ticket ID | `autonumber` | number (system) | unique | `1` |
| 7 | Created Date | `created_date` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 8 | Category | `category` | single-select | choices: `Onboarding`=Onboarding, `Endorsement`=Endorsement, `Billing`=Billing, `Claims Assist`=Claims Assist, `Renewal Review`=Renewal Review, `Other`=Other, `4osEm`=Policy Change, `Nr2xm`=Payment, `0E0RC`=Company Transfer, `sKLrt`=Save, `fieTl`=Termination, `Q3ktu`=Renewal Taken | `"Onboarding" (Onboarding)` |
| 9 | Priority | `priority` | single-select | choices: `Low`=Low, `Medium`=Medium, `High`=High, `Urgent`=Urgent | `"Low" (Low)` |
| 10 | Due Date | `due_date` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 11 | Notes | `notes` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 12 | Policy | `s12d537d98` | link | → **The Policies Table** (`6941fc5b08644a5fbf05a781`), single | `[ "6957ed74aef93dc425a59525" ]` |
| 13 | Household | `s85ccd75be` | link | → **The Households Table** (`6941fa11964c58f31380427c`), single | `[ "695ea0b44ad7d72d8cd9423e" ]` |
| 14 | Count | `sf3897556b` | number |  | `"1"` |
| 15 | Link to Deals (Sold Log) | `sgjy4lc5` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 16 | Assigned Client Relation Manager | `s4ec085028` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fd60a37eddb6b8d46eb6b" ]` |
| 17 | Client Relations Manager | `sf932f6994` | lookup (system) | lookup via `s4ec085028` | `[ [ { "title": "", "first_name": "Ashley", "middle_name": "", "last_name": "M...` |
| 18 | Status | `s7afd05edc` | status | choices: `backlog`=Open, `in_progress`=In Progress, `ready_for_review`=Waiting on Client, `a2E7K`=Waiting on Carrier, `complete`=Resolved, `r1Glf`=Closed | `"backlog" (Open)` |
| 19 | Date Resolved | `s879083121` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 20 | Days Open | `s8a59a03dd` | formula (system) | formula: `DATEDIFF([first_created],TODAY(),"days")` | `"65"` |
| 21 | Created by | `s53333e8c3` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fd53df3f2000f3515d09f" ]` |
| 22 | Primary Name | `s8b3e2a869` | lookup (system) | lookup via `s85ccd75be` | `[ [ { "title": "", "first_name": "", "middle_name": "", "last_name": "", "sys...` |
| 23 | Primary Phone | `su3l3wdt` | lookup (system) | lookup via `s85ccd75be` | `[ [ [] ] ]` |
| 24 | Rec Id | `s317d338b8` | formula (system) | formula: `RECORD_ID()` | `"6962945053d569531fe95539"` |
| 25 | user rec id | `s48160e5f9` | lookup (system) | lookup via `s4ec085028` | `[ [ "695fd60a37eddb6b8d46eb6b" ] ]` |
| 26 | Ticket Notes | `sed733068f` | string (multi-line) |  | `"lorem ipsiu"` |
| 27 | first_created_ymd | `s40bc4fd56` | formula (system) | formula: `NUMBER(CONCAT(YEAR([first_created]), RIGHT("0" + TEXT(MONTH([first_created]])), 2), RIGHT("0" + TEXT(DAY([first_created]])), 2)))` | `"20260110"` |
| 28 | last_updated_ymd | `svhetxfp` | formula (system) | formula: `NUMBER(CONCAT(YEAR([last_updated]), RIGHT("0" + TEXT(MONTH([last_updated])), 2), RIGHT("0" + TEXT(DAY([last_updated]])), 2)))` | `"20260110"` |
| 29 | Normalized CRM Name | `s43ee2ba8f` | formula (system) | formula: `TEXT([sf932f6994])` | `"Ashley Medina"` |
| 30 | Normalized Client Name | `setuud00` | formula (system) | formula: `TEXT([s8b3e2a869])` | `"Eric Harris"` |
| 31 | Normalized Created By | `s6e4995d56` | formula (system) | formula: `TEXT([s53333e8c3].[sc07f0ceb3])` | `"Yessenia Campos"` |
| 32 | Update URL | `s4d00cec04` | formula (system) | formula: `CONCAT("https://paciscigroup.fillout.com/t/eDehGGjTXPus?id=", RECORD_ID())` | `"https://paciscigroup.fillout.com/t/eDehGGjTXPus?id=6962945053d569531fe95539"` |

## Linked tables

- **Policy** → The Policies Table (`6941fc5b08644a5fbf05a781`)
- **Household** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Deals (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Assigned Client Relation Manager** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Created by** → The Users Table (`69422c487eafe925c8e4bbfa`)
