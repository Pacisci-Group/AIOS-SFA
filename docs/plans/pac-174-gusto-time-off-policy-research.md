# PAC-174 — How Gusto does time-off policies (research, 2026-11-04)

Input for the PAC-174 scoping session. Everything below is taken from Gusto's
own help centre (admin + employee articles, versions current as of today) and
the Gusto Embedded API docs, which expose the underlying data model. Where the
two disagree the help centre describes the UI and the API describes storage.

Sources are listed at the end. Nothing here was verified inside a live Gusto
account; the help centre is the only public description of the wizard.

---

## 1. TL;DR

- A Gusto policy is **one kind of time off** (Vacation/PTO, Sick, Bereavement,
  …) with a name, **paid/unpaid**, an **accrual type** and an **enrollment
  list**. Exactly the shape PAC-148 §3 already fixed.
- Two settings are **locked for life**: *limited vs unlimited* and *paid vs
  unpaid*. To change them you delete and recreate.
- Three accrual types: **Hours worked**, **Fixed amount**, **Unlimited**.
  Fixed amount is always entered as an **annual total** and then either spread
  per pay period or granted once a year on a **reset date** (hire anniversary
  or one fixed date for everyone).
- The wizard is **five steps**: Basic setup → Settings → Accrual → Enrollment
  → Review, with "Step X of 5" in the corner, drafts saved as **(Incomplete)**,
  and nothing live until **Activate**. Editing afterwards is **per-section
  inline drawers**, not re-walking the wizard.
- Optional extras, all off by default: waiting periods, negative balances,
  payout on leaving, carryover cap, max balance / max per year, milestones
  (tenure-based accrual bumps), auto-approval rules, annual usage cap (Sick).
- One person can be in **at most one policy of each type** (Custom is the
  escape hatch). Multiple policies of the same type exist for different groups
  of people. No per-person overrides anywhere.
- Balances are a **ledger** ("Time Off Tracker") with typed activity rows;
  admins edit a balance from the person's profile, not from the policy.
- **Suggested policies** sit at the bottom of the policies page with an
  "Add policy" button each — this is the one-click preset the epic asks about.

---

## 2. Policy types

Gusto's UI offers a type picker first, before any field. The catalog (web
help centre, with the plan each needs):

| Type | What it is for | Notes |
|---|---|---|
| **Sick** | Required or optional sick leave | Has extra compliance fields (§8) |
| **Time off / Vacation** | General PTO or vacation | The default "PTO" |
| **Personal day** | One-off personal days | |
| **Parental leave** | Birth, adoption, fostering | |
| **Bereavement** | Death in the family | |
| **Floating holiday** | Non-federal holidays / personal observances | |
| **Volunteer** | Paid volunteering time | |
| **Weather / emergency** | Closures | |
| **Jury duty** | Court or jury service | |
| **Learning and development** | Training time | |
| **Holiday pay** | Paid company holidays for days not worked | A **different, simpler flow** (§9); one per company |
| **Custom** | Anything else | Also the escape hatch for a second policy of a type the person is already in |

