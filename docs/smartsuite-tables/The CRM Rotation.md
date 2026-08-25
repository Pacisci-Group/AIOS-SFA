# The CRM Rotation Table

**Table ID:** `695ec474897e7b72911f64d7`

**Field counts:** total: 11, linkedrecordfield: 2, lookupfield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Title | `title` | string (title) | required; unique | `"Ashley Medina"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-08T16:32:37.516000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2026-01-21T19:00:15.455000Z" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Client Relationship Manager | `s5501fe08f` | link[] | → **The Users Table** (`69422c487eafe925c8e4bbfa`), multiple | `[ "695fd60a37eddb6b8d46eb6b" ]` |
| 9 | Order | `s2bd7dda40` | number |  | `"1"` |
| 10 | Active for Producer | `s12e33f568` | boolean |  | `true` |
| 11 | CRM Name | `s7d1a809d9` | lookup (system) | lookup via `s5501fe08f` | `[ [ { "title": "", "first_name": "Ashley", "middle_name": "", "last_name": "M...` |
| 12 | Producer | `s1d18f0067` | link | → **The Users Table** (`69422c487eafe925c8e4bbfa`), single | `[ "695fc4486d97c1ad64843b4f" ]` |

## Linked tables

- **Client Relationship Manager** → The Users Table (`69422c487eafe925c8e4bbfa`)
- **Producer** → The Users Table (`69422c487eafe925c8e4bbfa`)
