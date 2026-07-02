---
name: mysql
description: MySQL/MariaDB practices — use when writing SQL, designing schemas, creating migrations, or debugging slow queries.
---

# MySQL

Guidelines for schema design and queries.

## Schema design
- Use `utf8mb4` charset and `utf8mb4_unicode_ci` collation for all tables.
- Every table gets an auto-increment `BIGINT UNSIGNED` primary key (`id`), plus `created_at`/`updated_at` timestamps unless truly append-only.
- Add indexes for every column used in WHERE/JOIN/ORDER BY on large tables; name them `idx_<table>_<cols>`. Foreign keys get `ON DELETE` behavior chosen explicitly — never left to default silently.
- Prefer `DECIMAL` for money, never `FLOAT`/`DOUBLE`.

## Queries
- ALWAYS use parameterized queries / prepared statements — never string-interpolate values into SQL.
- Avoid `SELECT *` in application code; list the columns.
- For slow queries: run `EXPLAIN`, look for full table scans (`type: ALL`) and missing indexes before rewriting.
- Wrap multi-statement writes in transactions; keep transactions short.

## Migrations
- Schema changes go through migrations (Laravel: `php artisan make:migration`), never manual ALTERs against shared databases.
- Migrations must be reversible (`down()` implemented) unless destructive by design — say so in a comment.
