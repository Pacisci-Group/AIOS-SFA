# TanStack Form spike — findings

De-risking spike run before migrating the four `packages/web` forms off
react-hook-form. Experiments live on the throwaway branch
`spike/tanstack-form-wizard` (**do not merge**) — `packages/web/spike-validate.mjs`
and `packages/web/src/spike/policy-group-spike.tsx`.

Version tested: **`@tanstack/react-form` 1.33.3** (the plan was researched against
1.11.0).

**Verdict: proceed with the migration.** All four questions cleared. Two
non-obvious API traps were found that would have cost real time mid-migration;
both are recorded below with the working pattern.

---

## Q1 — Per-card partial validation (the blocker)

**Question:** is there a working equivalent of the Sold wizard's
`await draft.trigger(CARD_FIELDS[nav.card])`, given that all our rules live in a
single form-level zod schema?

**Answer: yes.**

```ts
async function validateCard(form, card) {
  await Promise.all(CARD_FIELDS[card].map((f) => form.validateField(f, "submit")));
  return CARD_FIELDS[card].every(
    (f) => (form.getFieldMeta(f)?.errors ?? []).length === 0,
  );
}
```

Verified against a mounted-field harness reproducing the wizard's shape (one
form-level zod schema, a `superRefine` whose error lands on a different field,
only the active card's fields mounted). Seven assertions, all passing:

- blocks on mounted-but-untouched empty required fields
- passes while later cards are still empty and invalid
- `superRefine` cross-field errors surface, and clear when satisfied
- validating one card does **not** mark later cards' fields touched
- `form.validate("submit")` still catches everything at the commit step

### Trap 1 — `validateField`'s return value is unreliable

On a **mounted** field it returns `[]` even when the field is invalid.
`FormApi.validateField` calls `setMeta({isTouched: true})` then
`FieldApi.validate()`, which opens with `if (!this.state.meta.isTouched) return []`
— and `this.state` is still the pre-`setMeta` snapshot in that tick, so it bails
before reporting. **The validation itself did run**; the errors are in field meta.

→ **Discard the return value; read `form.getFieldMeta(name).errors`.**

This is easy to get wrong because `validateField` behaves *correctly* on
**unmounted** fields (a different branch that calls `validateSync` and reads meta
itself). An early version of this spike tested only that branch and looked green
when the real path was broken.

### Trap 2 — `validateAllFields` only walks mounted fields

It cannot stand in for the final check in a wizard that mounts one card at a
time; it silently returns no errors for everything not currently on screen.

→ **Use `form.validate("submit")` for the Card 8 commit**, not
`validateAllFields`.

### Bonus

`validateField` is typed `DeepKeys<TFormData>`, so `CARD_FIELDS` can be retyped
from today's `Array<keyof SoldPolicyFormValues>` to real deep paths — which both
removes the existing cast at `SoldDealWizard.tsx:108` and allows naming nested
fields like `priorInsurance.carrier`.

---

## Q2 — One shared policy-row group, two parent schemas

**Question:** can a single row component be typed against both
`LeadIntakeFormValues` and `QuoteRecapFormValues` with zero casts, given that the
docs exclude "arrays at the top level of a field group" from object remapping?

**Answer: yes — parent owns the array, group is one row addressed positionally**
(`fields={`policies[${i}]`}`). Compiles clean with no casts.

### This forces a better design, and that is the main finding

The first attempt mirrored today's `PolicyRowsField`: one group declaring an
optional `premium` plus a `showPremium` boolean. **It does not compile.** A field
group requires *every key it declares* to exist on the parent, and the New Lead
schema has no `premium` at all — so there is no path to map it to.

The compiler is right. `showPremium` was a flag making one component behave as
two. The fix is composition: the group owns what the forms genuinely share
(`policyType`, `itemCount`), and Quote Recap composes its own premium field in
through `children`. Carry this into Phase 3 — **do not port `showPremium`.**

### The defect is closed — proven negatively

The spike's lead-intake parent deliberately names the array **`policiesOfInterest`**
— the rename that is impossible today because `PolicyRowsField` hardcodes
`"policies"`. It compiles.

Renaming the schema field while leaving the `fields=` prop stale produces **5
compile errors**, the first naming the exact bad path and listing the valid
alternatives:

```
error TS2322: Type '"policiesOfInterest"' is not assignable to type
'"leadSourceCode" | "renamedPolicies" | `renamedPolicies[${number}]` | ...'
```

