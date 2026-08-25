# The Users Table

**Table ID:** `69422c487eafe925c8e4bbfa`

**Field counts:** total: 61, linkedrecordfield: 21, formulafield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | User ID | `title` | string (title) | required; unique | `"sok0000"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": {}, "html": "", "preview": "", "yjsData": "AAA=" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-23T01:04:12.614000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-02-11T15:33:37.558000Z" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | First Name | `s301929112` | string |  | `"Sample"` |
| 9 | Full Name | `sc07f0ceb3` | object { first_name, middle_name, last_name } |  | `"1" (Mr.)` |
| 10 | Last Name | `s67dadd3ec` | string |  | `"Sample"` |
| 11 | Email | `s98a9dc07e` | string[] (emails) |  | `[ "david.classicchevy@gmail.com" ]` |
| 12 | Phone | `s96dd1525b` | phone[] |  | `[ { "phone_country": "55", "phone_number": "51 995702813", "phone_extension":...` |
| 13 | Department | `s60e850437` | single-select | choices: `QIQY4`=Producer (Internal), `rFBaT`=Client Relations Manager, `r3t9q`=Producer External, `QRN7I`=Office Manager, `YEZGC`=Onwer, `7yrCl`=Data Team, `93WG6`=Super Admin | `"QIQY4" (Producer (Internal))` |
| 14 | User Type | `sa606429d7` | single-select | choices: `Z0sqS`=Internal, `F21zX`=External | `"Z0sqS" (Internal)` |
| 15 | Employee Status | `s0315d110f` | single-select | choices: `D7jD5`=Active, `IjrXC`=Inactive, `cPzY7`=Terminated, `8MSdl`=Leave | `"D7jD5" (Active)` |
| 16 | Round Robin Sales Eligible | `s1f0834207` | boolean |  | `true` |
| 17 | Round Robin Service Eligible | `spdoq3rn` | boolean |  | `true` |
| 18 | Out of Office Start | `sd4b43463f` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 19 | Out of Office End | `sld358f8` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 20 | Last Assigned Timestamp | `s88282ab26` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 21 | Notes | `s0e4fa3b32` | string (multi-line) |  | `"lorem ipsiu"` |
| 22 | Sub Producer Code | `s89b472465` | string |  | `"100"` |
| 23 | Link to Leads | `sk34h2sp` | link[] | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), multiple | `[ "69499170bce823a45357bc03", "694994629324d75f7fed5457", "6949c13e50001f09a9...` |
| 24 | Link to Quote Recaps | `s70i46ck` | link[] | → **The Quote Recaps Table** (`6941fdb2dc9a6d024fd8bc53`), multiple | `[ "694de2b0e53a126458a81467" ]` |
| 25 | Producer (Sold Log) | `soq2xlgo` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple | `[ "69687890b68d96fdbfa23d56", "69687890b68d96fdbfa23dac", "69687890b68d96fdbf...` |
| 26 | CRM (Sold Log) | `s4gdztyy` | link[] | → **The Deals (Sold Log) Table** (`6941fdb2dc9a6d024fd8c3a1`), multiple |  |
| 27 | Link to Prior Policy ID | `svypf12n` | link[] | → **The Prior Policies Table** (`69423e89ea5c9f2798e4bc00`), multiple | `[ "69706fc8c7211301b8ec1f19" ]` |
| 28 | Link to Households | `s18lr779` | link[] | → **The Households Table** (`6941fa11964c58f31380427c`), multiple |  |
| 29 | Link to Prior Insurance | `s9knkavf` | link[] | → **The Prior Insurance Table** (`69423c25d4f749d1e15c017a`), multiple | `[ "697053a5e8e76384edcd9ab8", "69706fd557847cca53c814a1", "6980fc81a09723ccd4...` |
| 30 | Link to Service Tickets | `szxo5zf9` | link[] | → **The Service Tickets Table** (`6941fdb3dc9a6d024fd8d23d`), multiple |  |
| 31 | Invite Status | `sf6b68ba6d` | status | choices: `backlog`=Not Sent, `in_progress`=Sent, `complete`=Accepted, `ready_for_review`=Error | `"backlog" (Not Sent)` |
| 32 | Clerk User ID | `sf993dbf77` | string |  | `"user_37ouzYSGWsfmU5MGMgTnrQka11v"` |
| 33 | Clerk Invitation ID | `s8cd4de3d8` | string |  | `"Start one"` |
| 34 | Invite Date | `s03f0322cc` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 35 | Accepted Date | `sa826ef981` | date { date, include_time } |  | `{ "date": "2025-12-23T22:18:11.045000Z", "include_time": true }` |
| 36 | SmartSuite User Record ID | `s1307bd77f` | formula (system) | formula: `RECORD_ID()` | `"6949ea8ce7bd47c74b04e630"` |
| 37 | Invite Error | `s065a142a1` | string (multi-line) |  | `"lorem ipsiu"` |
| 38 | SOK | `s73acf800f` | string |  | `"sok0000"` |
| 39 | Link to Independent Referral | `sgynsl6t` | link[] | → **_(external)_** (`6952b2daee9aacd3c6bae6e3`), multiple |  |
| 40 | Link to Audit Templates | `s67141tz` | link[] | → **The Deal Audit Items Table** (`69533b022b0995e027431c02`), multiple |  |
| 41 | Send Invite | `seb65a8483` | boolean |  | `true` |
| 42 | Role | `sd68wn2p` | single-select | choices: `QIQY4`=producer, `rFBaT`=admin, `r3t9q`=referral_partner, `QRN7I`=client, `dK2we`=crm | `"QIQY4" (producer)` |
| 43 | Link to CRM Rotation | `sibugfxe` | link[] | → **The Producer Assignment Table Table** (`695ec3890ac528daf6607fa2`), multiple | `[ "6960052a9811c25d65a6e9ea" ]` |
| 44 | Link to CRM Rotation 1 | `s11edvw8` | link[] | → **The Producer Assignment Table Table** (`695ec3890ac528daf6607fa2`), multiple |  |
| 45 | Link to Producer Assignment Table 1 | `scmxf0sa` | link[] | → **The CRM Rotation Table** (`695ec474897e7b72911f64d7`), multiple |  |
| 46 | clerk_org_id | `s4a1db42c7` | string |  | `"Start one"` |
| 47 | clerk_org_role | `sd477x2l` | string |  | `"Start one"` |
| 48 | Link to Service Tickets 1 | `sqp3j5e3` | link[] | → **The Service Tickets Table** (`6941fdb3dc9a6d024fd8d23d`), multiple |  |
| 49 | Link to Leads 1 | `spdbo6kc` | link[] | → **The Leads Table** (`6941fdb1dc9a6d024fd8b505`), multiple |  |
| 50 | Link to Missing Quote Control Numbers | `so919tur` | link[] | → **_(external)_** (`6967b996cefea47dc199b444`), multiple |  |
| 51 | Link to Employee Attendance | `s36zd7vf` | link[] | → **_(external)_** (`696907762083a4dad8b8d08e`), multiple |  |
| 52 | Link to Time Off Request | `s796u3lv` | link[] | → **The Time Off Request Table** (`696dd246b1bf4b889f2fb4fa`), multiple |  |
| 53 | Link to Bug/Feature Request | `spyph8qm` | link[] | → **_(external)_** (`696dd26fddd6dd71ddaf7ae2`), multiple |  |
| 54 | Link to CRM Rotation 2 | `sfezgwyp` | link[] | → **The CRM Rotation Table** (`695ec474897e7b72911f64d7`), multiple | `[ "69712300525f6f210a6a5501", "69712300525f6f210a6a5502", "69712300525f6f210a...` |
| 55 | Link to Commission Ledger | `shnvlifp` | link[] | → **_(external)_** (`6984aa6b0e79f7575da0956d`), multiple |  |
| 56 | Is Active | `sdf74e188c` | boolean |  | `true` |
| 57 | eligible_lead_sources | `s0a807044f` | multi-select | choices: `KrcJh`=Waterstone, `vNL3U`=House | `"KrcJh" (Waterstone)` |
| 58 | rrWeight | `s0b74fad23` | number |  | `"0.10"` |
| 59 | rr_state | `s7b97d5078` | string (multi-line) |  | `"lorem ipsiu"` |
| 60 | rr_lock | `s49f49993c` | string |  | `"Start one"` |
| 61 | rr_lock_expires at_Date | `s41c72176c` | date { date, include_time } |  | `{ "date": null, "include_time": false }` |
| 62 | Monthly Goal | `s72ea8dfab` | number |  | `"0.10"` |

## Linked tables

- **Link to Leads** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Link to Quote Recaps** → The Quote Recaps Table (`6941fdb2dc9a6d024fd8bc53`)
- **Producer (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **CRM (Sold Log)** → The Deals (Sold Log) Table (`6941fdb2dc9a6d024fd8c3a1`)
- **Link to Prior Policy ID** → The Prior Policies Table (`69423e89ea5c9f2798e4bc00`)
- **Link to Households** → The Households Table (`6941fa11964c58f31380427c`)
- **Link to Prior Insurance** → The Prior Insurance Table (`69423c25d4f749d1e15c017a`)
- **Link to Service Tickets** → The Service Tickets Table (`6941fdb3dc9a6d024fd8d23d`)
- **Link to Independent Referral** → _(external — not in provided docs)_ (`6952b2daee9aacd3c6bae6e3`)
- **Link to Audit Templates** → The Deal Audit Items Table (`69533b022b0995e027431c02`)
- **Link to CRM Rotation** → The Producer Assignment Table Table (`695ec3890ac528daf6607fa2`)
- **Link to CRM Rotation 1** → The Producer Assignment Table Table (`695ec3890ac528daf6607fa2`)
- **Link to Producer Assignment Table 1** → The CRM Rotation Table (`695ec474897e7b72911f64d7`)
- **Link to Service Tickets 1** → The Service Tickets Table (`6941fdb3dc9a6d024fd8d23d`)
- **Link to Leads 1** → The Leads Table (`6941fdb1dc9a6d024fd8b505`)
- **Link to Missing Quote Control Numbers** → _(external — not in provided docs)_ (`6967b996cefea47dc199b444`)
- **Link to Employee Attendance** → _(external — not in provided docs)_ (`696907762083a4dad8b8d08e`)
- **Link to Time Off Request** → The Time Off Request Table (`696dd246b1bf4b889f2fb4fa`)
- **Link to Bug/Feature Request** → _(external — not in provided docs)_ (`696dd26fddd6dd71ddaf7ae2`)
- **Link to CRM Rotation 2** → The CRM Rotation Table (`695ec474897e7b72911f64d7`)
- **Link to Commission Ledger** → _(external — not in provided docs)_ (`6984aa6b0e79f7575da0956d`)
