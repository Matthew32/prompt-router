---
name: bootstrap
description: Bootstrap 5 UI conventions — use when building or styling HTML pages, forms, layouts, or components with Bootstrap.
---

# Bootstrap

Guidelines for Bootstrap 5.x front-end work.

## Core rules
- Bootstrap 5 — no jQuery. Use `data-bs-*` attributes or the `bootstrap.*` JS API for components (modals, dropdowns, toasts).
- Prefer utility classes (`d-flex`, `gap-3`, `mt-4`, `text-muted`) over custom CSS; only write custom CSS when utilities genuinely can't express it, and put it in one place, not inline styles.
- Layout with the grid: `container` → `row` → `col-*`. Mobile-first: base class for phones, add `col-md-*`/`col-lg-*` breakpoints upward.

## Components & forms
- Forms: `form-label`, `form-control`/`form-select`, wrap fields in `mb-3`; validation states via `is-invalid` + `invalid-feedback` divs.
- Use semantic components: `btn btn-primary` on real `<button>` elements, `alert` for messages, `card` for panels, `badge` for counts.
- Accessibility: keep `aria-*` attributes the docs show (e.g. `aria-expanded` on collapse toggles, `visually-hidden` labels for icon buttons).

## Customization
- Theme by overriding Sass variables (`$primary`, `$border-radius`) before importing Bootstrap — not by fighting compiled classes with `!important`.
- Dark mode via `data-bs-theme="dark"` attribute, not custom class systems.
