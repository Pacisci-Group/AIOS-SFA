# PAC-165 — How Gusto does time-off requests (research, 2026-11-05)

Input for the PAC-165 ticket pass. It answers three questions: how a person
requests time off for themself in Gusto, how a manager or admin records time
off for someone else, and what information each takes. The policy side
(types, accrual, enrollment, auto-approval rules) is already covered in
`pac-174-gusto-time-off-policy-research.md` and is not repeated here.

Everything below comes from Gusto's help centre (employee, manager and admin
articles, as published today) and the Gusto Embedded API docs, which expose the
stored shape. Nothing was verified inside a live Gusto account. Two gaps in the
public material are called out where they matter (§4.3, §9).

---

## 1. TL;DR

- A request is **four inputs**: the policy, a date range, *Full days* or
  *Partial days*, and an optional note. No reason list, no attachments, no
  coverage note, no acknowledgment.
- Hours are **not** derived from a schedule: Full days means a flat **8 hours
  per weekday**, weekends skipped. Partial days shows one row per date,
  defaulting to 8, and the person types the real hours. The stored request is a
  **date → hours map**.
- The form shows a **four-line balance breakdown** before sending: *Current
  balance · Other requested hours · This request · Remaining available
  balance* (plus *Annual usage cap* on a Sick policy).
- **Self request** → `pending`, the assigned manager (or the admins) get an
  email, the employee waits. **Recorded for someone else** → created
  **already approved**, no review step, the employee gets an email saying it
  was recorded for them.
- There are only **four statuses**: pending, approved, declined, consumed
  (paid through payroll). There is **no draft, no "changes requested" and no
  cancelled status** — a request cannot be edited after sending; the employee
  deletes it and sends a new one.
- A reviewer can **approve, edit the hours and then approve, or decline**.
  Declining is all-or-nothing and final. An **already approved** request can
  still be declined until payroll has paid it.
- Gusto sends **no reminders and no escalations** for a request left
  unanswered.

---

## 2. Before anyone can request

| Precondition | Detail |
|---|---|
| Enrolled in a policy | A request is always against one policy the person is enrolled in. Not enrolled → the API returns 422 |
| Company switch on | *Settings → Customization → Time off requests → Enabled*. Turning it **off auto-declines every open request** |
| Person is eligible | Terminated, inactive or not-yet-onboarded people cannot have a request created (API 422) |
| Usage waiting period passed | If the policy sets one (PAC-174 research §5) |

Where it lives: employees have **Time off** in the left nav (web) or
*Time / Work → Request time off* (mobile). Managers see the same tab with a
**My Team's Time Off** table underneath. Admins use *Time & Attendance → Time
off*.

---

## 3. Requesting time off for yourself

### 3.1 Steps (web)

1. **Time off** in the left nav. One row per policy the person is in.
2. On the policy's row, **Request time off** in the *Action* column — so the
   **policy is chosen first**, by where you click. (Mobile: tap *Request time
   off*, then pick the policy.)
3. **Date(s) requested** — a date range. A single day is a range of one.
4. Choose the request type:
   - **Full days** — 8 hours for each weekday in the range; weekends are not
     included.
   - **Partial days** — a table appears with one row per date, each defaulting
     to 8 hours under *Time requested*; enter the actual hours for each date.
5. Read the **balance breakdown** (§3.3).
6. **Add a note for your manager** (optional).
7. **Send request** (mobile: *Submit request*).

### 3.2 What it takes

| Input | Required | Notes |
|---|---|---|
| Policy | yes | Implied by the row clicked on web; an explicit picker on mobile |
| Start date / end date | yes | One range per request. Non-contiguous days need separate requests |
| Full days / Partial days | yes | Full = 8 h × weekdays. Partial = editable hours per date |
| Hours per date | Partial only | 0–24 per date (API bound) |
| Note for manager | no | Free text; stored as `employee_note` |

Not asked: a reason or category, attachments, who covers, start/end clock
times (a partial day is *hours*, not "1 pm to 3 pm"), half-day shortcuts.

### 3.3 The balance breakdown

Shown inside the request window, recalculated as dates and hours change:

