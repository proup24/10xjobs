# Design guide

Read this before any UI work in `apps/web`. Source of truth for values: `src/app/global.css` (scales, roles) and `src/theme/roles.ts`. Live reference: `/design`.

## Rules

- Colors come from roles only (`bg-background`, `text-muted-foreground`). Never a scale step (`gray-4`, `green-7`) in pages or components.
- No literal colors (hex, `rgb(`, `oklch(`) and no arbitrary values (`p-[13px]`, `text-[#...]`) in pages or feature components. Only `global.css` holds raw values.
- No raw `<button>`, `<input>`, `<select>`, `<textarea>` outside `src/components/ui`.
- Use an existing component before writing a new one. If it is missing, see "Adding to the library".
- Inside `components/ui`, arbitrary values are tolerated only where no role or scale step can express it (shadcn's generated code has a few). Prefer tokens.
- WCAG AA in both themes: 4.5:1 for text roles, 3:1 for control borders (`--input`), focus rings and icons. A test pins this (`src/theme/theme-css.spec.ts`).
- Themes: `light` and `dark` only, class on `<html>`, default `dark`, no system option. Fonts: Roboto (`font-sans`, `font-heading`) and Roboto Mono (`font-mono`).
- Icons: Lucide, 16px (`size-4`), stroke 1.5, set by a base-layer `svg.lucide` rule in `global.css`. That rule overrides a `size={n}` prop, so resize with a `size-*` class instead.
- No CI check enforces these rules; follow them anyway.

## Tokens

Scales (`--gray-1..12`, `--green-*`, `--amber-*`, `--red-*`) exist only to feed roles. Roles differ per theme and are used as Tailwind classes.

| Role                                 | Purpose                                    | Example class                        |
| ------------------------------------ | ------------------------------------------ | ------------------------------------ |
| `background` / `foreground`          | Page surface and default text              | `bg-background text-foreground`      |
| `card` / `card-foreground`           | Raised panels                              | `bg-card text-card-foreground`       |
| `popover` / `popover-foreground`     | Floating surfaces                          | `bg-popover`                         |
| `primary` / `primary-foreground`     | Main action fill and its text              | `bg-primary text-primary-foreground` |
| `secondary` / `secondary-foreground` | Quiet action fill                          | `bg-secondary`                       |
| `muted` / `muted-foreground`         | Subtle fills; secondary text               | `text-muted-foreground`              |
| `accent` / `accent-foreground`       | Hover and selected fills                   | `hover:bg-accent`                    |
| `destructive`                        | Errors and dangerous actions (text/border) | `text-destructive`                   |
| `border`                             | Dividers and card edges                    | `border-border`                      |
| `input`                              | Control borders (3:1)                      | `border-input`                       |
| `ring`                               | Focus ring                                 | `ring-ring`                          |
| `brand`                              | Brand green as text or border              | `text-brand`                         |
| `success` / `success-foreground`     | Positive status                            | `text-success`                       |
| `warning` / `warning-foreground`     | Caution status                             | `text-warning`                       |
| `mark` / `mark-foreground`           | Highlighted text                           | `bg-mark text-mark-foreground`       |
| `chart-1..5`                         | Data series                                | `fill-chart-1`                       |
| `sidebar*`                           | Sidebar surfaces (not used yet)            | `bg-sidebar`                         |

**Type.** Body is `text-sm` (14/20). Titles are weight 400 and sized by token:

| Token          | Size / line | Use for                       |
| -------------- | ----------- | ----------------------------- |
| `text-title-1` | 48 / 57.6   | Landing hero only             |
| `text-title-2` | 36 / 43.2   | Page title on large screens   |
| `text-title-3` | 24 / 32     | Page title, section heading   |
| `text-title-4` | 18 / 28     | Card or dialog title          |
| `text-title-5` | 16 / 24     | Subsection heading, lead text |

**Spacing** is Tailwind's default scale; no custom spacing tokens.

**Radius:** `rounded-sm` 4px (buttons, checkboxes), `rounded-md` 6px (inputs), `rounded-lg` 8px (`--radius`, cards), `rounded-xl` 12px (dialogs). Larger steps scale from `--radius`.

**Shadows:** `shadow-button` (`0 2px 0 rgb(0 0 0 / 0.05)`) on buttons; `text-shadow-brand` on the primary button text. `shadow-sm`, `shadow-md`, `shadow-lg` are for floating surfaces (popovers, menus, dialogs): layered stacks adapted from supabase/supabase (Apache-2.0), with a ring that is stronger in dark mode via `--floating-shadow-strength` and `--floating-ring-color`.

## Contrast adjustments

Kit values come from the Figma file `aWnbipsr7VQnWEtm5Ewx6P`. Where one failed AA, it moved the smallest step that passes, keeping its hue.

| Item                      | Kit value                | Adjusted                      | Why                                                                                                |
| ------------------------- | ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Primary fill, dark        | `#2C9C6A`                | `#26865b` (RGB scaled to 86%) | White text on `#2C9C6A` is 3.46:1; on `#26865b` it is 4.52:1. Primary text stays white (`#FFFFFF`) |
| Primary button text, dark | `#24B47E`                | not on the dark scale         | No role uses it after the primary fill change                                                      |
| Primary fill, light       | Radix green-9 `#30a46c`  | green-11 `#218358`            | Light text on green-9/10 is below 4.5:1                                                            |
| Input border, dark        | `#444444`                | `#6b6b6b`                     | `#444` is 1.7:1 on the background; kit checkbox `#666` is 2.87:1                                   |
| Input border, light       | Radix gray-8 `#bbbbbb`   | gray-9 `#8d8d8d`              | `#bbb` is below 3:1                                                                                |
| Muted text, dark          | `#878787`                | `#9a9a9a`                     | `#878787` is 4.0:1 on the muted fill; it stays as the scale step                                   |
| Destructive text, dark    | `#EF4444`                | `#f26b6b`                     | 4.38:1 on the background                                                                           |
| Warning text, light       | Radix amber-11 `#ab6400` | `#a36100`                     | 4.49:1, just under                                                                                 |

Light scales and non-kit dark steps are Radix Colors' gray, green, amber and red; some dark steps are interpolated.

## Components

All in `src/components/ui`. Forms are done (PR 2); PR 3 and 4 add more and update this table.

| Component      | Variants / sizes                                                                                                                                                                                                                                                                                                     | Use it for                                                                                                                                                                                                                   | Not for                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `button`       | Variants: `default` (primary), `secondary`, `outline`, `dashed`, `ghost`, `destructive`, `link`. Sizes: `xs` (h-7), `sm` (h-8), `default` (h-9), `lg` (h-10), `xl` (h-12), and square `icon-xs`, `icon-sm`, `icon`, `icon-lg`, `icon-xl`. `loading` sets `aria-busy` and `disabled` and shows a spinner at the start | Every clickable action; use `default` once per view for the main action                                                                                                                                                      | Plain navigation links                                                          |
| `input`        | One style; `aria-invalid` shows the error state                                                                                                                                                                                                                                                                      | Single-line text, email, password                                                                                                                                                                                            | Multi-line text, one-time codes                                                 |
| `textarea`     | One style; `aria-invalid` shows the error state                                                                                                                                                                                                                                                                      | Multi-line free text (notes, cover letters)                                                                                                                                                                                  | Single-line values                                                              |
| `input-group`  | `InputGroup` with `InputGroupAddon` (`inline-start`, `inline-end`, `block-start`, `block-end`), `InputGroupInput`, `InputGroupTextarea`, `InputGroupButton`, `InputGroupText`                                                                                                                                        | An input with a leading icon, a trailing button or a text affix                                                                                                                                                              | Plain inputs; use `input`                                                       |
| `checkbox`     | One style (14px, `rounded-sm`); `aria-invalid` shows the error state                                                                                                                                                                                                                                                 | Independent yes/no options, or several choices from a short list                                                                                                                                                             | Mutually exclusive choices (use `radio-group`); instant settings (use `switch`) |
| `radio-group`  | `RadioGroup` with `RadioGroupItem`                                                                                                                                                                                                                                                                                   | Exactly one choice from a short list where every option should be visible                                                                                                                                                    | More than about 5 options (use `select`)                                        |
| `switch`       | Sizes `default`, `sm`                                                                                                                                                                                                                                                                                                | A setting that takes effect at once                                                                                                                                                                                          | A choice that needs a Save button (use `checkbox`)                              |
| `select`       | `Select`, `SelectTrigger` (`default`, `sm`), `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`                                                                                                                                                                                          | One choice from fewer than about 10 fixed options                                                                                                                                                                            | Long or searchable lists; a searchable picker arrives in PR 3                   |
| `input-otp`    | `InputOTP` with `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator`                                                                                                                                                                                                                                                 | One-time codes (sign-in)                                                                                                                                                                                                     | Any other numeric entry                                                         |
| `field`        | `Field` (`invalid`, `orientation`), `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, `FieldLegend`, `FieldContent`, `FieldSeparator`                                                                                                                                                        | Every form control: label, control, hint and error. With `invalid`, the control gets `aria-invalid` and `aria-describedby` for the description and error (input, textarea, checkbox, switch, select, radio group, input-otp) | Controls with no label or error; page layout                                    |
| `label`        | None                                                                                                                                                                                                                                                                                                                 | Naming a control; pair with `htmlFor`                                                                                                                                                                                        | Headings or free text                                                           |
| `theme-toggle` | Icon button                                                                                                                                                                                                                                                                                                          | The light/dark switch, once per page header                                                                                                                                                                                  | Other binary settings                                                           |

## Forms

Wrap each control in a `Field` with a `FieldLabel htmlFor`, optional `FieldDescription`, and a `FieldError`. Pass `invalid` when there is an error: the error shows, and the control gets `aria-invalid="true"` and `aria-describedby` pointing at the description and error. Wiring is a React context the controls read, so it works for a plain `<Input id>`; outside a `Field` controls behave as before. Sign-in is the reference.

## Adding to the library

If something is missing, add it to `components/ui`: through the shadcn CLI when shadcn has it (`pnpm --filter @xjobs/web exec shadcn add <name>`), restyled onto roles. Then add it to the showcase page and to this guide, and only then use it. Never inline it in a page.

## Responsive

Design desktop-first, then check at 360px wide. Nothing scrolls sideways at that width. Note here any component that changes shape on small screens (none yet).

## Where to look

`/design` shows every token (scales, roles in the current theme with computed contrast, type, radius, shadows) and every component with its variants, sizes and states, plus the theme toggle. It needs no sign-in, is available locally and on Vercel previews, and returns 404 in Vercel production (`VERCEL_ENV === 'production'`). That relies on Vercel's system environment variables being exposed to the build, which is the default.
