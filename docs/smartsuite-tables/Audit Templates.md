# The Audit Templates Table

**Table ID:** `69532d09f018acf38e53443a`

**Field counts:** total: 13, linkedrecordfield: 1

## Fields

| # | Field Name | Field Id | Type | Notes | Example |
|---|------------|----------|------|-------|---------|
| 1 | Audit Item Name | `title` | string (title) | required | `"Correct Sold Date"` |
| 2 | Description | `description` | richtext (SmartDoc) |  | `{ "data": { "type": "doc", "content": [] }, "html": "", "preview": "" }` |
| 3 | First Created | `first_created` | object { by, on } (system) |  | `{ "by": "65550784e0d0dcc6fe3fc3aa", "on": "2025-12-30T02:49:35.872000Z" }` |
| 4 | Last Updated | `last_updated` | object { by, on } (system) |  | `{ "on": "2026-03-13T16:24:11.849000Z", "by": "65550784e0d0dcc6fe3fc3aa" }` |
| 5 | Followed by | `followed_by` | string[] (member ids) |  | `[ "5dd812b9d8b7863532d3ddd2", "5e6ec7dadc8a90f33bcb02c9" ]` |
| 6 | Open Comments | `comments_count` | number (system) |  | `1` |
| 7 | Auto Number | `autonumber` | number (system) | unique | `1` |
| 8 | Audit Category | `sa38a2d635` | single-select | choices: `VeW4i`=Auto, `m1LoO`=Home, `ehjDd`=Landlord, `hQrq6`=Common | `"VeW4i" (Auto)` |
| 9 | Required | `s68ec160c0` | boolean |  | `true` |
| 10 | Blocking | `sowlcvdy` | boolean |  | `true` |
| 11 | Active | `sgdipwqk` | boolean |  | `true` |
| 12 | Link to Deal Audit Items | `sni45ge9` | link[] | → **The Deal Audit Items Table** (`69533b022b0995e027431c02`), multiple | `[ "6974f3ebec9088de8aa50994", "69751c7bfb32392c224a4278", "697522ce4fab54ba29...` |
| 13 | Always Include | `sa8f5c7a37` | boolean |  | `true` |
| 14 | Task/Next Steps | `s53430cc34` | string |  | `"Start one"` |

## Linked tables

- **Link to Deal Audit Items** → The Deal Audit Items Table (`69533b022b0995e027431c02`)