| Line | Meaning (Gusto's wording) |
|---|---|
| **Current balance** | Total accrued hours for this policy |
| **Other requested hours** | All approved time off that has not happened yet, plus any requests not yet reviewed. Excludes this request; this policy only |
| **This request** | Hours this request will deduct |
| **Remaining available balance** | Current balance − other requested hours − this request |
| **Annual usage cap** | Sick policies only — the most hours usable this year, if set |

The API has a dedicated **preview** call returning exactly these numbers
(`balance_hours`, `this_request_hours`, `other_requested_hours`,
`remaining_balance_hours`, `allow_negative_balance`, `unlimited`), so the
breakdown is computed server-side, not in the browser. On an **Unlimited**
policy every number is null and no balance is shown.

### 3.4 What blocks sending

| Check | Behaviour |
|---|---|
| Over the Sick annual usage cap | A banner states the limit and how many hours over; **Send request is disabled** until adjusted |
| Remaining balance below zero | Rejected unless the policy allows negative balances |
| Overlaps another request | Rejected if **any date** is already covered by one of the person's pending, approved or paid requests |
| Past dates | Hourly employees cannot request a date that has already passed and are told to contact their admin; salaried employees can |
| Not enrolled / not eligible | Rejected (§2) |

### 3.5 What happens next

- The request is **Pending**. The employee's **assigned manager** gets an
  email; if no manager is assigned, the **admins** do (§5.1).
- If the policy has **auto-approval** on and the request meets its rules
  (maximum length, minimum notice), it is approved **the moment it is sent**:
  the employee sees a confirmation straight away and the email says it was
  approved automatically; the manager gets a "no action needed" note instead
  of a review email.
- On approve or decline the employee gets an email and the balance updates.
- If nobody answers, nothing chases the reviewer. The help centre tells the
  employee to follow up directly.

### 3.6 Changing your mind

- **A request cannot be edited.** Delete it and send a new one.
- **Delete request** (bottom right of the request's *View* window) works on a
  pending or approved request until any part of it has been paid through
  payroll; after that the button is gone and only an admin can adjust.
- A **declined** request cannot be reopened by anyone. The employee sends a
  new request and can use the note to add context or ask about the decision.
- Deleting really removes the request (the API verb is `DELETE`; the webhook
  is `time_off_request.deleted`). There is no "Cancelled" row left behind.

---

## 4. Recording time off for someone else

Gusto calls this **recording** time off, not requesting it, and treats it as a
different action with a different outcome.

### 4.1 Who can

- **Managers** with the time-off permission, for their own team.
- **Admins** with the right permission, for anyone.
- Managers **cannot** enroll people in a policy or change a balance; those
  stay admin-only.

### 4.2 Entry points

| From | Path |
|---|---|
| The Time off page | Below the requests table: **Record time off for a US employee** |
| The person's profile | *People → person → Time off tab →* **Record [name]'s Time Off** (admin article) |

### 4.3 What it takes

| Input | Required | Notes |
|---|---|---|
| **Employee** | yes | Picked first on the Time off page; implied on the profile |
| **Policy** | yes | Only policies that person is enrolled in |
| **Date(s) requested** | yes | A date range, as in the self request |
| Hours per date | — | The API takes the same date → hours map. The help centre does not spell out whether the record form offers the Full / Partial toggle (gap) |
| **Note for the employee** | no | Stored as `employer_note`. The employee-side note field does not exist here — the API rejects an `employee_note` on a recorded request |

The form shows the same **Time off balance** section so the recorder sees the
person's remaining available balance before saving. The button is **Record
time off**.

### 4.4 What happens

- The time off is **approved automatically, immediately**. There is no review
  step and no second person involved.
- The employee gets an email saying it was recorded for them.
- It appears in the person's **Approved** list and in the tracker as
  **Admin recorded request** (a self request shows as **Employee request**).
- The stored request keeps **both identities**: `employee` (whose time off)
  and `initiator` (who created it).
- Policy auto-approval rules are **not consulted** — they only apply to what
  employees submit.
- Over a Sick annual usage cap, a recorded entry **warns but still saves**
  (an employee's own request is blocked). Source: the policies article, PAC-174
  research §8.
- Dates: the manager article says a manager can record **future dates only**,
  "not for a payroll that already ran". The API guide gives "logging a sick day
  after the fact" as the standard use for an admin. So the real limit is
  payroll, not the calendar: time inside an already-paid period needs an
  off-cycle payroll.

---

## 5. Self request vs recorded for someone else

| | Self request | Recorded for someone else |
|---|---|---|
| Who | The employee | A manager (own team) or an admin |
| Inputs | Policy, dates, full/partial, note **to manager** | Employee, policy, dates, note **to employee** |
| Starting status | Pending (or Approved by auto-approval) | **Approved** |
| Review | Manager or admin approves / declines | None |
| Auto-approval rules | Apply | Do not apply |
| Over Sick usage cap | Blocked | Warned, allowed |
| Email | Reviewer on submit; employee on decision | Employee, "recorded for you" |
| Tracker row | Employee request | Admin recorded request |
| API | `POST …/time_off/requests` (scope `write`) | `POST …/time_off/admin_approved_requests` (scope `manage`) |
| Can be undone by | Employee deletes; reviewer declines | Reviewer declines the approved request |

### 5.1 Who reviews a self request

- If the employee has an **assigned manager**, only that manager is emailed.
  Admins stop getting the emails but can still see and act on every request.
- With no manager assigned, the admins are emailed.
- A request from an employee **who is also an admin** is never routed to a
  manager.
- When a payroll admin submits a request for themself, no other admin is
  emailed.
- Managers get a **Time off requests** card under *Important tasks* on Home;
  admins get a sticky note on Home.

---

## 6. Reviewing a request

The reviewer opens a request with **View** from either the Time off page
(filter *To Review*) or the person's profile (*Time off → Time off requests*).
The window shows the request details and a **Time off balance** section: the
employee's current balance, their other requested hours, this request, and the
remaining available balance for that policy.

| Action | Works on | Detail |
|---|---|---|
| **Approve request** | Pending | Optional note to the employee |
| **Edit, then approve** | Pending | *Edit* next to *Requested time* lets the reviewer change the hours before approving (API: approve accepts an overriding date → hours map) |
| **Decline request** | Pending | A note explaining why. The API **requires** it; the manager article labels it optional |
| **Decline approved request** | Approved, not yet paid | Note for declining, then *Decline approved request*. Payroll and timesheets update automatically |

Rules:

- **No partial decline.** Decline the whole request and ask for two separate
  ones.
- **A decline is final.** "Declined requests cannot be undone"; a mistaken
  decline means the employee resubmits.
- **An approved request cannot be edited.** Decline it and have the employee
  resubmit with the right hours.
- Only a pending request can be approved; approving an approved, declined or
  paid request is rejected. That is the API's "first decision wins".
- The employee is emailed on every decision.

---

## 7. Statuses

| Gusto UI (reviewer) | Gusto UI (employee) | API `status` | Meaning |
|---|---|---|---|
| To Review | Pending requests | `pending` | Sent, not decided |
| Approved | Approved requests | `approved` | Approved, payroll has not processed all the dates |
| Paid | Past vacation / sick time | `consumed` | Approved and paid; can no longer be changed or cancelled |
| Declined | Declined | `declined` | Declined; terminal |
| — | — | (deleted) | Removed by the employee; not a visible status |

Transitions:

```
(send)   → pending  → approved → consumed
                   ↘ declined ↙ (approved → declined until paid)
pending | approved → deleted (employee, until paid)
(record) → approved
```

---

## 8. What is stored (Embedded API)

The request object, in full:

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | |
| `status` | `pending` · `approved` · `declined` · `consumed` | |
| `policy_uuid`, `policy_type` | string | The policy and its type (vacation, sick, …) |
| `days` | object | `{ "2026-05-26": "8.000", "2026-05-27": "4.000" }`. **Every date from start to end must be a key**, weekends included; values 0–24 |
| `employee_note` | string, nullable | Employee → employer. Only settable on a self request |
| `employer_note` | string, nullable | Employer → employee. Set on approve, decline or record |
| `employee` | `{ uuid, full_name }` | Whose time off |
| `initiator` | `{ uuid, full_name }` | Who created it — the employee, or the admin who recorded it |
| `approver` | `{ uuid, full_name }`, nullable | Null until approved |

There is **one note in each direction and no history**: no timeline, no list of
actions, no previous values. A second note overwrites the first.

Create (self) and record (on behalf) take the same body — `employee_uuid`,
`policy_uuid`, `start_date`, `end_date`, `days` — differing only in which note
field is accepted and in `approver_uuid` on the recorded one.

Balances come back per person per policy as `balance_hours`, `accrued_hours`,
`used_hours`, `pending_hours`.

---

## 9. Gaps in the public material

- The record-on-behalf form's hour entry (Full / Partial toggle or not) is not
  described; only "Enter the dates" and "Enter the time off details".
- The employee article points at an "Understand a negative balance" section
  that is not in the published page text.
- Nothing says whether a **company holiday** inside the range is skipped. The
  only stated rule is "8 hours per weekday, weekends not included".

---

## 10. Where Gusto and the current PAC-165 ticket differ

The ticket's lifecycle predates this research. These are the points to settle
in the ticket pass. The right-hand column is a starting suggestion, not a
decision.

| # | Topic | Gusto | Ticket today | Suggested starting point |
|---|---|---|---|---|
| 1 | **Draft** | None. A request exists only once sent | Draft, creator-only | Drop Draft. The form is four inputs; nothing to save half-way |
| 2 | **Changes Requested** | None. The reviewer edits the hours and approves, or declines with a note and the employee resubmits | A status, with resubmission | The biggest fork. Gusto-simple = drop it and let the reviewer edit hours on approval (#3) |
| 3 | **Reviewer edits hours on approval** | Yes | Not in the ticket | Needed if #2 is dropped |
| 4 | **Editing after sending** | Never; delete and resend | Only in Changes Requested | Follows #2 |
| 5 | **Cancel** | Hard delete, pending or approved, until paid | `Cancelled` terminal status, nothing deleted | Keep `Cancelled` — "never hard-delete" is a product rule (PAC-155). Same button, the row stays |
| 6 | **Taking back an approval** | Reviewer *declines* the approved request → Declined | Employee before a cutoff, admin any time → Cancelled + `Reversal` | Same mechanics, two names. Pick one: reviewer-revoked = Declined (Gusto) or Cancelled (ticket) |
| 7 | **Recorded on someone's behalf** | **Approved immediately**, no review | "Still goes through review" | Decide. PAC-174's `evaluateAutoApproval` already takes `recordedByManager` and returns "do not auto-approve", i.e. it was built for the ticket's answer. Gusto's answer needs a rule for who may record (a manager recording for themself is just a self request) |
| 8 | **Hours** | Flat 8 h per weekday; partial = typed hours per date; holidays not mentioned | Computed server-side from the person's schedule and the agency calendar, frozen | Keep ours — the work-week and holiday policies exist (PAC-161). Borrow the shape: store a per-date hours map, and Partial days edits each date up to its scheduled hours |
| 9 | **Balance numbers** | Current balance · Other requested hours · This request · Remaining available balance | "Available hours" and "Current balance", definitions open (epic open point 7) | Adopt Gusto's four lines verbatim in the form and the review window; **Available = Current balance − Other requested hours** closes open point 7 |
| 10 | **Own-date overlap** | Hard block against pending, approved and paid requests | Overlap modes dropped in v2; reviewer sees branch overlap | Hard-block a person's own overlapping dates; branch overlap stays information for the reviewer |
| 11 | **Past dates** | Employee: not for hourly staff. Manager: future only. Admin: until payroll ran | Not stated | We have no payroll to protect. Decide whether a past-dated self request is allowed, or only a recorded one (the "called in sick yesterday" case) |
| 12 | **Blocking at submit** | Usage cap and negative balance block the employee; a recorded entry only warns | Negative balance blocked unless an admin overrides with a reason | Evaluators exist from PAC-174 (`exceedsAnnualUsageCap`, `usageAllowedFrom`). Decide whether a recorded entry warns (Gusto) or blocks |
| 13 | **Decline note** | Required | Required | Same |
| 14 | **Partial decline** | Not supported | Not in the ticket | Same — leave out |
| 15 | **Who reviews** | The assigned manager, otherwise admins; an admin's own request skips managers | `hr:write` holders in the branch, `agency:hr:admin` agency-wide, never yourself | Keep ours (permission-based, no manager assignment exists) |
| 16 | **Reminders / escalation** | None | Reminder, escalation and upcoming-leave jobs (epic open point 6) | Gusto is evidence for dropping the jobs from this ticket |
| 17 | **History** | One note each way, no timeline | `timeline[]` of actions and notes | Keep the timeline; it costs little and replaces Gusto's overwritten notes |
| 18 | **Notes** | Note to manager on send; note to employee on decision or record | Free-form notes any time | Gusto's three note moments cover the need; "anyone may add a note any time" is extra |
| 19 | **"Paid"** | A status, set by payroll | No payroll | Not a status for us. Show approved leave whose dates have passed as *Taken*, derived from the dates |
| 20 | **Unlimited policy** | No balance shown; breakdown hidden | Not stated | Same as Gusto |

Already settled elsewhere and not reopened here: the company-wide "enable time
off requests" switch (not copied — a person in a policy can request, PAC-174
research §14), auto-approval rules (PAC-174), the ledger collection and its
row kinds (PAC-174).

---

## 11. Direction taken 2026-11-05 (Asad)

**Gusto's screens, our lifecycle.** The UI copies Gusto's flow; the statuses
and rules stay ours.

| Point | Decision |
|---|---|
| Statuses (§10 #1, #2, #4) | **Kept**: Draft → Submitted → Changes Requested / Approved / Declined / Cancelled. So no reviewer editing of hours on approval (#3) — Changes Requested does that job |
| Recording time off for someone else (§10 #7) | Only for users who hold the permission for it **and** may see all users. Owners, Admins, Branch Managers and HR hold it by default |
| UI | Gusto's flow, adapted to our requirements |

How Gusto's screens map onto our lifecycle:

| Gusto screen | Ours |
|---|---|
| Time off page, one row per policy with **Request time off** | Same: a card per policy the person is in, with Available hours and Current balance, and **Request time off** on the card |
| Request window: dates → Full / Partial days → balance breakdown → note → **Send request** | Same four inputs and the same four balance lines. Hours per date come from the person's work week and the agency calendar, not a flat 8; Partial days defaults each date to its scheduled hours. Two buttons: **Send request** and **Save as draft** |
| Employee's lists: Pending / Approved / Declined / Past | Same, plus **Drafts**, **Changes requested** (on top — it needs the employee) and **Cancelled** |
| *View* → **Delete request** | *View* → **Cancel request** (the row stays, status Cancelled). On a Draft or Changes Requested: **Edit** and **Send request** |
| **My Team's Time Off** table with a status dropdown, default *To Review* | Same table on the same page for reviewers, default *To review* |
| Review window: details + Time off balance → **Approve** / **Decline** | Same window plus the timeline → **Approve** / **Request changes** / **Decline**; a note is required on the last two |
| **Record time off for an employee** below the team table, and on the person's profile | Same two entry points, shown only to holders of the recording permission; the employee picker is limited to the caller's scope |

The recording permission (decided 2026-11-05, Asad):

- **Reuse the existing pair**: `hr:write` (the reviewer capability) and
  `agency:users:read`. No new permission string. **Agency Owner** and
  **Branch Manager** hold both today, so nothing needs granting or migrating.
- **"Admin" and "HR" role templates are a separate ticket**, not PAC-165. The
  six templates today are Agency Owner, Branch Manager, Producer, CSR, CRM and
  Data Team; until that ticket, an agency gives the pair to a custom role by
  hand.

Four more, decided the same day (Asad, by question dialog):

| Question | Decision |
|---|---|
| A request recorded for someone else (§10 #7) | **Approved on creation**, as Gusto. The timeline shows who recorded it. Recording for yourself is an ordinary request that still needs review (no self-decision). The policy's auto-approval rules are not consulted on this path, so PAC-174's `evaluateAutoApproval` is called for self requests only |
| Reminder, escalation and upcoming-leave jobs (§10 #16, epic open point 6) | **None built in PAC-165.** Notifications fire only when a request is sent, decided, cancelled or recorded. A follow-up ticket if David asks |
| Balance numbers (§10 #9, epic open point 7) | **Gusto's four lines**: Current balance · Other requested hours (pending + approved upcoming) · This request · Remaining available balance. The card's **Available hours = Current balance − Other requested hours** |
| Past dates (§10 #11) | **Only when recorded.** An employee's own request starts today or later; someone recording for another person may back-date |

Consequence for the ledger read: `LeaveLedgerService.balances` sums every row
with no date filter. With `used` rows dated on the leave days, *Current
balance* needs an as-of date (rows up to today) and *Other requested hours*
is the approved-upcoming `used` rows plus Submitted / Changes Requested hours.

Defaults assumed for the smaller rows of §10 — **not yet confirmed**, for the
implementation plan to state and Asad to correct:

- **Own-date overlap** (#10): hard block against the person's Submitted,
  Changes Requested and Approved requests; Drafts are ignored.
- **Taking back an approval** (#6): stays **Cancelled** with a comment and
  `Reversal` rows, as the ticket words it; the employee may cancel an approved
  request until its first day.
- **Recorded entry over the usage cap or below zero** (#12): warned, allowed
  (Gusto). An employee's own request is blocked.
- **Notes** (#18): required on Request changes and Decline, optional on
  Approve and on a recorded entry. "Anyone may add a note any time" is not
  built.
- **"Taken"** (#19): derived from the dates of approved leave, not a status.
- **Unlimited policy** (#20): no balance lines.
- **Stale ticket lines**: the allocation job is already `accrue-time-off`
  (PAC-174); `hr:review` does not exist (`hr:write` is the reviewer
  permission); attachments, reason lists and coverage notes stay dropped.
- **Still in scope from the ticket**: the `used` / `reversal` /
  `manual_adjustment` ledger writers, the manual balance adjustment, the
  legacy `timeOffRequests` migration, notifications through the PAC-154
  worker, Bruno requests and the demo seed.

---

## Sources

- Gusto Help Center — *Request and manage time off (for employees)*:
  https://support.gusto.com/article/999877041000000/request-and-manage-time-off-for-employees
- Gusto Help Center — *Approve and edit time off requests (for managers)*:
  https://support.gusto.com/article/101980064100000/approve-and-edit-time-off-requests-for-managers
- Gusto Help Center — *Turn on and manage employee time off requests (for admins)*:
  https://support.gusto.com/article/100395028100000/turn-on-and-manage-employee-time-off-requests-for-admins
- Gusto Help Center — *Set up and manage time off policies (for admins)* (usage
  cap and auto-approval behaviour for recorded time):
  https://support.gusto.com/article/999756591000000/set-up-and-manage-time-off-policies-for-admins
- Gusto Embedded API — *Time off requests* (lifecycle, statuses, errors):
  https://docs.gusto.com/embedded-payroll/docs/time-off-requests
- Gusto Embedded API — *Time Off Request Events*:
  https://docs.gusto.com/embedded-payroll/docs/time-off-request-events
- Gusto Embedded API reference — *Create a time off request*, *Create an
  admin-approved time off request*, *Preview a time off request*, *Approve*,
  *Decline* (request and body schemas):
  https://docs.gusto.com/embedded-payroll/reference/post-v1-companies-company_uuid-time_off-requests
  https://docs.gusto.com/embedded-payroll/reference/post-v1-companies-company_uuid-time_off-admin_approved_requests
  https://docs.gusto.com/embedded-payroll/reference/post-v1-companies-company_uuid-time_off-requests-preview
  https://docs.gusto.com/embedded-payroll/reference/put-v1-time_off-requests-time_off_request_uuid-approve
  https://docs.gusto.com/embedded-payroll/reference/put-v1-time_off-requests-time_off_request_uuid-decline
