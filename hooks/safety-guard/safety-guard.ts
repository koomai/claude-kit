#!/usr/bin/env bun

/**
 * PreToolUse Hook - Safety filter for dangerous commands
 *
 * Exit codes:
 *   0 = Allow tool execution
 *   2 = Block tool execution (stderr shown to Claude)
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // ==========================================================================
  // rm command variations (all recursive forms are dangerous)
  // ==========================================================================
  // rm -rf and -fr variations
  { pattern: /\brm\s+.*-[a-z]*r[a-z]*f/i, message: "Dangerous rm command detected" },
  { pattern: /\brm\s+.*-[a-z]*f[a-z]*r/i, message: "Dangerous rm command detected" },
  { pattern: /\brm\s+--recursive\s+--force/i, message: "Dangerous rm command detected" },
  { pattern: /\brm\s+--force\s+--recursive/i, message: "Dangerous rm command detected" },
  { pattern: /\brm\s+-r\s+.*-f/i, message: "Dangerous rm command detected" },
  { pattern: /\brm\s+-f\s+.*-r/i, message: "Dangerous rm command detected" },
  // rm -r (recursive without force - still dangerous)
  { pattern: /\brm\s+-r\b/i, message: "Recursive rm command detected" },
  { pattern: /\brm\s+--recursive\b/i, message: "Recursive rm command detected" },
  { pattern: /\brm\s+-R\b/, message: "Recursive rm command detected" },

  // ==========================================================================
  // rmdir command (directory removal)
  // ==========================================================================
  { pattern: /\brmdir\b/i, message: "Directory removal command detected" },

  // ==========================================================================
  // find with delete actions (common rm -rf bypass)
  // ==========================================================================
  { pattern: /\bfind\b.*-delete\b/i, message: "Find with delete action detected" },
  { pattern: /\bfind\b.*-exec\s+rm\b/i, message: "Find with rm exec detected" },
  { pattern: /\bfind\b.*-exec\s+rmdir\b/i, message: "Find with rmdir exec detected" },
  { pattern: /\bfind\b.*\|\s*xargs\s+rm\b/i, message: "Find piped to xargs rm detected" },

  // ==========================================================================
  // Trash command (bypasses rm restrictions)
  // ==========================================================================
  { pattern: /\btrash\b/i, message: "Trash command detected" },

  // ==========================================================================
  // mv to /tmp (delete workaround)
  // ==========================================================================
  { pattern: /\bmv\s+.*\s+\/tmp\b/i, message: "Move to /tmp detected (delete workaround)" },

  // ==========================================================================
  // Other recursive/bulk delete patterns
  // ==========================================================================
  { pattern: /\bxargs\s+rm\b/i, message: "xargs rm command detected" },
  { pattern: /\bxargs\s+rmdir\b/i, message: "xargs rmdir command detected" },
  { pattern: /\bperl\b.*\bunlink\b/i, message: "Perl unlink command detected" },
  { pattern: /\bperl\b.*\bremove_tree\b/i, message: "Perl remove_tree command detected" },
  { pattern: /\bperl\b.*\brmtree\b/i, message: "Perl rmtree command detected" },
  { pattern: /\bpython[3]?\b.*\bshutil\.rmtree\b/i, message: "Python rmtree command detected" },
  { pattern: /\bpython[3]?\b.*\bos\.remove\b/i, message: "Python os.remove command detected" },
  { pattern: /\bpython[3]?\b.*\bos\.unlink\b/i, message: "Python os.unlink command detected" },
  { pattern: /\bruby\b.*\bFileUtils\.rm_rf\b/i, message: "Ruby rm_rf command detected" },

  // ==========================================================================
  // Laravel database-wiping commands
  // ==========================================================================
  { pattern: /\bartisan\s+migrate:fresh/i, message: "Database-wiping artisan command detected" },
  { pattern: /\bartisan\s+migrate:refresh/i, message: "Database-wiping artisan command detected" },
  { pattern: /\bartisan\s+migrate:reset/i, message: "Database-wiping artisan command detected" },
  { pattern: /\bartisan\s+db:wipe/i, message: "Database-wiping artisan command detected" },
];

const DANGEROUS_PATHS_WHEN_RECURSIVE: RegExp[] = [
  /\s+\/\s*$/,      // Root directory
  /\s+\/\*/,        // Root with wildcard
  /\s+~/,           // Home directory
  /\s+\$HOME/,      // Home env variable
  /\s+\.\.\//,      // Parent directory
  /\s+\.\s*$/,      // Current directory
  /\s+\*\s*$/,      // Just wildcard
];

const PROTECTED_FILES = {
  pattern: /\.env$/,
  exceptions: [/\.env\.example$/, /\.env\.sample$/, /\.env\.template$/],
};

const ENV_BASH_PATTERNS: RegExp[] = [
  /\bcat\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bless\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bmore\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bhead\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\btail\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bcp\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bmv\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\btouch\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  />\s*.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\bsource\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
  /\.\s+.*\.env\b(?!\.example|\.sample|\.template)/i,
];

// =============================================================================
// TYPES
// =============================================================================

interface ToolInput {
  tool_name: string;
  tool_input: {
    command?: string;
    file_path?: string;
    [key: string]: unknown;
  };
}

// =============================================================================
// FUNCTIONS
// =============================================================================

function block(message: string): never {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

function isProtectedFile(filePath: string): boolean {
  if (!PROTECTED_FILES.pattern.test(filePath)) return false;
  return !PROTECTED_FILES.exceptions.some((ex) => ex.test(filePath));
}

function checkEnvAccessInBash(command: string): boolean {
  return ENV_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

function checkDangerousCommand(command: string): string | null {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();

  // Check dangerous patterns
  for (const { pattern, message } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return message;
  }

  // Check recursive rm with dangerous paths
  if (/\brm\s+.*-[a-z]*r/i.test(normalized)) {
    for (const pathPattern of DANGEROUS_PATHS_WHEN_RECURSIVE) {
      if (pathPattern.test(normalized)) {
        return "Dangerous rm command with sensitive path detected";
      }
    }
  }

  return null;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  try {
    const input: ToolInput = await Bun.stdin.json();
    const { tool_name, tool_input } = input;

    // Check file-based tools for protected file access
    if (["Read", "Edit", "MultiEdit", "Write"].includes(tool_name)) {
      const filePath = tool_input.file_path ?? "";
      if (isProtectedFile(filePath)) {
        block("Access to .env files is prohibited. Use .env.example instead");
      }
    }

    // Check Bash commands
    if (tool_name === "Bash") {
      const command = tool_input.command ?? "";

      // Check .env access
      if (checkEnvAccessInBash(command)) {
        block("Access to .env files is prohibited. Use .env.example instead");
      }

      // Check dangerous commands
      const dangerMessage = checkDangerousCommand(command);
      if (dangerMessage) {
        block(dangerMessage);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0); // Fail open
  }
}

main();
