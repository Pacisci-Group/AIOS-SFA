# SmartSuite Tables — Schema Reference

Lean, developer-focused schemas extracted from the SmartSuite API docs (source `.docx` from the Data Analyst), for the **SmartSuite → MongoDB migration** (PAC-7 / PAC-18).

Each table doc lists every field with its **Field Id** (the API/slug key used in record payloads), a normalized **Type**, **Notes** (select choices as `value`=Label, linked-table targets, formulas, required/unique), and one realistic **Example** value. Generic SmartSuite REST boilerplate (list/create/update/delete/pagination) was intentionally omitted — see [SmartSuite API docs](https://developers.smartsuite.com/) for those.

> **Migration notes:** `Field Id` is the stable key (field names can be renamed). Fields marked `(system)` are computed/read-only and cannot be set via API. Select values must be stored/normalized by their `value` code, not the label. Linked-record fields hold arrays of linked record ids.

## Tables

| Table | Table ID | Fields | Doc |
|-------|----------|-------:|-----|
| The Audit Templates Table | `69532d09f018acf38e53443a` | 14 | [Audit Templates.md](Audit%20Templates.md) |
| The CRM Rotation Table | `695ec474897e7b72911f64d7` | 12 | [The CRM Rotation.md](The%20CRM%20Rotation.md) |
| The Contacts Table | `6941fb21eea41b87f26cd10d` | 27 | [The Contacts Table.md](The%20Contacts%20Table.md) |
| The Deal Audit Items Table | `69533b022b0995e027431c02` | 33 | [Deal Audit Items.md](Deal%20Audit%20Items.md) |
| The Deal Audits Table | `6941fdb2dc9a6d024fd8caef` | 18 | [The Deal Audits Table.md](The%20Deal%20Audits%20Table.md) |
| The Deals (Sold Log) Table | `6941fdb2dc9a6d024fd8c3a1` | 98 | [The Deals (Sold Log) Table.md](The%20Deals%20%28Sold%20Log%29%20Table.md) |
| The Households Table | `6941fa11964c58f31380427c` | 50 | [The Households Table.md](The%20Households%20Table.md) |
| The Interested Parties Table | `694240c03d897b7099d73340` | 21 | [The Interested Parties Table.md](The%20Interested%20Parties%20Table.md) |
| The Leads Table | `6941fdb1dc9a6d024fd8b505` | 37 | [The Leads Table.md](The%20Leads%20Table.md) |
| The Policies Table | `6941fc5b08644a5fbf05a781` | 28 | [The Policies Table.md](The%20Policies%20Table.md) |
| The Prior Insurance Table | `69423c25d4f749d1e15c017a` | 22 | [The Prior Insurance Table.md](The%20Prior%20Insurance%20Table.md) |
| The Prior Policies Table | `69423e89ea5c9f2798e4bc00` | 22 | [The Prior Policies Table.md](The%20Prior%20Policies%20Table.md) |
| The Producer Assignment Table Table | `695ec3890ac528daf6607fa2` | 14 | [The Producer Assignment Table.md](The%20Producer%20Assignment%20Table.md) |
| The Quote Recaps Table | `6941fdb2dc9a6d024fd8bc53` | 32 | [The Quote Recaps Table.md](The%20Quote%20Recaps%20Table.md) |
| The Service Tickets Table | `6941fdb3dc9a6d024fd8d23d` | 32 | [The Service Tickets Table.md](The%20Service%20Tickets%20Table.md) |
| The Time Off Request Table | `696dd246b1bf4b889f2fb4fa` | 22 | [The Time Off Request Table.md](The%20Time%20Off%20Request%20Table.md) |
| The Users Table | `69422c487eafe925c8e4bbfa` | 62 | [The Users Table.md](The%20Users%20Table.md) |

## Producer Dashboard migration targets (PAC-18)

| SmartSuite source table | Target Mongo collection |
|-------------------------|-------------------------|
| The Deals (Sold Log) Table | `deals` |
| The Quote Recaps Table | `quoteRecaps` |
| The Leads Table | `leads` |
| The Households Table | `households` |
| Deal Audit Items | `auditRecords` |
| The Users Table | `users` (producer refs) |
| _derived_ | `activities`, `producerGoals` |