The API's `policy_type` enum is the same list in snake case:
`vacation, sick, bereavement, custom, floating_holiday, jury_duty,
learning_and_development, parental_leave, personal_day, volunteer, weather`
(+ holiday, which is its own object). So "type" is a **fixed enum**, not free
text; the free text is the policy **name** ("Vacation Policy", "Intermission
Policy"). Type is what the one-per-person rule is keyed on.

Unpaid policies are a plan upgrade in Gusto; irrelevant to us but it shows
unpaid is a flag on any type, not a type of its own.

---

## 3. The two locked settings

Every policy has two "core settings" chosen up front and never changed:

| Setting | Options | Consequence |
|---|---|---|
| **Limited vs Unlimited** | Limited = accrues/earns a set amount; Unlimited = no balance tracked | Unlimited can never be converted to limited; unused unlimited time is never paid out |
| **Paid vs Unpaid** | Paid = paid in payroll; Unpaid = tracked only | Label + payroll flag |

Gusto's own "quick decision help" on the page:

- *Limited + Paid* — PTO you might pay out at dismissal
- *Unlimited* — when you do not track earned balances
- *Custom* — special tracking needs like emergency leave

Help text on the lock: "Compensation type and the Unlimited accrual type cannot
be changed after the policy is created. You'd need to delete and recreate the
policy."

---

## 4. Accrual types

One per policy. Chosen in Step 1, detailed in Step 3.

| Accrual type | How it earns | Inputs |
|---|---|---|
| **Hours worked** | Builds each paycheck from hours actually worked (varies per employee) | Rate: *X hours per Y hours worked* (API `accrual_rate` / `accrual_rate_unit`, e.g. 4 h per 80 h) |
| **Fixed amount** | A set annual total, independent of hours worked. Same total for everyone in the policy | **Base rate = total hours per year**; **Accrual rate** = *Per pay period* (total split evenly across paychecks) or *Yearly fixed amount* (whole total once, on the reset date) |
| **Unlimited** | No balance; requests approved on trust | none |

**Reset date** (limited policies): *On each employee's start date* or *On the
same date for everyone* (e.g. January 1). Carryover applies at reset; yearly
limits start fresh. Gusto warns at length that a fixed-amount policy resetting
on one date for everyone gives a **new joiner no balance until the next reset**
— the admin must add a starting balance by hand. Per-start-date resets avoid
that.

The API shows the real enum behind the UI:

| API `accrual_method` | UI equivalent |
|---|---|
| `unlimited` | Unlimited |
| `per_pay_period` | Fixed amount · Per pay period |
| `per_calendar_year` | Fixed amount · Yearly, reset on a fixed `policy_reset_date` (MM-DD) |
| `per_anniversary_year` | Fixed amount · Yearly, reset on hire anniversary |
| `per_hour_worked`, `per_hour_worked_no_overtime`, `per_hour_paid`, `per_hour_paid_no_overtime` | Hours worked (four variants) |

Which optional fields each method accepts (from the API's accrual-methods
guide; "—" means must be null):

| Field | unlimited | per_pay_period | per_calendar_year | per_anniversary_year | per_hour_* |
|---|---|---|---|---|---|
| `accrual_rate` | — | required | required | required | required |
| `accrual_rate_unit` | — | — | — | — | required |
| `accrual_waiting_period_days` | — | optional | — | — | optional |
| `paid_out_on_termination` | — | optional (default false) | optional | optional | optional |
| `carryover_limit_hours` | — | optional | optional | optional | optional |
| `max_accrual_hours_per_year` | — | optional | — | — | optional |
| `max_hours` (max balance) | — | optional | optional | optional | optional |
| `policy_reset_date` | — | optional | optional | — | optional |

Note: carryover is "not supported for anniversary all-at-once policies" in the
help centre even though the API lists it as optional; the per-person reset
plus a lump sum makes carryover meaningless.

---

## 5. The create flow (web)

**Entry points**

1. *Time & Attendance → Time Off → Actions → Add a time off policy*.
2. The **Suggested policies** strip at the bottom of the Policies page: Gusto
   lists common types with an **Add policy** button next to each.
3. For a California company, a new Sick policy opens on a **compliance pre-set**
   (accrual rate, caps, waiting periods pre-filled, plus a suggested list of
   employees to enroll) that the admin reviews before activating.

**Step 0 — choose a policy type** (Sick, Time Off, Holiday Pay, Custom, …).
Holiday Pay branches into its own short flow (§9); every other type goes into
the five-step wizard.

**Step 1 — Basic setup**

| Field | Input | Notes |
|---|---|---|
| Policy name | text | Visible to employees and admins. Example "Vacation Policy" |
| Description | text, optional | Collapsed behind a "add description" link |
| Compensation type | Paid / Unpaid | **Locked after creation** |
| Accrual type | Hours worked / Fixed amount / Unlimited | Unlimited is **locked after creation**; a cheat-sheet link explains the three |

**Step 2 — Settings** (a card of toggles; everything off by default)

| Toggle | When on, asks | Default |
|---|---|---|
| Waiting periods | **Accrual** waiting period (calendar days before earning) and **Usage** waiting period (calendar days before requesting). Each: none / 30 / 60 / 90 / custom | 30 days |
| Negative balances | nothing more; allows requests that take the balance below zero | off |
| Unused time off payout | nothing more; pays out the balance when the person leaves | off |

Usage waiting periods and negative balances only exist when employee time-off
requests are enabled company-wide.

**Step 3 — Accrual** (collapsible sections)

| Section | Inputs |
|---|---|
| Base rate | How much accrues and how often. Fixed amount: **total hours per year** + accrual rate (*Per pay period* / *Yearly fixed amount*) + reset date. Hours worked: *X hours per Y hours* |
| Caps | **Max hours accrued per year** and **Max balance** (overall cap). Carryover cap lives here too ("Carryover cap — enter 0 if carryover is not allowed") |
| Annual usage cap | Sick policies only; hours a person may *use* per year (§8) |
| Milestones | optional; tenure-based rate bumps (§6) |

Not shown for Unlimited (no balance to configure).

**Step 4 — Enrollment** (one screen)

- **Add team members**: search by name, multi-select, *Clear all*.
- **Set balances** toggle: when on, a **starting balance in hours per person**,
  or *Edit all balances* to bulk-set one number.
- Contractors cannot be enrolled. A person already in another policy of this
  type cannot be added (the UI tells you to use Custom; the embedded flow
  instead *moves* them and carries the balance across).

**Step 5 — Review**

A summary with five sections — *Basic setup, Settings, Accrual, Enrollment,
Auto-approve requests* — each with an **Edit** link that edits in place without
leaving Review. **Activate** makes the policy live; **Delete policy** discards
the draft.

**Draft behaviour**: progress is saved on leaving; the Policies list shows the
row with an **(Incomplete)** badge; clicking it resumes at the last step.
"Step X of 5" in the corner is clickable to go back.

**After activating**: Gusto nudges you to turn on **time off requests** in
company settings so employees can submit, and to assign managers.

---

## 6. Milestones (tenure tiers)

Inside Step 3, a collapsible *Milestones* subsection, so that "if accrual
increases with tenure you do not need a separate policy per tenure level".

Each milestone row: **Milestone** (years worked) · **Total per year** (hours) ·
**Max hours accrued per year** (if different). *Add another milestone* repeats.
Eligibility is judged at the start of a pay period; the higher rate applies
from the following period.

---

## 7. Automatic approval

Per policy, **off by default**. Lives in the *Auto-approve requests* section
of the Review step, on the policy page, and behind *Manage auto-approval* on
the Time off page.

Rules (a request must meet all set rules to auto-approve):

| Rule | Input |
|---|---|
| Maximum calendar days per request | days, counted first day through last incl. weekends |
| Minimum notice required | days or hours before the first day |

A request that would push the balance negative still needs manual review
unless *Negative balances* is on. Auto-approval **only approves**, never
declines; non-qualifying requests fall into the normal queue. It never applies
to time an admin records on someone's behalf (that is auto-approved anyway).
Employee gets an email + in-app confirmation; manager gets a "no action
needed" note.

> PAC-148 says "the app never auto-approves". This is the feature David would
> be opting out of; worth a one-line confirmation rather than silence.

---

## 8. Sick-policy specifics

- **Annual usage cap** (Step 3): hours a person may *use* per year, distinct
  from how many they may *earn*. Employee requests over the cap are **blocked**
  with a banner; admin-recorded time over the cap only **warns**. Not available
  on unlimited policies.
- **State presets**: California companies get a pre-filled policy. Washington
  must flag the policy qualified vs non-qualified (tax).
- Separate emergency sick leave = a separate **Custom** policy, because a
  person cannot be in two Sick policies.
- Some state laws forbid resets; then year-end does not zero the balance.

---

## 9. Holiday pay policy (for comparison with PAC-161)

A different, shorter flow: *Add policy → Holiday Pay → tick federal holidays →
(Plus) add custom holidays (name + date, future dates only, up to three years
ahead) → enroll team members → Create policy.*

Rules: **one holiday policy per company**; everyone enrolled is paid **8 hours
per holiday**, adjustable only in payroll; federal holidays roll forward
automatically and observe on Fri/Mon; custom holidays must be re-created each
year; past holidays cannot be removed; overlapping custom + federal are not
double-counted.

Our PAC-161 holiday policy is already richer (recurring custom rules, several
policies). Nothing to change; noted so nobody reopens it.

---

## 10. Enrollment, editing, deleting

**Rules**

- A company can have **many policies of each type**; a person is in **at most
  one policy per type**, paid or unpaid alike. "If your employees earn time off
  at different rates, you likely do not need a separate policy for each person
  — set up different policies for different employee types" (managers vs staff,
  full-time vs part-time).
