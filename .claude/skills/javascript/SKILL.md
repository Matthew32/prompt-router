---
name: javascript
description: Modern JavaScript conventions — use when writing or reviewing JS/ES module code, DOM work, async logic, or fetch-based API calls.
---

# JavaScript

Guidelines for modern JavaScript (browser and Node).

## Language
- ES2022+ modules (`import`/`export`); `const` by default, `let` when reassigned, never `var`.
- `async/await` over `.then()` chains; always handle rejection (try/catch at a meaningful boundary, not around every call).
- Strict equality (`===`), optional chaining (`?.`), nullish coalescing (`??`), destructuring, template literals.
- Small pure functions; avoid classes unless there's real state + behavior to bundle.

## DOM & browser
- `querySelector`/`addEventListener`; delegate events on containers for dynamic lists instead of per-node listeners.
- NEVER build HTML by interpolating untrusted strings — escape them, or use `textContent`/`createElement`. This is an XSS gate, not a style preference.
- `fetch` for HTTP: check `res.ok` before `.json()`, and surface errors to the user, not just the console.

## Quality
- No silent catch blocks. Log or handle.
- Match the project's existing style (semicolons, quotes, indentation) — read a neighboring file before writing.
- Prefer platform APIs over dependencies for small tasks (dates, DOM, fetch); reach for a library only when the platform genuinely lacks it.
