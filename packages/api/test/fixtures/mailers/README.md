# Mailer import fixtures

## `rtp-sample.csv`

⚠ **Placeholder.** This is hand-authored from the column list and the values
measured against the real `SFA-RTP-2026-29.csv` (23 MB, 20,405 rows, 132
columns) — it is **not** a slice of that file, which has not been handed over
yet. Replace it with a trimmed, redacted ~200-row slice of the real file when
that arrives; the tests read it by path and need no other change.

It deliberately encodes the edge cases the import has to survive, so that a
regression in any of them fails a test rather than a production run:

| Row | What it covers |
|-----|----------------|
| 1 | All five money formats in one row; `county` `017`; `filler` as `4,195` against `squarefeet` `4195` |
| 2 | `donotmail: Yes` **with** a phone number — the compliance case; the `$2704.91/year*` vs `2704.915` float artifact |
| 3 | Empty `firstname`/`lastname` with a populated combined `name` — the split-on-first-space fallback |
| 4 | A zip whose +4 has a leading zero (`0043` on row 3, `2201` here) |
| 5 | **No control number in either column** — must be rejected with a reason, not dropped silently |

Every row also carries the file-level constants (`agencyid`, `agencyname`,
`Campaign Number`, `FileName`, `quotedate` `46216`, `type`, `product`) and the
empty `vehicle*`/`premium*`/`bi1`/… columns that are blank only because this is
a `Home`/`FQ` file — an Auto file populates them, so nothing may narrow the
schema to what is empty here.

**Never commit the full file.**
