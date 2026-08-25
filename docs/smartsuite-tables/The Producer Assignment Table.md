# The Producer Assignment Table Table

**Table ID:** `695ec3890ac528daf6607fa2`

**Field counts:** total: 13, linkedrecordfield: 2, lookupfield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"David Howard"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-08T16:36:57.392000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-02-02T19:38:35.495000Z" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Producer | `sa4b1fdd09` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695a8762ea471a2a3d384f3c" ]` |
| 9 | Last Assigned Client Relationship Manager | `s5501fe08f` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fd60a37eddb6b8d46eb6b" ]` |
| 10 | Index/Pointer | `s2bd7dda40` | number |  | `"1"` |
| 11 | Active for Producer | `s12e33f568` | boolean |  | `true` |
| 12 | Last Assigned at | `s787019847` | date { date, include_time } |  | `{ "date": "2026-02-02T19:38:35.326000Z", "include_time": true }` |
| 13 | Lock | `sb5b78f0b7` | boolean |  | `true` |
| 14 | Producer Name | `s1241bc504` | lookup (system) | lookup via `sa4b1fdd09` | `[ [ { "title": "", "first_name": "David", "middle_name": "", "last_name": "Ho...` |

## Linked tables

- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Last Assigned Client Relationship Manager** → The Users Table (`69422c487eafe925c8e4bbfa`)
