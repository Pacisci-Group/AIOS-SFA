# The Households Table

**Table ID:** `6941fa11964c58f31380427c`

**Field counts:** total: 49, linkedrecordfield: 16, lookupfield: 8, rollupfield: 2, formulafield: 5

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | SS Household ID | `title` | string (title) | required; unique | `"#HH0001"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "", "preview": "", "yjsData": "AAA=" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65593df9b9f9e7975ac9399b", "on": "2025-12-22T18:44:04.144000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2026-03-03T14:04:21.579000Z", "by": "65550784e0d0dcc6fe3fc3aa" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Household ID | `autonumber` | number (system) | unique | `1` |
| 8 | Household Status | `s5f13c562d` | single-select | choices: `b5qvJ`=Active, `QmEth`=Inactive | `"b5qvJ" (Active)` |
| 9 | CSR Assigned Date | `sfdc881f4b` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 10 | Property Address | `s3c3e21ee2` | object (address) |  | `{ "location_address": "", "location_address2": "", "location_city": "", "loca...` |
| 11 | Household Name | `sb63528cc7` | string |  | `"Start one"` |
| 12 | Household Notes | `se18d2e306` | string (multi-line) |  | `"lorem ipsiu"` |
| 13 | Mailing Same as Property Address | `sf2d95c153` | boolean |  | `true` |
| 14 | Mailing Address | `s43e6ec449` | object (address) |  | `{ "location_address": "", "location_address2": "", "location_city": "", "loca...` |
| 15 | Link to Contacts | `s597vld9` | link[] | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), multiple | `[ "697b8e3a0ca42e0e64ea62e2", "698d13561d2500598b8dd46a" ]` |
| 16 | Link to Policies | `sk4iqhs3` | link[] | → **The Policies Table** (`6941fc5b08644a5fbf05a781`), multiple | `[ "69a6ea6571ff5a1b2545d16e" ]` |
| 17 | Link to Service Tickets | `sbihflya` | link[] | → **The Service Tickets Table** (`6941fdb3dc9a6d024fd8d23d`), multiple | `[ "69a86e5e5d333417e90f53fc" ]` |
| 18 | Link to Document Index | `s09wqosq` | link[] | → **_(external)_** (`69422a7d19c89735e27c78f6`), multiple |  |
| 19 | Primary Contact | `sdb36b3217` | link | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), single | `[ "697b8e3a0ca42e0e64ea62e2" ]` |
| 20 | Household Members | `suxra4lb` | link[] | → **The Contacts Table** (`6941fb21eea41b87f26cd10d`), multiple | `[ "697b8e3a0ca42e0e64ea62e2", "698d13561d2500598b8dd46a" ]` |
| 21 | Policy Number(s) | `scbe7ccc2a` | link[] | → **The Policies Table** (`6941fc5b08644a5fbf05a781`), multiple |  |
| 22 | Link to Leads | `sch3hdll` | link[] | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), multiple | `[ "697b8e3cae16b5886d29267b" ]` |
| 23 | Link to Quote Recaps | `sux1osu4` | link[] | → **The Quote Recaps Table** (`6941fdb2dc9a6d024fd8bc53`), multiple | `[ "697b942720646a1ac63b89a8" ]` |
| 24 | Link to Prior Insurance | `s3uakv48` | link[] | → **The Prior Insurance Table** (`69423c25d4f749d1e15c017a`), multiple | `[ "698d143695b3f71106ea5965" ]` |
| 25 | Assigned Client Relations Manager | `se5d1492f3` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fd60a37eddb6b8d46eb6b" ]` |
| 26 | Assigned CRM Name | `sa5347decc` | lookup (system) | lookup via `se5d1492f3` | `[ [ { "title": "", "first_name": "Ashley", "middle_name": "", "last_name": "M...` |
| 27 | Assigned CRM Email | `skqoimwj` | lookup (system) | lookup via `se5d1492f3` | `[ [ [ "ashleymedina2@allstate.com" ] ] ]` |
| 28 | Assigned CRM Status | `sydb202v` | lookup (system) | lookup via `se5d1492f3` | `[ [ "D7jD5" ] ]` |
| 29 | Total Active Policies | `s734c4c9d4` | rollup (system) | rollup via `sk4iqhs3` | `"1"` |
| 30 | Open Service Tickets Count | `sed441bf11` | rollup (system) | rollup via `sbihflya` | `1` |
| 31 | Link to Deals (Sold Log) | `ssjxhhzu` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple | `[ "698d14405cdd6dacd4544dda" ]` |
| 32 | Link to Prior Policy ID | `s7bh3tty` | link[] | → **The Prior Policies Table** (`69423e89ea5c9f2798e4bc00`), multiple |  |
| 33 | Link to Interested Parties | `sdcj4ybj` | link[] | → **The Interested Parties Table** (`694240c03d897b7099d73340`), multiple |  |
| 34 | Primary Email | `se05e29831` | lookup (system) | lookup via `sdb36b3217` | `[ [] ]` |
| 35 | Primary Phone | `sugaqz8o` | lookup (system) | lookup via `sdb36b3217` | `[ [ [ { "phone_country": "US", "phone_number": "405-227-7627", "phone_extensi...` |
| 36 | Primary Full Name | `sbxmq2cl` | lookup (system) | lookup via `sdb36b3217` | `[ [ { "title": "", "first_name": "Randall", "middle_name": "", "last_name": "...` |
| 37 | VIP | `sa615641fd` | boolean |  | `true` |
| 38 | address_key | `scc65c7c7c` | string |  | `"Start one"` |
| 39 | hh rec id | `sc34da3ee3` | formula (system) | formula: `RECORD_ID()` | `"6949917405c3d58fb026862f"` |
| 40 | ss hh | `s8f439ba5c` | string |  | `"Start one"` |
| 41 | Effective Date | `s5cc50503a` | lookup (system) | lookup via `sk4iqhs3` | `[ [ { "date": null, "include_time": false } ] ]` |
| 42 | Most Recent Effective Date | `sd2985de61` | formula (system) | formula: `MAX([scbe7ccc2a].[s17370a3f9])` | `{ "date": null, "include_time": false }` |
| 43 | Link to Time Off Request 1 | `sjh0s2hi` | link[] | → **The Time Off Request Table** (`696dd246b1bf4b889f2fb4fa`), multiple |  |
| 44 | mail_log_token | `s6dc79d177` | string |  | `"Start one"` |
| 45 | Normalized Primary Name | `sbdc50a856` | formula (system) | formula: `TEXT([sbxmq2cl])` | `"Randall Smith"` |
| 46 | Normalized CRM Name | `s74af8700d` | formula (system) | formula: `TEXT([sa5347decc])` | `"Ashley Medina"` |
| 47 | Fillout Update | `s827916d12` | formula (system) | formula: `CONCAT("https://paciscigroup.fillout.com/t/9xeBjzfn2Qus?id=", RECORD_ID())` | `"https://paciscigroup.fillout.com/t/9xeBjzfn2Qus?id=6949917405c3d58fb026862f"` |
| 48 | Primary Contact Update | `s5b6558d68` | lookup (system) | lookup via `sdb36b3217` | `[ [ "https://paciscigroup.fillout.com/t/8HFEZ3xTw9us?id=697b8e3a0ca42e0e64ea6...` |
| 49 | Link to Deal Audits | `sdltzohq` | link[] | → **The Deal Audits Table** (`6941fdb2dc9a6d024fd8caef`), multiple |  |
| 50 | Spanish Speaking | `sf4a8cca4f` | boolean |  | `true` |

