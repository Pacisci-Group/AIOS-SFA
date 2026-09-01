# `packages/web` — UI conventions

The web app is built on **shadcn/ui** — Radix UI primitives + Tailwind, with the
component **source copied into the repo** (we own & edit it). This is the base for
the whole app; do **not** introduce a second component library (MUI, Radix Themes,
Chakra, etc.).

- **Primitives live in `src/components/ui/`** and are managed by the shadcn CLI —
  add new ones with `npx shadcn@latest add <component>` (from `packages/web`),
  don't hand-write them. Config is `packages/web/components.json`.
- **`cn` util is `@/lib/utils`** (shadcn convention). Use it for dynamic classes;
  do not use Tailwind `@apply`.
- **Generated `radix-ui` (unified package)** backs the primitives — the older
  individual `@radix-ui/react-*` deps are legacy and being removed.
- **Compose, don't fork.** Build features from `ui/` primitives (`Card`, `Button`,
  `Table`, `Badge`, `Dialog`, `Sheet`, …). App-specific composites live in the
  relevant `features/*` folder, never in `components/ui`. Add variants via `cva`
  inside the primitive rather than one-off wrappers.
- **Style with design tokens, never hard-coded hex/inline styles.** The mockup
  palette is encoded as CSS-variable tokens in `src/styles/theme.css`
  (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `text-primary` = Allstate sky, `text-success` = emerald,
  `text-destructive` = amber). **Tokens theme automatically; raw palette values
  do not.** ⚠ `--accent` is **not** the brand emerald — it is shadcn's subtle
  hover/focus surface (`focus:bg-accent` on every menu item, `hover:bg-accent` on
  ghost buttons, `bg-accent` on `Skeleton`). It held emerald until PAC-56, which
  is why menus and skeletons rendered green. The brand emerald is `--success`. `theme.css` defines the light theme on `:root` and the navy brand
  theme on `.dark`, so anything written as `amber-500`, `slate-400`,
  `white/[0.04]` or a hex literal is a *dark-only* value that will be wrong —
  often invisible — on the light theme. Reach for the token
  (`text-destructive`, `text-muted-foreground`, `border-border`, `bg-sunken`)
  first. Note the two are not interchangeable even where they look it: Tailwind
  v4's `amber-500` is `oklch(0.769 0.188 70.08)`, which is *not* quite
  `--destructive`'s `#F59E0B`.
- **Theme mechanics.** `app/ThemeProvider.tsx` (next-themes) owns the
  `light`/`dark` class on `<html>`; an inline script in `index.html` writes it
  before first paint to avoid a flash. It defaults to **dark** with system
  detection **off** on purpose — the navy theme is what the app shipped as, and
  enabling system detection would silently repaint every existing user whose OS
  is light. When a light fix would shift the dark rendering, pin the original
  with a `dark:` override rather than accepting the drift (see
  `components/form/FormError.tsx`).
- **3 prototype dashboards remain** (management, management-alt, service). They
  are **not** light-theme clean and are not meant to be — they are slated for
  replacement, and they still reference `--emerald`, `--red`, `--amber` and
  `--font-mono`, which are defined nowhere and render transparent. Don't copy
  those patterns into new work.
- The **ticket workspace, household detail and policy detail** used to be on
  that list and no longer are: they render inside `AppShell`, compose `ui/`
  primitives, follow `TYPOGRAPHY.md`, and are light+dark clean. The eight
  `--kpi-*` variables they relied on are **deleted** from `theme.css` — they
  were declared only under `.dark`, so every one of them rendered as no colour
  on the light theme. Their replacements are the theme tokens plus the
  `X-600 dark:X-400` pairs in `features/tickets/components/ticket-data.ts` and
  `features/household/components/policy-display.ts`, which follow the same rules
  as `lead-display.ts`. Never add a colour variable to `.dark` without a `:root`
  counterpart.
- The detail-page card shell is **`components/common/DetailCard.tsx`**
  (`DetailCard` / `SectionLabel` / `DataRow`). It lived in `features/lead/` until
  the ticket, household and policy pages had each grown their own card idiom;
  compose it rather than hand-writing another card header.
- **We own UI/UX. The mockups are the starting point, not a contract.** There is
  no dedicated designer on this team, and the product owner has said explicitly
  that UI/UX calls are ours. `./agencyops_fe_mockups` is where a screen's layout,
  spacing and visual language come *from* (see
  `.claude/rules/figma-mockups-reference.md`) — but where a mockup produces
  something confusing, unreadable or unbuildable against the real data, **improve
  it rather than porting the problem**. Three standing constraints on that
  freedom: stay inside the **shadcn/ui design language** (compose `ui/`
  primitives, add variants via `cva`, no second component library), stay inside
  the **`theme.css` token palette**, and keep **light + dark** at parity. Say in
  the PR what you changed and why, so it can be put to the owner in one batch.
  Where the design asks for data we do not capture, the honest move is to say so
  (see the docblock on `QuoteRecapCard.tsx`), not to render empty rows.
- **Follow the type & sizing scale** in `packages/web/src/styles/TYPOGRAPHY.md` —
  text roles, icon sizes, radii and the "every clickable thing goes through
  `Button`" rule. It exists because the first pass over Leads/Lead Detail drifted
  into three competing label tiers and the same pill at three sizes.