- Contractors cannot be enrolled.
- New hires can be added to policies **during onboarding**.

**Where enrollment is edited** — two places, same effect:

1. Policy page → *Enrollment → Edit* → search, click to add, **X** to remove →
   Save.
2. Person's profile → *Time off* tab (balance edits also live here).

**Removal / wrong start date**: remove and re-add; the last balance
auto-populates and the accrual history repopulates in the tracker. Removal
writes a *Removed from policy* row to the ledger. A person with **pending
requests cannot be removed** until those are declined or deleted.

**Editing an activated policy**: each section (Basic setup, Settings, Accrual,
Enrollment, Auto-approve) opens in an **inline drawer**; changes apply right
away. Editable at any time: name, description, accrual method, waiting period,
max and carryover limits, negative balances, auto-approval. Never editable:
paid/unpaid, limited/unlimited.

**Deleting a policy**: stops future accruals and requests but **keeps past
balances and history for reporting**; blocked while pending requests exist.
Reports still run for deleted policies over the period they were active. (The
API calls this *deactivate* and sets `is_active: false`.)

---

## 11. Balances and the ledger

**Terms Gusto shows** (admin and employee see different cuts):

| Term | Meaning |
|---|---|
| Available hours | What the person can still use |
| Requested hours | Pending + approved requests not yet paid |
| Current balance | Total accrued |
| Maximum hours | The policy's max balance or yearly cap, if set |
| Annual usage cap | Sick only; the usage limit |

