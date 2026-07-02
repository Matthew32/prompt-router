---
name: php
description: Modern PHP conventions — use when writing, reviewing, or debugging PHP code (8.x syntax, typing, Composer, PSR standards, error handling).
---

# PHP

Guidelines for working with PHP in this project.

## Conventions
- Target PHP 8.2+: use constructor property promotion, readonly properties, enums, match expressions, named arguments, first-class callable syntax, and nullsafe operator (`?->`).
- Always declare `strict_types=1` at the top of new files and add parameter/return type hints everywhere.
- Follow PSR-12 coding style and PSR-4 autoloading. Class per file, StudlyCaps classes, camelCase methods.
- Prefer Composer packages over hand-rolled solutions; check `composer.json` before adding a dependency that may already exist.

## Error handling
- Throw typed exceptions; never suppress with `@`. Catch narrowly, not `\Throwable`, unless at a top-level boundary.
- Validate and sanitize ALL external input (request params, file uploads, env). Never interpolate user input into SQL, shell commands, or HTML.

## Workflow
- Run `composer install` after pulling; run tests with `./vendor/bin/phpunit` (or `php artisan test` in Laravel projects).
- Use `php -l <file>` to lint syntax after editing a file when no test covers it.
