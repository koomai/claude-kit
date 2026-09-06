#!/usr/bin/env php
<?php

declare(strict_types=1);

const DEFAULT_LANGUAGE = 'en';

const TRANSLATION_LANGUAGES = [
    'de' => 'German',
    'fr' => 'French',
    'es' => 'Spanish',
    'it' => 'Italian',
    'pt' => 'Portuguese',
    'nl' => 'Dutch',
];

const EXCLUDED_FILES = ['validation.php'];

$lang = $argv[1] ?? null;
$langDir = rtrim($argv[2] ?? './lang', '/');

if (! $lang) {
    fwrite(STDERR, 'Usage: preview-missing-translations.php {' . implode('|', array_keys(TRANSLATION_LANGUAGES)) . "} [lang-dir]\n");
    exit(1);
}

if (! isset(TRANSLATION_LANGUAGES[$lang])) {
    fwrite(STDERR, "Language '{$lang}' is not supported. Available languages: " . implode(', ', array_keys(TRANSLATION_LANGUAGES)) . "\n");
    exit(1);
}

$sourceDir = "{$langDir}/" . DEFAULT_LANGUAGE;

if (! is_dir($sourceDir)) {
    fwrite(STDERR, "Source directory '{$sourceDir}' not found. Pass the lang directory as the second argument.\n");
    exit(1);
}

$missingTranslations = getMissingTranslations($sourceDir, "{$langDir}/{$lang}");

if (empty($missingTranslations)) {
    echo "No missing translations found for {$lang}\n";
    exit(0);
}

echo "Missing translations for {$lang}:\n";

foreach ($missingTranslations as $file => $translations) {
    echo "\n{$file}.php:\n";
    displayTranslationItems($translations);
}

exit(0);

function getMissingTranslations(string $sourceDir, string $targetDir): array
{
    $differences = [];

    foreach (glob($sourceDir . '/*.php') as $sourceFile) {
        $filename = basename($sourceFile);

        if (in_array($filename, EXCLUDED_FILES, true)) {
            continue;
        }

        $fileKey = pathinfo($filename, PATHINFO_FILENAME);
        $targetFile = $targetDir . '/' . $filename;

        if (! file_exists($targetFile)) {
            $differences[$fileKey] = require $sourceFile;

            continue;
        }

        $missingKeys = array_diff_key(require $sourceFile, require $targetFile);

        if (! empty($missingKeys)) {
            $differences[$fileKey] = $missingKeys;
        }
    }

    return $differences;
}

function displayTranslationItems(array $translations, string $indent = '    '): void
{
    foreach ($translations as $key => $value) {
        if (is_array($value)) {
            foreach ($value as $subKey => $subValue) {
                echo "{$indent}'{$subKey}' => '{$subValue}'\n";
            }

            continue;
        }

        echo "{$indent}'{$key}' => '{$value}'\n";
    }
}
