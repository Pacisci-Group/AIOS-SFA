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