Employees see **total balance including approved upcoming time off**; admins
see **current balance and requested hours broken out**. Gusto explicitly
documents this as a source of confusion — the PAC-148 §5 "available vs current
balance" definitions should be stated on screen exactly once and the same way
for both.

**Time Off Tracker** — the per-person, per-policy activity log. Its row types
are a ready-made ledger vocabulary:

`Accrual · Admin adjustment · Team member request / Admin recorded request ·
Carryover limit reached · Max balance reached · Payout of unused hours ·
Added to policy / Removed from policy · Payroll reversed or cancelled ·
Historical accrual adjustment`

Each entry shows effective date, type, hours added/removed and the running
balance.

**Manual balance edit**: *People → person → Time off → policy → edit balance*;
the employee sees the new number immediately. A negative number can be
entered.

**Negative balances**: a toggle; when on the balance simply goes negative and
accrues back toward zero. Turning it off does not touch existing pending
requests.

**Carryover**: a single **carryover cap in hours** on limited policies (0 = no
carryover); hours lost to the cap show in the balances report. No payout of
non-carried hours.

**Dismissal**: limited paid policies pay out unused hours by default; sick and
unpaid do not; negative balances never reduce a payout; rehire restores the
previous balances. (Payroll — out of scope for us, PAC-123.)

---

## 12. What the employee sees

*Time off* in the left nav → one card/row **per policy** with an **Action**
column (*Request time off*). Per policy page:

- **Available hours**, **Requested hours**, **Earning policy** (the rate, e.g.
  "3.38 hours per pay period"), **Maximum hours**, **Annual usage cap** (Sick),
  then lists of Pending / Approved / Declined / Past requests, then the
  **Activity** tracker.
