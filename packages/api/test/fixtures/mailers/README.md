# Mailer import fixtures

## `rtp-sample.csv`

A **redacted 197-row slice of the real `SFA-RTP-2026-29.csv`** (24 MB, 20,405
data rows, 132 columns), plus **one synthetic row** appended at the end.

All 132 columns are present in their original order, and every business value —
control numbers, money, dates, coverage, county, campaign context, suppression
flags, postal metadata — is **verbatim from the source file**. What was replaced:

| Column(s) | Why |
|---|---|
| `firstname`, `lastname`, `name`, `address`, `phone` | Real prospects' PII. These are private individuals who never agreed to appear in a git repository, and none of it has any test value. |
| `barcode`, `imb_encode`, `encodedimb`, `presorttra`, `datalabven`, `dlvpnt`, `chkdgt` | Per-piece mail identifiers. Truncated to their first two characters — they differ on 100% of rows between two print runs of the *same* campaign, so they carry no signal and are noise in a diff. |

**Never commit the full files.** They are David's, they are 20–25 MB each, and
they are full of real names and addresses.

### Why these rows

The slice is chosen, not sampled off the top, so that a regression in any of
these fails a test rather than a production run:

- all three distinct `status` values (`SNNNN4`, `SNNNNN`, `SYNNN4`)
- a `donotmail: Yes` row **with** a phone number, and one without
- a row where `yearlyprem` and `New Yearly Premium 2` disagree by a float
  artifact (`$2704.91/year*` vs `2704.915`)
- a 7-figure `dwellingli` (`$1,234,567.00`)
- a `zip4` with a leading zero, and a `county` with a leading zero (`017`)
- 3-digit and 5-digit `squarefeet`, so the `filler` thousands-separator variant
  (`4,195` against `4195`) is covered both ways
- all three `Right_Name` markets (Tulsa, Oklahoma City, 580 Group)
- ~180 further rows sampled with a fixed seed

### The one synthetic row

The last row has **no control number in either column**. It is constructed,
because the real file has none: measured across the whole of week 29, the
importer reads 20,405 rows, maps 20,405 and rejects **zero**. The row exists so
the rejection path — counted and reported with a reason, never dropped silently
— has something to exercise.

Any test asserting a rejection count must account for it. `mailer-import.e2e-spec.ts`
names it `syntheticRejections` for that reason.

### Re-cutting it from a newer file

The tests anchor on values read out of this file at run time, not on literals,
so a newer slice needs no test rewrite — only the row counts in
`mailer-import.e2e-spec.ts` (198 read / 197 mapped / 1 skipped) and the
`donotmail` total, both of which are derived from the fixture where it is
practical to do so.

## Measured against the three real files

`SFA-RTP-2026-29.csv`, `-30` and `-32`, supplied 2026-08-24. All three have
**byte-identical headers** (132 columns) and are Smith Family Agency,
`type: Home`, `product: FQ`.

| | week 29 | week 30 | week 32 |
|---|---|---|---|
| data rows | 20,405 | 20,976 | 17,532 |
| `Campaign Number` | `Week_Number-29` | **`Week_Number-29`** | `Week_Number-32` |
| `FileName` | `SFA-20P` | `SFA-QBP` | `SFA-QBP` |
| `quotedate` | 46216 → 2026-07-13 | 46216 → **2026-07-13** | 46242 → 2026-08-08 |
| `donotmail: Yes` | 195 | 187 | 180 |
| `phone` filled | 902 (4.4%) | 912 (4.3%) | 707 (4.0%) |
| `emailaddre` / `birthdate` | 0% | 0% | 0% |
| `totalpremi` == `coveragest` | all rows | all rows | all rows |
| columns empty on every row | 33 | 33 | 32 (`ste_rtncd` is populated) |
| control numbers unique within file | yes | yes | yes |
| `New Control Number` == last 12 hex of `controlno` | all rows | all rows | all rows |

### Three things worth knowing

**The filename's week and the campaign's week are different things.** The file
named `-30` carries `Week_Number-29` and week 29's quote date. The campaign
number is what the data says, and the preview reports it verbatim; the filename
number appears to be the mail-drop week. Do not "correct" one from the other.