That is the whole point of the refactor, demonstrated. **Phase 4's rename becomes
a two-line change** once Phase 3 lands.

---

## Q3 — The `setValue`-in-`useEffect` contract

**Question:** does `PropertyAddressSection`'s effect survive without
reintroducing the infinite loop?

**Answer: the hazard does not transfer.** `useForm` creates the `FormApi` via
`useState(() => new FormApi(...))`, so the instance is referentially stable
across renders, and `setFieldValue` is a constructor-bound method. The RHF loop
came from `useFormContext()` returning a fresh object every render, which with
`shouldValidate: true` fed itself. Neither condition exists here.

The 10-line warning comment at `PropertyAddressSection.tsx:74-83` can go once
migrated — **but** the separate requirement that callers pass a referentially
stable `householdAddress` still stands. That is about the caller's own object,
not the form library, so `LeadIntakeForm`'s memo over four individual watches
stays.

---

## Q4 — Draft isolation via `key={policies.length}`

**Answer: unchanged.** Because `useForm` holds the instance in `useState`,
remounting via `key` yields a brand-new `FormApi` with fresh values and meta —
the same semantics the wizard relies on today. This is a React mechanism rather
than a library one.

*Verified by reading the source, not by running it — the weakest of the four
answers, though the mechanism is simple and the Phase 3 browser pass will
exercise it directly.*

---

## Carried into Phase 3

1. `validateCard` helper reading field meta, not `validateField`'s return value.
2. `form.validate("submit")` for the final commit, never `validateAllFields`.
3. Retype `CARD_FIELDS` to `DeepKeys`, dropping the existing cast.
4. Drop `showPremium`; compose the premium field at the Quote Recap call site.
5. Keep `LeadIntakeForm`'s `householdAddress` memo; drop the RHF loop comment.

---

## Trap 3 — `form.reset()` does not redraw a `mode="array"` field

*Not from the spike. Found in PAC-93 / PAC-71 while fixing a reported bug, and
recorded here because this is where the version-specific traps live. Same
version, `@tanstack/react-form` 1.33.3.*

**Never seed a mounted form from the server with `form.reset(serverValues)`.**
It reaches the form's state and updates every scalar field, and leaves an array
field rendering the zero rows it mounted with.

`useField` with `mode: "array"` deliberately subscribes to nothing except the
field's own array version — that is the optimisation the mode exists for:

```ts
// react-form/useField.cjs
opts.mode === "array" ? (state) => state.meta._arrayVersion || 0 : (state) => state.value
```

`FormApi.update()` knows this and calls `bumpArrayVersion` on every array field
whenever it rewrites values. **`FormApi.reset()` does not**: it replaces all
field meta with `defaultFieldMeta`, whose `_arrayVersion` is `0` — so a reset
lands the rows in state and the subscription never fires.

There is a second edge on the same blade. `useForm` calls `formApi.update(opts)`
in a **layout effect with no dependency array**, so it runs on every render, and
it rewrites values whenever `defaultValues` changes identity on a form nobody
has touched yet. A `defaultValues` computed inline from a query is exactly that.

### What it looks like

Silent, and it reads like a backend bug. The page shows its empty state over
data the API returned; the row is in form state, invisible. The next "Add row"
bumps the version and the hidden row appears *beside* the new one, so one click
looks like it added two. Saving and reloading returns to the same invisible
state, so nothing looks like it persisted either.

Hit twice on the same branch before the cause was found: the campaign wizard's
discount bands and market phones (PAC-71), and the carrier-appointments editor
(PAC-93), which is where it was finally diagnosed.

### The working pattern

Split the component in two: a loader that renders a skeleton until the query
resolves, and an inner component that passes the real values to `useAppForm`'s
`defaultValues`. Freeze that object for the component's life (`useState`) and
re-seed by **remounting with a `key`**, never by a new prop or a reset.

```tsx
if (query.isPending) return <Skeleton />;
return <TheForm key={seed} initial={toFormValues(query.data)} … />;
```

Mounting the form only once its real values exist makes the ordering impossible
to get wrong, instead of relying on a reset landing. It also removes the
`isDirty` guard such effects need: with no reset, a background refetch has
nothing to clobber. Worked examples: `RunCampaignPage`'s `SetupStep` and
`CarrierAppointmentsEditor`'s `AppointmentsForm`.