- **Policy details** panel: *Type*, *Earning policy* (per pay period / per hour
  worked / lump sum), *Reset date*.
- Unlimited policies show **no balance**.

**Request form**: *Date(s) requested* (range) → *Full days* (8 h per weekday,
weekends skipped) or *Partial days* (a table of each date, default 8 h,
editable) → balance breakdown (*Current balance · Other requested hours · This
request · Remaining available balance · Annual usage cap*) → optional note to
manager → *Send request*. Requests cannot be edited, only deleted and
resubmitted; declined requests cannot be undone.

---

## 13. Proposed shape for PAC-174 — a Gusto wizard, not a single form

Decided with Asad, 2026-11-04, after the first draft of this report
recommended one flat form: **copy Gusto's multi-step wizard, and ask for the
accrual type**. Another engineer picks up employee payments (PAC-123) straight
after this ticket and is blocked on the policy model, so the accrual settings
must be first-class on the policy even though nothing pays out yet.

### 13.1 The type picker comes first

The wizard opens on a **type picker**, as Gusto's does, before any field. The
types David asked for:

| Type | Key | Compensation | In the request flow? |
|---|---|---|---|
| **Paid Time Off (PTO / Vacation)** | `pto` | Paid | yes |
| **Sick Leave** | `sick` | Paid | yes |
| **Unpaid Time Off** | `unpaid` | Unpaid, fixed | yes |
| **Bereavement** | `bereavement` | Paid | yes |
| **Custom** | `custom` | admin picks | yes |
| **Holidays** | — | — | **no** — already built as the `holiday` HR policy (PAC-161). Nobody requests a holiday; it is a calendar fact. The picker shows it as a card that routes to the existing Holiday policy flow, so an admin looking for "paid holidays" still finds it |

So the HR policy types stay `holiday | work_week | time_off`, and a time-off
policy carries a **`timeOffType`** from the five keys above. The
one-policy-per-type-per-person rule (§10) is keyed on `timeOffType`; a Custom
policy is its own type each time, so a person may be in several Custom
policies — Gusto's escape hatch, kept.

Enrolling someone in a second policy of the same `timeOffType` **moves** them,
exactly as the branch already does for Holiday and Work week policies.

### 13.2 The five steps

**Step 1 — Basic setup**

| Field | Input | Notes |
|---|---|---|
| Policy name | text, ≤ 80 chars | pre-filled from the type ("Paid Time Off", "Sick Leave", …) |
| Description | optional text | collapsed behind a link, as Gusto |
| Compensation | Paid / Unpaid | pre-set by type; **Unpaid Time Off is fixed to Unpaid**; others default Paid. **Locked after activation** (label + ledger flag only — no payroll here, PAC-123) |
| Accrual type | **Fixed amount / Unlimited** | Gusto also offers *Hours worked*; **hidden** for us until time tracking exists (PAC-167), see 13.4. *Unlimited* is **locked after activation** |

**Step 2 — Settings** (toggles, all off by default)

| Toggle | When on | Default |
|---|---|---|
| Waiting period | **Usage** waiting period: calendar days after hire before a request is allowed — none / 30 / 60 / 90 / custom. Reads the person's `hireDate` (PAC-162); nobody is blocked while that is unset. (Gusto's separate **Accrual** waiting period only matters for Hours worked, so it is not shown) | 30 when enabled |
| Negative balances | requests may take the balance below zero | off |
| Unused time off payout | pays out the balance when the person leaves | **stored, not acted on** — a flag PAC-123 reads; hidden on Unpaid and Unlimited |

**Step 3 — Accrual** (hidden entirely for Unlimited)

