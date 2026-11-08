# Design guide

Read this before any UI work in `apps/web`. Source of truth for values: `src/app/global.css` (scales, roles) and `src/theme/roles.ts`. Live reference: `/design`.

## Rules

- Colors come from roles only (`bg-background`, `text-muted-foreground`). Never a scale step (`gray-4`, `green-7`) in pages or components, except the `/design` swatches.
- No literal colors (hex, `rgb(`, `oklch(`) and no arbitrary values (`p-[13px]`, `text-[#...]`) in pages or feature components. Only `global.css` holds raw values.
- No raw `<button>`, `<input>`, `<select>`, `<textarea>` outside `src/components/ui`.
- Use an existing component before writing a new one. If it is missing, see "Adding to the library".
- Inside `components/ui`, arbitrary values are tolerated only where no role or scale step can express it (shadcn's generated code has a few). Prefer tokens.
- WCAG AA in both themes: 4.5:1 for text roles, 3:1 for control borders (`--input`), focus rings and icons. A test pins this (`src/theme/theme-css.spec.ts`).
- Focus, one recipe per kind, copied as is into new components:
  - Clickables that are not fields (buttons, tabs, badges used as links, text links, chip remove, the drop zone, menu and sidebar triggers): `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. A solid 2px outline 2px clear of the fill. Never put `outline-none` or `outline-hidden` on the same element: they set the outline style to none and hide it.
  - Fields (input, input group, textarea, select trigger, picker inputs, OTP slots, checkbox, radio, switch, choice cards): `focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring` (or the `has-…`, `focus-within:` or `data-[active=true]:` form). The 1px border plus a 1px ring make a solid 2px focus border with no layout shift. Checked checkboxes and radios add `focus-visible:data-checked:border-ring`.
  - Never a low-alpha halo (`ring-ring/50`, `ring-brand/30`) as the only indicator. `--ring` meets 3:1 on `background`, `card`, `popover` and the field fill, which the contrast test pins. `src/components/ui/a11y-recipes.spec.ts` checks the recipes.
- Tinted states (`bg-<role>/10`) count too: text on a tint must meet 4.5:1 over the composited color. Add such pairs to `COMPOSITE_PAIRS` in `src/theme/roles.ts`.
- Text inputs are `text-base md:text-sm`: below 16px iOS Safari zooms the page on focus.
- Themes: `light` and `dark` only, class on `<html>`, default `dark`, no system option. Fonts: Roboto (`font-sans`, `font-heading`) and Roboto Mono (`font-mono`).
- Icons: Lucide, 16px (`size-4`), stroke 1.5, set by a base-layer `svg.lucide` rule in `global.css`. That rule overrides a `size={n}` prop, so resize with a `size-*` class instead.
- No CI check enforces these rules; follow them anyway.

## Tokens

Scales (`--gray-1..12`, `--green-*`, `--amber-*`, `--red-*`) exist only to feed roles. Roles differ per theme and are used as Tailwind classes.

- `background` / `foreground`: page surface and default text (`bg-background text-foreground`).
- `card` / `card-foreground`: raised panels (`bg-card text-card-foreground`).
- `popover` / `popover-foreground`: floating surfaces (`bg-popover`).
- `primary` / `primary-foreground`: main action fill and its text (`bg-primary text-primary-foreground`).
- `primary-hover`: primary fill on hover (`hover:bg-primary-hover`), solid, not an alpha.
- `secondary` / `secondary-foreground`: quiet action fill (`bg-secondary`).
- `muted` / `muted-foreground`: subtle fills; secondary text (`text-muted-foreground`).
- `accent` / `accent-foreground`: hover and selected fills (`hover:bg-accent`).
- `destructive`: errors and dangerous actions as text or border (`text-destructive`).
- `border`: dividers and card edges (`border-border`).
- `input`: control borders, 3:1 (`border-input`).
- `ring`: focus outline and field focus border (`outline-ring`, `border-ring`).
- `brand`: brand green as text or border (`text-brand`).
- `success` / `success-foreground`: positive status (`text-success`).
- `success-text` / `warning-text` / `destructive-text`: status text on a tint of the same role (badges, destructive button) (`bg-success/10 text-success-text`).
- `warning` / `warning-foreground`: caution status (`text-warning`).
- `mark` / `mark-foreground`: highlighted text (`bg-mark text-mark-foreground`).
- `chart-1..5`: data series (`fill-chart-1`).
- `sidebar*`: `AppShell` sidebar surfaces and items (`bg-sidebar`).

**Type.** Body is `text-sm` (14/20). Titles are weight 400 and sized by token:

- `text-title-1`: 48 / 57.6, landing hero only.
- `text-title-2`: 36 / 43.2, page title on large screens.
- `text-title-3`: 24 / 32, page title, section heading.
- `text-title-4`: 18 / 28, card or dialog title.
- `text-title-5`: 16 / 24, subsection heading, lead text.

**Spacing** is Tailwind's default scale; no custom spacing tokens.

**Radius:** `rounded-sm` 4px (buttons, checkboxes), `rounded-md` 6px (inputs), `rounded-lg` 8px (`--radius`, cards), `rounded-xl` 12px (dialogs). Larger steps scale from `--radius`.

**Shadows:** `shadow-button` (`0 2px 0 rgb(0 0 0 / 0.05)`) on buttons; `text-shadow-brand` on the primary button text. `shadow-sm`, `shadow-md`, `shadow-lg` exist; floating surfaces (popovers, menus, dialogs, toasts) all use `shadow-lg`: layered stacks adapted from supabase/supabase (Apache-2.0), with a ring that is stronger in dark mode via `--floating-shadow-strength` and `--floating-ring-color`.

## Contrast adjustments

Kit values come from the Figma file `aWnbipsr7VQnWEtm5Ewx6P`. Where one failed AA, it moved the smallest step that passes, keeping its hue.

- **Primary fill, dark:** `#2C9C6A` → `#26865b` (RGB scaled to 86%). White text on `#2C9C6A` is 3.46:1; on `#26865b` it is 4.52:1. Primary text stays white (`#FFFFFF`).
- **Kit button text, dark:** `#24B47E` (green/buttonText) → not used. The kit's primary fill is `#2C9C6A` (green/buttonBackground), adjusted above. `#24B47E` is the kit's button-text green, not the fill; it is not on the dark scale and no role uses it.
- **Primary fill, light:** Radix green-9 `#30a46c` → green-11 `#218358`. Light text on green-9/10 is below 4.5:1.
- **Primary hover:** `primary/80` → the `primary-hover` role, green-12 `#193b2d` light and green-6 `#20573e` dark. Text on `primary/80` was 3.26:1 in light; on `primary-hover` it is 12.01 / 8.42:1.
- **Input border, dark:** `#444444` → `#6b6b6b`. `#444` is 1.7:1 on the background; kit checkbox `#666` is 2.87:1.
- **Input border, light:** Radix gray-8 `#bbbbbb` → gray-9 `#8d8d8d`. `#bbb` is below 3:1.
- **Muted text, dark:** `#878787` → `#9a9a9a`. `#878787` is 4.0:1 on the muted fill. The role now points at gray-10 (`#9a9a9a`); `#878787` stays at gray-9.
- **Destructive text, dark:** `#EF4444` → `#f26b6b`. 4.38:1 on the background.
- **Warning text, light:** Radix amber-11 `#ab6400` → `#a36100`. 4.49:1, just under.
- **Status text on tints:** `text-success` / `text-warning` / `text-destructive` → `success-text` / `warning-text` / `destructive-text`. Light: step 12 (green-12, amber-12, red-12); on a 10% tint the step-11 roles are 4.05 / 4.23 / 4.36:1 and the step-12 roles 10.58 / 9.77 / 10.39:1. Dark: `success-text` and `warning-text` equal the base roles (6.83 / 6.42:1 on a 10% tint). Dark `destructive-text` is red-11 `#ff9592`, not the base red-10: red-10 was 4.14:1 on the destructive button's 20% tint; red-11 is 5.82:1 there and 4.85:1 on the 30% hover tint.
- **Focus ring, light:** Radix green-9 `#30a46c` → green-10 `#2b9a66`. Green-9 was 2.998:1 on the card surface, where the sign-in field and button sit; green-10 is 3.37:1 on cards and 3.46:1 on the background.

Light scales and non-kit dark steps are Radix Colors' gray, green, amber and red; some dark steps are interpolated.

## Components

All in `src/components/ui`: every component from the forms, overlays, display and layout work is listed here.

- **`button`**: Variants: `default` (primary), `secondary`, `outline`, `dashed`, `ghost`, `destructive`, `link`. Sizes: `xs` (h-7), `sm` (h-8), `default` (h-9), `lg` (h-10), `xl` (h-12), and square `icon-xs`, `icon-sm`, `icon`, `icon-lg`, `icon-xl`. `loading` sets `aria-busy` and `disabled` and shows a spinner at the start. Use for: Every clickable action; use `default` once per view for the main action. Not for: Plain navigation links. States: primary hover is `bg-primary-hover`; `destructive` is `destructive-text` on a `destructive` tint (/10 rest, /20 hover; /20 and /30 in dark); `link` is `text-brand`; `dashed` uses `border-input`. Focus is the clickable outline recipe (see Rules).
- **`input`**: One style; `aria-invalid` shows the error state. Use for: Single-line text, email, password. Not for: Multi-line text, one-time codes. Text is `text-base md:text-sm` (16px on phones, so iOS does not zoom); `InputGroupInput`, the pickers' inputs and the sign-in email inherit it.
- **`textarea`**: One style; `aria-invalid` shows the error state. Use for: Multi-line free text (notes, cover letters). Not for: Single-line values.
- **`input-group`**: `InputGroup` with `InputGroupAddon` (`inline-start`, `inline-end`, `block-start`, `block-end`), `InputGroupInput`, `InputGroupTextarea`, `InputGroupButton`, `InputGroupText`. Use for: An input with a leading icon, a trailing button or a text affix. Not for: Plain inputs; use `input`.
- **`checkbox`**: One style (14px, `rounded-sm`); `aria-invalid` shows the error state. Use for: Independent yes/no options, or several choices from a short list. Not for: Mutually exclusive choices (use `radio-group`); instant settings (use `switch`).
- **`radio-group`**: `RadioGroup` with `RadioGroupItem`. Use for: Exactly one choice from a short list where every option should be visible. Not for: More than about 5 options (use `select`).
- **`switch`**: Sizes `default`, `sm`. Use for: A setting that takes effect at once. Not for: A choice that needs a Save button (use `checkbox`).
- **`toggle`**: `Toggle` (`pressed`, `defaultPressed`, `onPressedChange`, `disabled`, `aria-label`), variants `default`, `outline`, sizes `sm` (h-8), `default` (h-9). Exposes `aria-pressed`; pressed fill is `bg-accent text-accent-foreground`. Use for: A two-state button that is not a form value: the "Search for this" star on a tech row. Not for: A setting that takes effect at once (use `switch`); a yes/no form option (use `checkbox`). Icon-only toggles need an `aria-label`. Focus is the clickable outline recipe (see Rules).
- **`toggle-group`**: `ToggleGroup` (`multiple`, `value: string[]`, `defaultValue`, `onValueChange`, `variant`, `size`) with `ToggleGroupItem` (`value`, `disabled`). Items share the group's variant and size. Use for: A short set of related on/off options side by side: Remote, Hybrid and On-site on a place row. Not for: Exactly one choice among options with descriptions (use `radio-group`); more than about 5 options (use `multi-picker`).
- **`rating-bar`**: `RatingBar` (`value: number | null`, `onValueChange(v)`, `max` = 5, `lowLabel`, `highLabel`, `disabled`, `aria-label`, `aria-invalid`). A joined segmented radio group of numbered items; arrow keys move and select; the checked item is `bg-primary`. Reads `Field` wiring like `radio-group`. Use for: A 1 to 5 rating such as tech mastery, with end labels ("1 = learning", "5 = expert"). Not for: Free numeric input (use `input`); more than about 7 steps. Fits 360px (max 288px wide).
- **`select`**: `Select`, `SelectTrigger` (`default`, `sm`), `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`. Use for: One choice from fewer than about 10 fixed options. Not for: Long or searchable lists (use `picker`).
- **`picker`**: `Picker` (`options`, `value: string | null`, `onValueChange`, `placeholder`, `emptyText`, `disabled`, `aria-invalid`) with `PickerOption` `{ value, label, keywords? }`. Use for: One value from a value list (country, city, role), searchable. Not for: Fewer than about 10 fixed options (use `select`).
- **`multi-picker`**: `MultiPicker` in `picker.tsx`: same props with `value: string[]`. Selected values are chips with a `Remove <label>` button; Backspace in the empty search removes the last chip; selected options are not listed again. Use for: Several values from a value list (techs, countries, cities). Not for: Short fixed lists where every option should be visible (use `checkbox`).
- **`combobox`**: Base UI Combobox parts (`Combobox`, `ComboboxInput`, `ComboboxContent`, `ComboboxList`, `ComboboxItem`, `ComboboxEmpty`, `ComboboxChips`, `ComboboxChip`, `ComboboxChipsInput`, ...). Use for: The base for `picker`; build another searchable control on it only when `picker` cannot do the job. Not for: Direct use in pages; prefer `picker`.
- **`input-otp`**: `InputOTP` with `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator`. Use for: One-time codes (sign-in). Not for: Any other numeric entry.
- **`field`**: `Field` (`invalid`, `required`, `orientation`), `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, `FieldLegend`, `FieldContent`, `FieldSeparator`. Use for: Every form control: label, control, hint and error. With `invalid`, the control gets `aria-invalid` and `aria-describedby` for the description and error (input, textarea, checkbox, switch, select, radio group, input-otp). Not for: Controls with no label or error; page layout.
- **`label`**: None. Use for: Naming a control; pair with `htmlFor`. Not for: Headings or free text.
- **`popover`**: `Popover`, `PopoverTrigger`, `PopoverContent` (`side`, `align`), `PopoverHeader`, `PopoverTitle`, `PopoverDescription`. Use for: Small interactive content anchored to a trigger: filters, extra detail, a mini form. Not for: Hints with no interaction (use `tooltip`); anything that needs a decision (use a dialog).
- **`tooltip`**: `Tooltip`, `TooltipTrigger`, `TooltipContent`; `TooltipProvider` is mounted in the root layout. Use for: A one-line label for an icon button or a truncated value, on hover and focus. Not for: Anything the user must read, click or select; touch-only information.
- **`dropdown-menu`**: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` (`variant="destructive"`), `DropdownMenuLabel`, `DropdownMenuGroup`, `DropdownMenuSeparator`, check, radio and sub-menu items. Use for: A list of actions on one object (row or card menu). Not for: Choosing a form value (use `select`). The destructive item uses `destructive-text`, on a `destructive` tint when focused.
- **`dialog`**: `Dialog`, `DialogTrigger`, `DialogContent` (`showCloseButton`), `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`. Use for: A focused task with its own content or form (edit, create). Not for: A yes/no question (use `confirm-dialog`).
- **`alert-dialog`**: `AlertDialog` parts, `AlertDialogContent` (`size` `default`, `sm`). Use for: The base for `confirm-dialog`; it cannot be dismissed by clicking outside. Not for: Direct use; prefer `confirm-dialog`.
- **`confirm-dialog`**: `ConfirmDialog` with `trigger`, `title`, `description`, `confirmLabel`, `destructive`, `onConfirm`, `onError`. Use for: Confirming an action. The confirm button shows a spinner while `onConfirm` is pending; the dialog closes when it resolves and stays open when it rejects. A rejection goes to the optional `onError(error)` prop (report it with a toast there); without `onError` it is logged with `console.error`. Not for: Forms or choices; use `dialog`.
- **`sheet`**: `Sheet`, `SheetTrigger`, `SheetContent` (`side`: `left`, `right`, `top`, `bottom`), `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`. Use for: A side panel that slides in from an edge; the mobile navigation drawer. Not for: Centered tasks (use `dialog`).
- **`sidebar`**: `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` (`isActive`), `SidebarInset`, `SidebarTrigger`. Use for: The navigation chrome of `AppShell`; below `md` it renders as a `Sheet`. The desktop sidebar is always visible (no keyboard shortcut, no collapse). Not for: Pages outside `AppShell`; use `FlowLayout`.
- **`sonner`**: `Toaster` (mounted in the root layout, follows the theme) with `toast`, `toast.success`, `toast.error`, `toast.warning` from `sonner`. Use for: Short feedback after an action: saved, failed, copied. Not for: Errors tied to a field (use `FieldError`); anything that must stay on screen.
- **`card`**: `Card` (`size` `default`, `sm`) with `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`; `rounded-lg`, `border-border`, `bg-card`. Use for: A raised group of related content: a job, a profile summary. Not for: Page layout; a bare section needs no card.
- **`badge`**: `default`, `secondary` (the neutral status tone), `outline`, `success`, `warning`, `destructive`. Status variants are tinted (`bg-<role>/10`) and use the `success-text`, `warning-text` and `destructive-text` roles, which are step 12 in light mode (the base roles are under 4.5:1 on their own tint). Use for: Short status or count labels: applied, needs review, rejected. Not for: Actions (use `button`); long text.
- **`tabs`**: `Tabs`, `TabsList` (`default`, `line`), `TabsTrigger`, `TabsContent`. Use for: Switching between views of the same data on one page. Not for: Navigation between pages. Inactive triggers are `text-muted-foreground` (5.19 / 5.10:1 on the `muted` list).
- **`table`**: `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`. Use for: Tabular records with columns. Not for: Layout; one-column lists.
- **`steps`**: `Steps` (`steps: { id, label }[]`, `current` zero-based, clamped to range). Full list from `sm` up; below `sm` a "Step N of M · Label" summary (aria-hidden) while the list stays in the accessibility tree, visually hidden. Current item has `aria-current="step"`; done items end in "(done)". Use for: Multi-step flows with a known, short sequence (slice 07 setup). Not for: Navigation between pages; progress of a running task.
- **`file-drop-zone`**: `FileDropZone` (`accept: { mime, extension }`, `maxBytes`, `value`, `onFileChange`, `onReject('type' | 'size' | 'multiple')`, `error`, `disabled`). A focusable dashed button that opens a hidden file input; `border-brand` while a file is dragged over. A file matches on MIME type or on a case-insensitive extension (so an empty MIME type with `.pdf` passes); `maxBytes` itself is allowed. Reads `Field` wiring. Use for: One file upload with a type and size limit. Slice 07 (resume) passes `{ mime: 'application/pdf', extension: '.pdf' }` and `MAX_RESUME_BYTES` from `src/lib/resume/key.ts`, and maps `onReject` reasons to messages in `error`. The accept rule is MIME type OR extension, so a client-side match is a hint only: the server must check the `%PDF` magic bytes before storing the file. Not for: Several files; uploads that need previews.
- **`separator`**: `orientation` `horizontal`, `vertical`. Use for: A thin divider between groups. Not for: Spacing (use gap).
- **`skeleton`**: Takes size classes (`h-4 w-3/4`). Use for: Placeholder shapes while content loads. Not for: Spinners for button actions (use `button` `loading`).
- **`spinner`**: None; `size-4` by default, resize with a `size-*` class. `role="status"`, label "Loading". Use for: The spinner inside `button` `loading`; a rare standalone wait. Not for: Button actions: use `button` `loading` instead of placing one by hand.
- **`empty`**: `Empty`, `EmptyHeader`, `EmptyMedia` (`default`, `icon`), `EmptyTitle`, `EmptyDescription`, `EmptyContent`. Use for: A list or page with nothing to show, with an optional next action. Not for: Errors (use `FieldError` or a toast).
- **`kbd`**: `Kbd`, `KbdGroup`. Use for: Showing a keyboard shortcut. Not for: Buttons.
- **`text`**: `Code` (`font-mono`, `bg-muted`, `border-input`), `Mark` (`bg-mark text-mark-foreground`), `TextLink` (wraps `next/link`, `text-brand`). Use for: Inline code, highlighted matches, links inside prose. Not for: Standalone navigation or actions (use `button`).
- **`theme-toggle`**: Icon button. Use for: The light/dark switch, once per page header. Not for: Other binary settings.

## Overlays

- **Dialog vs confirm dialog:** a dialog hosts a task (a form, content to read or edit) and has a close button. A confirm dialog asks one yes/no question about an action the user already chose; it has Cancel and a confirm button, and `destructive` styles the confirm button red. If the question needs input, use a dialog.
- **Tooltip vs popover:** a tooltip is a one-line, non-interactive label shown on hover and focus. A popover opens on click, can hold links, buttons and fields, and stays until dismissed. If the user needs the information to proceed, use a popover or put it in the page, not a tooltip.
- Floating surfaces use the `popover` role and `shadow-lg` (menus, popovers, dialogs, toasts). Dialogs are full width with a 1rem margin below `sm` and `max-w-sm` from `sm` up.
- Toasts: call `toast` from `sonner`; do not mount another `Toaster`.

## Forms

Wrap each control in a `Field` with a `FieldLabel htmlFor`, optional `FieldDescription`, and a `FieldError`. Pass `required` to mark the field: the label shows a `*` (hidden from screen readers) and the control gets `aria-required="true"`; an explicit `aria-required` on the control wins. Pass `invalid` when there is an error: the error shows, and the control gets `aria-invalid="true"` and `aria-describedby` pointing at the description and error. Wiring is a React context the controls read, so it works for a plain `<Input id>`. The description and error register themselves in an effect, so `aria-describedby` appears after hydration, not in the server HTML; outside a `Field` controls behave as before. Sign-in is the reference.

## Pickers

- **Picker vs select:** use `select` for fewer than about 10 fixed options (seniority, sort order). Use `picker` (one value) or `MultiPicker` (several) for value lists: techs, roles, countries, cities, anything long or growing.
- Search is `filterOptions` in `picker-filter.ts`, the only matching rule: it ignores case and accents (`zurich` finds Zürich) and matches `keywords` aliases (`usa` finds United States), lists prefix matches before substring matches, and shows at most 50 matches. Give common aliases and abbreviations as `keywords`.
- Accent folding is NFD only, so letters with no decomposition (ø, ł, æ, ß, đ) do not fold to ASCII. Give such options `keywords` aliases, for example `Copenhagen` with `kobenhavn` (København) or `Łódź` with `Lodz`.
- Keyboard users remove a `MultiPicker` chip with ArrowLeft from the empty search input, which focuses the last chip, then Backspace or Delete, which removes it. Backspace in the empty input also removes the last chip directly.
- The list takes the field's width, scrolls inside a max height, and never exceeds the viewport on phones. Inside a `Field`, the search input gets the same `aria-invalid`, `aria-required` and `aria-describedby` wiring as `input`.

## Layouts

- `AppShell` (`components/layout/app-shell.tsx`) wraps every signed-in page, through the `src/app/(app)/layout.tsx` route group. It has a sidebar and a top bar with the theme toggle and a user menu holding `SignOutButton`. Below `md` the sidebar becomes a slide-out drawer (`Sheet`) opened by the menu button in the top bar. Pages render their content only, with no `<main>` and no `min-h-screen` of their own.
- `FlowLayout` (`components/layout/flow-layout.tsx`) wraps multi-step flows such as setup, through `src/app/(flow)/layout.tsx`. It is a centered column with the logo and the theme toggle, no sidebar. Put a new flow under `(flow)`.
- `/sign-in`, `/auth` and `/design` sit outside both groups.
- The sidebar lists only routes that exist: add an entry to `NAV_ITEMS` in `components/layout/app-nav.tsx` in the same change that adds the page. The current item gets `aria-current="page"`.
- Branding stays 10xjobs (`components/layout/brand.tsx`); never use Supabase's name or logo.
- `sidebar` and `sheet` are in `components/ui`. Use `Sidebar*` parts for navigation chrome (colors come from the `sidebar-*` roles) and `Sheet` for any other side panel.

## Sign-in

`/sign-in` is the reference for an auth screen: the `Brand` mark above a `Card` (`max-w-sm`, centered), a `CardHeader` with the page `h1`, labels above controls through `Field`, the email in an `InputGroup` with a leading `Mail` icon, and a full-width `Button` `size="lg"` that uses `loading` while a request is pending (no start icon on a loading button). Server notices render as `role="status"` text inside the card; field errors stay in `FieldError`. Links in such a card use `TextLink`.

## Adding to the library

If something is missing, add it to `components/ui`: through the shadcn CLI when shadcn has it (`pnpm --filter @xjobs/web exec shadcn add <name>`), restyled onto roles. Then add it to the showcase page and to this guide, and only then use it. Never inline it in a page.

## Responsive

Design desktop-first, then check at 360px wide. Nothing scrolls sideways at that width. Note here any component that changes shape on small screens: dialogs and confirm dialogs go full width with a 1rem margin below `sm`; picker lists are capped at the viewport width.

## Where to look

`/design` shows every token (scales, roles in the current theme with computed contrast, type, radius, shadows) and every component with its variants, sizes and states, plus the theme toggle. It needs no sign-in, is available locally and on Vercel previews, and returns 404 in Vercel production (`VERCEL_ENV === 'production'`). The page is `force-dynamic`, so the check reads Vercel's system environment variables at request time, not at build time.