## Linked tables

- **Link to Contacts** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
- **Link to Policies** → The Policies Table (`6941fc5b08644a5fbf05a781`)
- **Link to Service Tickets** → The Service Tickets Table (`6941fdb3dc9a6d024fd8d23d`)
- **Link to Document Index** → _(external — not in provided docs)_ (`69422a7d19c89735e27c78f6`)
- **Primary Contact** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
- **Household Members** → The Contacts Table (`6941fb21eea41b87f26cd10d`)
- **Policy Number(s)** → The Policies Table (`6941fc5b08644a5fbf05a781`)
- **Link to Leads** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Link to Quote Recaps** → The Quote Recaps Table (`6941fdb2dc9a6d024fd8bc53`)
- **Link to Prior Insurance** → The Prior Insurance Table (`69423c25d4f749d1e15c017a`)
- **Assigned Client Relations Manager** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Link to Deals (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Link to Prior Policy ID** → The Prior Policies Table (`69423e89ea5c9f2798e4bc00`)
- **Link to Interested Parties** → The Interested Parties Table (`694240c03d897b7099d73340`)
- **Link to Time Off Request 1** → The Time Off Request Table (`696dd246b1bf4b889f2fb4fa`)
- **Link to Deal Audits** → The Deal Audits Table (`6941fdb2dc9a6d024fd8caef`)
