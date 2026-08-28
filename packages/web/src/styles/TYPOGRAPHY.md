# Typography & sizing scale (`packages/web`)

The scale the app is built to. It exists because the first pass over Leads and
Lead Detail ended up with **three competing label tiers**, the same status pill
at three sizes, and the same `Home` icon at 12px and 13px inside one card. Reach
for a row in these tables rather than picking a number.

Applied to: the app sidebar, `/leads`, `/leads/:id`, the intake forms, and — as
of the CRM design-language pass — `/crm/tickets`, `/crm/tickets/archived`,
`/clients/:id` and `/policies/:id`.

Still excluded: the **management, management-alt and service** prototype
dashboards. Those three are slated for replacement and still carry the patterns
this document exists to stop (`text-[10px]`, hand-rolled pills and buttons, raw
hex, and the four undefined `--emerald` / `--red` / `--amber` / `--font-mono`
variables that render as no colour at all). Don't copy from them.

## The root is 15px, not 16px

`theme.css` sets `--font-size: 15px` and `html { font-size: var(--font-size) }`,
so every rem-based Tailwind size renders ~6% smaller than its name suggests:

| class | nominal | actual |
|---|---|---|
| `text-xs` | 12px | **11.25px** |
| `text-sm` | 14px | **13.13px** |
| `text-base` | 16px | **15px** |
| `text-lg` | 18px | **16.88px** |

This is why `text-sm` body copy read as too small. Keep it in mind when judging
a class name; the tables below are already calibrated for it.

## Text

| Role | Class |
|---|---|
| Page title (`h1`) | `text-lg font-semibold tracking-tight` |
| Card title (`h2`) | `text-sm font-semibold text-card-foreground` — **sentence case** |
| Section sub-label | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |
| Primary body | `text-base` |
| Secondary / meta | `text-sm text-muted-foreground` |
| Micro (timestamps, chips, hints) | `text-xs` |
| Money, counts, policy numbers | add `tabular-nums` |

**Do not use `text-[10px]` or `text-[11px]`.** They were the old sub-label and
chip sizes; `text-xs` replaces both. Arbitrary font sizes are the thing this
document exists to stop.

Card titles are **not** uppercase micro-labels. A 10–11px uppercase muted `h2`
is a label, not a heading — it made every card read as an afterthought. One
uppercase tier survives (the section sub-label above) and that is the limit.

## Icons

| Role | Size |
|---|---|
| Inline meta (beside a line of text) | `size-4` |
| Control / button icon | `size-4` |
| Prominent, section or status icon | `size-5` |
| Page-level state (loader, error) | `size-5` |

Prefer the Tailwind `size-*` class over lucide's `size={n}` prop — it is what
the shadcn primitives already target with rules like
`[&_svg:not([class*='size-'])]:size-4`, and a numeric prop silently opts out of
them.

Dots and bubbles: temperature dot `size-2`, timeline icon bubble `size-8` with a
`size-4` icon inside, avatar `size-8`.

## Shape

| Element | Class |
|---|---|
| Card / panel | `rounded-xl` |
| Button, input, menu | `rounded-md` |
| Pill, badge, dot, avatar | `rounded-full` |

Lead Detail cards used `rounded-lg` while the Leads list used `rounded-xl`;
`rounded-xl` won because `FormSection` already uses it.

Card padding: header `px-5 py-3`, body `px-5 py-4`, inter-card gap `gap-4`.

## Colour

Tokens only — see AGENTS.md §11. The traps specific to this app:

- `--accent` is the **subtle hover/focus surface** shadcn primitives expect, not
  a brand colour. The brand emerald is `--success`.
- Raw palette values (`slate-400`, `amber-500`, `white/[0.03]`) are *dark-only*
  and will be wrong — often invisible — on the light theme.
- The one sanctioned exception is `features/lead/components/lead-display.ts`,
  which encodes the mockup's semantic status/temperature hues. Even there, pin
  the light rendering with a `dark:` pair when the raw value fails on `#F8FAFC`.

## Controls

Every clickable thing goes through `components/ui/button.tsx` (or
`buttonVariants` + `asChild` for a `<Link>`). A hand-rolled `<Link>` with ad-hoc
padding has no focus ring, no disabled handling and no size scale — which is
exactly how "Quote" ended up not looking like a button while "Mark as Sold" did.

Status pills use `<Badge size="sm">`, not hand-written pill classes.
