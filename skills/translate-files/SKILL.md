---
name: translate-files
description: >-
  Translate missing keys in lang/ PHP files from English into the supported languages (de, fr, es,
  it, pt, nl). Use when the user asks to translate language files, fill missing translations, or
  update lang/ files. Uses the bundled `scripts/preview-missing-translations.php` script to identify
  missing keys, then writes translations directly — preserving placeholders, pluralization, HTML,
  and the do-not-translate term list.
---

# Translate Language Files

Fill in missing translations across the supported languages in `lang/`.

## Source of Truth

- `lang/en/` is the canonical source. Every other supported language must mirror its keys.
- Supported target languages (from `TRANSLATION_LANGUAGES` in `scripts/preview-missing-translations.php`):
  - `de` — German
  - `fr` — French
  - `es` — Spanish
  - `it` — Italian
  - `pt` — Portuguese
  - `nl` — Dutch

If a new language directory appears in `lang/` that isn't in the list above, stop and ask — do not invent translations for unsupported codes.

## Workflow

For each target language, in order (`de`, `fr`, `es`, `it`, `pt`, `nl`):

1. **Discover missing keys** — run the bundled script from the project root:
   ```
   php {skill-dir}/scripts/preview-missing-translations.php {lang} [lang-dir]
   ```
   `lang-dir` defaults to `./lang`. Trust this output. Do NOT grep or diff the files yourself — the script already does the comparison and respects the same exclusion rules (e.g. it skips `validation.php`).

2. **If output says "No missing translations found for {lang}"** — move to the next language.

3. **Group keys by file** — the preview output is organised by file (e.g. `dashboard.php:`, `edit.php:`). Translate one file at a time.

4. **Read the existing target file first** — open `lang/{lang}/{file}.php` to see existing translations and match style/tone. If the file doesn't exist, create it yourself with the standard header — the preview script only reports, it never writes.

5. **Translate the missing keys** — apply the rules in the next section. Add new keys to the existing array; do not rewrite or reorder existing entries.

6. **Repeat** for every file in the preview output, then move to the next language.

7. **Verify** — re-run the preview script after finishing a language. Output should be "No missing translations found for {lang}".

## Translation Rules

### Preserve exactly (never translate or reformat)

- **Laravel placeholders**: `:name`, `:count`, `:address`, `:score`, etc. Keep the colon and identifier identical.
- **Pluralization separator**: the `|` character and its surrounding count rules. Translate each side independently:
  - `:count new message|:count new messages` → `:count neue Nachricht|:count neue Nachrichten`
- **HTML tags and attributes**: `<strong>`, `<a href="...">`, `<br>`, etc. Keep the markup; translate only the visible text inside.
- **Markdown / formatting characters**: `*`, `_`, backticks, leading `+ `, trailing `?` / `!`.
- **Numbers, dates, currency symbols, URLs, email addresses**.
- **Apostrophes inside values** — escape with a backslash so the PHP file stays valid: `'Don\'t do this'`. Match the quote style of the existing file.

### Do Not Translate (DNT) terms

Brand and product names must survive translation verbatim. Read `references/brand-terms.md` before translating anything and keep every term in it exactly as written, even when the surrounding sentence is translated. If a term looks like a brand or product name but is not in that file, stop and ask.

`references/brand-terms.md` is a fill-in-the-blanks starting point. Replace the placeholders with the product's real terms before first use.

### Tone & style

- Match the tone already established in the corresponding `lang/{lang}/` files. Read a few sibling entries before translating.
- Use the formal/informal register the existing translations use (e.g. German files use both — match what's already there for that file).
- Keep translations concise; UI strings often need to fit constrained spaces.

## Script Caveat

The preview script `require`s lang files directly without booting Laravel. Lang files are plain `return [...]` arrays so this is normally fine, but a file that calls framework helpers (`env()`, `config()`, `trans()`) will fatal — if that happens, diff that one file by hand and report it.

## File Format

PHP translation files look like this:

```php
<?php

return [
    'key' => 'value',
    'another_key' => 'another value',
];
```

Some `lang/en/` files start with `declare(strict_types=1);` — translated files do **not** need this; match the existing target file's header.

When adding new keys to an existing file, insert them inside the `return [ ... ]` array. Preserve trailing commas and indentation (4 spaces).

## What This Skill Does NOT Cover

- **`lang/{lang}.json` files** — those are populated from `__('English string')` calls and use a different workflow. This skill only handles the PHP files in `lang/{lang}/*.php`.
- **`validation.php`** — the preview script intentionally excludes it; do not touch it.
- **Creating new English keys** — this skill assumes `lang/en/` is already up to date. If the user wants to add a new English string, that's a different task.

## Pre-Flight Checklist

Before starting:
- [ ] Confirm the user hasn't extended the supported language list beyond `de, fr, es, it, pt, nl`.
- [ ] Read `references/brand-terms.md` for the DNT terms.

## Per-Language Checklist

For each language:
- [ ] Run `php {skill-dir}/scripts/preview-missing-translations.php {lang}` and capture the output.
- [ ] Translate every missing key listed in the preview, file by file.
- [ ] Preserve placeholders, pluralization, HTML, and DNT terms.
- [ ] Run `php -l path/to/filename` to validate there are no syntax errors and fix if any, e.g. `php -l lang/en/changelog.php`
- [ ] Re-run the preview command — confirm it reports no missing translations.
- [ ] Move to the next language.
