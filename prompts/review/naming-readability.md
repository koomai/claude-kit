# NAR — Naming and Readability

Review the current change for names that mislead, structure that hides intent, and cognitive load a small rename or reshaping would remove.

---

Review the current change — the uncommitted diff and this branch's commits, not the whole codebase — for one thing only: code that misleads or slows its reader.

Look for:
- Names that don't match behavior: a getter that mutates, a check that also saves, a vague manager/helper/util hiding a real domain concept.
- The same concept under different names across files, or two concepts sharing one name.
- Synonyms invented for established domain terms instead of the project's own language.
- Negated or double-negative booleans, and boolean parameters whose meaning requires memorizing the signature.
- Magic numbers or strings with no name.
- Missing or loose types that force the reader to guess what a value is.
- Inconsistent return shapes: sometimes null, sometimes an empty collection, sometimes an exception.
- Comments that restate the code, apologize for it, or have drifted from what it does — the fix is a rename or extraction, not more commentary.
- Functions that mix levels of abstraction, forcing the reader to hold the what and the how at once.
- Deep nesting where guard clauses and early returns would flatten it (happy path last); long expressions that want an explaining variable.
- A class or function in a place or namespace that lies about its layer, or wider visibility than it needs.
- Leftovers from the spike: dead code, unused parameters, commented-out blocks, debug output, TODOs that are already done.

Do not churn names for taste. A rename earns its diff when the current name actively misleads or the concept appears in many places. Match house conventions and sibling code rather than importing a foreign style. Be skeptical of "readability" changes that merely relocate complexity or replace idioms the team already reads fluently.

Trace, don't assume: read each new name cold and say what a reader would conclude from it, then check whether that is what the code does. Ask whether the confusion signals a missing concept to extract and name, not just a bad label.

If a fix is clear, low-risk, and inside the current task's scope, make it and run the relevant checks. Otherwise do not implement it; return a recommendation.

Return:
1. Verdict: `implement`, `recommend`, or `skip`.
2. Confusion: the concrete misleading name or structure, or `none`.
3. Why: what a reader would wrongly conclude, and the bug or slowdown that invites.
4. Scope: the smallest credible change and its blast radius (public API, serialized keys, database columns, translations).
5. Validation: checks run (grep for stale references, tests, static analysis), or the checks that would be needed.