**Weeks 29 and 30 share 4,825 control numbers**, and on those rows every
business column is identical — same premiums, same coverage, same campaign, same
quote date. They differ only in `FileName` and in per-piece mail-sorting columns
(`barcode`, `imb_encode`, `recordid`, `pst_seq`, `pc_no_pkg`, `ctn_no`, …). They
are two **print runs of one campaign**, so the importer's upsert-collapse is
correct and loses nothing but the print metadata of the earlier run. It also
means `Campaign Number` is emphatically not a campaign identifier — two
different files claim the same one.

**`status` is postal metadata, not a business status.** It is populated on 100%
of rows with values like `SNNNN4`, and it sits among the `dpv_*` / `coa_*` /
`ste_rtncd` address-standardisation columns. It stays in `source.raw` and must
never be promoted into a campaign status — PAC-61 open item 3 is still open, and
this column does not answer it.


## The stage-2 vendor file (`SFA-QBP.xlsx`, 2026-09-04)

David supplied the file the mail vendor returns **before** ApexReports' SFA
Processor runs — the input PAC-71's "run a campaign" takes. Measured on the
real week-36 file (8.8 MB, **20,024 rows, 124 columns**, one sheet, `.xlsx`):

| | week 36 vendor file |
|---|---|
| columns | **124 = the 132 above minus the 8 the processor appends** (`FileName`, `zip1`, `zip2`, `New Yearly Premium 2`, `Zip Codes`, `Right_Name`, `New Control Number`, `Campaign Number`) — same names, same order, nothing extra |
| `yearlyprem` / `totalpremi` | `"$2,260.53/year*"` / `"$2,260.53"` — **the same number on 20,024/20,024 rows**. The processor discounts `yearlyprem` and overwrites it; that is why the two disagree in the output |
| `monthlypre` | vendor's own `"$188.00"`; equals `yearlyprem ÷ 12` on 79 rows only — overwritten |
| `agencyphon` | one value, `918-417-7400`, on every row — overwritten with the market phone |
| `cfield53` | `All Peril` on every row — the reason the processor blanks it |
| `quotedate` | **two** values, `46268`/`46269` → 2026-09-03/04 (ISO week 36). Not single-valued as the week-29 output was |
| `controlno` | `#`+UUID, unique, never empty; `New Control Number` absent (derived) |
| `zip` | ZIP+4 on 100% of rows; `pst_seq` and `recordid` present (vendor order, not 1..N) |
| `phone` / `emailaddre` / `birthdate` | 502 (2.5%) / 0 / 0 |
| `donotmail` | present; `donotcall` `No` throughout |
| columns empty on every row | 31 (Home file — an Auto file fills them) |
| duplicate rows | 0 |

**The `agency*` block comes from Allstate.** `agencyid` (`A0B9049`),
`agencyname`, `agencyfirs`/`agencylast` (Brian Smith), `agencyemai`
(`a0b9049@allstate.com`), `agencyweb` (his `agents.allstate.com` page) are the
issuing agent's Allstate profile, present in the vendor file before ApexReports
touches it and never written by Apex. It identifies whose account the quotes
were issued under. PAC-71 makes it the **default assignment rule**: a row goes
to the agency whose `Agency.allstateAgencyId` matches, unless David overrides
by picking agencies explicitly or choosing all. Forty-one column names are
truncated to exactly 10 characters (`agencyfirs`, `emailaddre`, `quotestatu`) —
the DBF field-name limit, i.e. the mail vendor's presort software passed the
file through.

**It is XLSX, not CSV.** The importer is CSV-only today (`csv-parse`); PAC-71
needs an XLSX reader on the parse path from day one.

`zip-markets.csv` beside this file is the ZIP → market table the processor
joins on, pulled 2026-09-04 from the Google Sheet ApexReports maintains
(565 rows: Oklahoma City 295 · Tulsa 245 · 580 Group 24 · Unknown 1 — one of
them a four-digit typo, `4031`, which the seed must reject or fix). No PII.
PAC-71 seeds the per-agency table from it and retires the Sheet.

The vendor file itself is **not** committed — real names and addresses.
