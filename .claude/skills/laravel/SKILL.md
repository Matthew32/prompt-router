---
name: laravel
description: Laravel framework conventions — use when building controllers, models, migrations, routes, jobs, Blade views, or any Laravel app code.
---

# Laravel

Conventions for Laravel work (assume Laravel 11+ unless composer.json says otherwise).

## Structure & idiom
- Use artisan generators (`php artisan make:model -mfc`, `make:controller`, `make:request`) instead of creating files by hand — they wire namespaces and paths correctly.
- Thin controllers: validation in FormRequest classes, business logic in Actions/Services, queries in Eloquent scopes. No SQL in controllers.
- Eloquent over raw queries; eager-load relations (`with()`) to avoid N+1 — check with `->count()` of queries when debugging performance.
- Route model binding over manual `findOrFail`. Named routes; never hard-code URLs in views (`route('...')`).
- Use policies/gates for authorization, not inline role checks scattered through controllers.

## Data & validation
- Mass-assignment: define `$fillable` on every model; never blanket `$guarded = []` in production code.
- Validate everything through FormRequests; return validated data with `$request->validated()`.
- Casts (`casts()` method / `$casts`) for dates, enums, JSON columns.

## Frontend & assets
- Blade components (`<x-...>`) for reusable UI; keep logic out of views — use view composers or computed props.
- Assets build through Vite (`npm run dev` / `npm run build`).

## Testing & workflow
- `php artisan test` for tests; feature tests over unit tests for HTTP behavior. Use `RefreshDatabase` trait.
- After changing routes/config/env: `php artisan optimize:clear` if behavior looks stale.
- Queue heavy work (mail, exports) via jobs; never block a request on slow I/O.