| Section | Inputs |
|---|---|
| Base rate | Fixed amount: **Total hours per year** + **Accrual frequency** (*Yearly, all at once* / *Monthly*; *Per pay period* hidden until PAC-123, see 13.4) + **Reset date** (*each person's hire anniversary* / *the same date for everyone*, default Jan 1) |
| Caps | **Max balance** (hours) · **Carryover cap** (hours, 0 = none). (*Max accrued per year* only applies to Hours worked, so it is not shown) |
| Annual usage cap | Sick only — hours a person may *use* per year; a request over it is blocked |
| Milestones | **not in v1** — Gusto's tenure tiers; "another policy" covers it. The model leaves room (`milestones: []`) |

**Step 4 — Enrollment**

- *Add team members*: search, multi-select, **Clear all**; people already in a
  policy of this `timeOffType` show which one and that saving moves them.
- *Set balances* toggle → **starting balance in hours per person** or **Edit
  all balances** to bulk-set. Default: the yearly total for *Yearly* policies,
  0 otherwise. Hidden on Unlimited. Posts one `Allocation` ledger row per
  person on activation.

**Step 5 — Review**

A summary with Gusto's five sections *Basic setup · Settings · Accrual ·
Enrollment · Auto-approve requests*, each with an **Edit** link that edits in
place, then **Activate**.

**Auto-approve requests** (decided 2026-11-04, reversing the epic's "never
auto-approves" line): per policy, **off by default**, Gusto's two rules —
**Maximum calendar days per request** (first day through last, weekends
included) and **Minimum notice required** (days or hours). A request meeting
both is Approved on submission with an `Approved automatically` timeline entry
and the usual `Used` ledger rows; anything else goes to the manual queue. It
only approves, never declines, never applies to time a manager records on
someone's behalf, and a request that would take the balance below zero needs
manual review unless *Negative balances* is on. Employee notified as for any
approval; reviewers get a "no action needed" note.

Progress indicator "Step X of 5", clickable backwards. **Drafts**: Gusto
saves an *(Incomplete)* draft server-side on leaving. For v1 keep the wizard
state **client-side** (leaving discards); server-side drafts are a follow-up
if admins ask.

### 13.3 After activation

- Policy page = the Review layout with **Edit** per section opening an inline
  drawer, as Gusto. Editable any time: name, description, accrual settings,
  waiting period, caps, carryover, negative balances, enrollment. **Never**
  editable: Paid/Unpaid, Unlimited.
- Enrollment is also editable from the person's profile (PAC-162), with the
  balance edit beside it.
- **Delete** keeps the ledger and history (`deletedAt`, PAC-155) and is
  blocked while the policy has Submitted requests.
- Removing a person writes a *Removed from policy* ledger row; re-adding
  resumes the old balance.
- **Suggested policies** strip at the bottom of Settings → HR policies:
  *Paid Time Off · 80 h/yr*, *Sick Leave · 40 h/yr*, *Unpaid Time Off ·
  unlimited*. Clicking opens the wizard **pre-filled at Step 1**, nothing
  saved until Activate.
- **No onboarding step and no seeded policies** (decided 2026-11-04): policy
  creation is not part of the owner's setup wizard, so the epic's step 3 and
  `hrPolicySkipped` go; and the migration seeds nothing — the legacy
  `Unpaid / PTO / Sick` labels on migrated `timeOffRequests` stay history for
  PAC-165 to display, not policies.

### 13.4 Accrual decisions the payments engineer depends on

What we store must be enough for PAC-123 to compute pay and accrual later, so
the model carries Gusto's full vocabulary even where v1 cannot act on it:

| Field | Values | v1 behaviour | PAC-123 |
|---|---|---|---|
| `accrualType` | `hours_worked` · `fixed_amount` · `unlimited` | Fixed amount and Unlimited fully work. **Hours worked is hidden** from the picker until time tracking exists (PAC-167) — the enum value is reserved, nothing else is built (Asad, 2026-11-04) | reads it |
| `accrualFrequency` (fixed amount) | `yearly` · `monthly` · `per_pay_period` | Yearly posts one `Allocation` on the reset date; Monthly posts 1/12 on the 1st agency-time. **Per pay period is hidden** until PAC-123 defines a pay schedule — enum value reserved (Asad, 2026-11-04) | owns the pay schedule and the per-period accrual job |
| `resetDate` | `hire_anniversary` · `fixed` + `MM-DD` | runs the yearly reset (carryover cap → `Carryover` / `Expiration` rows) | — |
| `hoursPerYear`, `accrualRate` + `accrualRateUnit` (hours worked) | numbers | stored | reads them |
| `maxBalanceHours`, `maxAccruedPerYearHours`, `carryoverCapHours`, `annualUsageCapHours` | numbers, nullable | enforced on requests and at reset | — |
| `waitingPeriodDays` (usage), `accrualWaitingPeriodDays` | ints, nullable | enforced on requests / first accrual | — |
| `allowNegativeBalance`, `payOutOnTermination` | booleans | first enforced; second stored only | reads `payOutOnTermination` |
| `compensation` | `paid` · `unpaid` | label + ledger flag | reads it |

Rules copied from Gusto's API guide: Unlimited nulls every accrual field;
Yearly (calendar or anniversary) has no per-year cap and no accrual waiting
period; carryover is meaningless on an anniversary all-at-once policy and
should be hidden there.

Unchanged from the epic: the ledger stays append-only and the balance is
always derived; manual adjustments are admin-only with a reason.

### 13.5 Decisions taken 2026-11-04 (Asad)

| Question | Decision |
|---|---|
| Hours worked accrual | **Hidden** until time tracking exists (PAC-167); enum value reserved |
| Per-pay-period frequency | **Hidden** until PAC-123 defines a pay schedule; enum value reserved |
| Auto-approval | **In**, per policy, off by default, Gusto's two rules (see Step 5) |
| Hire date (needed by hire-anniversary reset and the usage waiting period) | Added by **PAC-162** (People & profile). PAC-174 stores the settings and reads `hireDate` as nullable: a person with no hire date yet has no waiting period applied and no anniversary reset until the date is set |
| Mid-year joiner on a fixed-date Yearly policy | **Full** yearly total as the default starting balance (Gusto gives none until the next reset) |
| Monthly accrual | **Full twelfth** on the next 1st regardless of the enrollment day; `hoursPerYear / 12` to two decimals |
| Negative balance floor | **None**; a negative balance may go as deep as approvals take it |
| Onboarding step | **None.** Policy creation is not part of the owner's setup wizard; `hrPolicySkipped` and the epic's step 3 go |
| Seeded policies for the migrated agency | **None** |
| Compensation on PTO / Sick / Bereavement / Custom | **Optional, default Paid**, editable until activation; Unpaid Time Off stays fixed to Unpaid |

## 14. Things Gusto does that we deliberately do not copy

- Payout maths, payroll columns, pay-rate rules — PAC-123; we only store the
  flag.
- Milestones (tenure tiers) — not in v1.
- Plan-tier gating and state compliance pre-sets (California / Washington) —
  SFA's seeded defaults play the role of the pre-set.
- The company-wide "enable time off requests" switch — a person in a policy
  can request.
- Server-side *(Incomplete)* drafts — later, if asked.

## Sources

- Gusto Help Center — *Set up and manage time off policies (for admins)*:
  https://support.gusto.com/article/999756591000000/set-up-and-manage-time-off-policies-for-admins
  (policy types, accrual types, limits, the 5-step wizard, milestones,
  automatic approval, sick leave, holiday pay, edit/delete/enrollment,
  balances and carryover, dismissal, reports)
- Gusto Help Center — *Request and manage time off (for employees)*:
  https://support.gusto.com/article/999877041000000/Manage-your-time-off-for-employees
- Gusto Embedded API — *Time off policies*:
  https://docs.gusto.com/embedded-payroll/docs/time-off-policies
- Gusto Embedded API — *Manage time off policies*:
  https://docs.gusto.com/embedded-payroll/docs/manage-time-off-policies
- Gusto Embedded API — *Accrual methods*:
  https://docs.gusto.com/embedded-payroll/docs/accrual-methods
- Gusto Embedded API — *Time off management flow*:
  https://docs.gusto.com/embedded-payroll/docs/time-off-management-flow
- Gusto Embedded API reference — *Create a time off policy* (schema, `policy_type` enum):
  https://docs.gusto.com/embedded-payroll/reference/post-v1-companies-company_uuid-time_off_policies
