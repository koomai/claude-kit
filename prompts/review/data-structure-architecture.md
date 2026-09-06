# DSA — Data Structure & Architecture

Review the current change for a data structure or organizing model that would materially simplify the code.

Adapted from Aaron Francis's original: https://x.com/aarondfrancis/status/2075349771900899627. Checklist and anti-recommendation list also borrow from his codebase audit prompt: https://x.com/aarondfrancis/status/2088285625946370352 (whole-codebase version in [`../audit-codebase.md`](../audit-codebase.md)).

---

Review the current change — the uncommitted diff and this branch's commits, not the whole codebase — for one thing only: accidental complexity that a better data structure or organizing model would remove.

Look for:
- Scattered booleans or nullable fields that permit invalid combinations and are really a state machine or discriminated union.
- Loose parameters or repeated shape assumptions that are really a typed object or value object (ids, money, ranges, emails passed as primitives).
- Branching spread across files that is really a map, registry, lookup table, enum, or discriminated union.
- Ad hoc state mutations that are really a reducer or command/event model.
- Repeated behavior, ownership, or invariants that want one module boundary — especially state that several places are allowed to write.
- Two fields that must change together, or the same data held in two shapes that must be kept in sync.
- Lifecycle, concurrency, or async state whose representation permits stale or contradictory values.
- The same transformation written more than once, or an ordering of steps that silently matters.
- Magic strings that need a shared definition to stay in step.
- Data validated and re-checked deep inside instead of parsed into a trusted shape once at the boundary.
- A data access pattern that calls for a queue, cache, index, tree, or normalized collection.
- An existing abstraction that no longer earns its indirection — inlining it is a cleanup too.

Do not force an abstraction. Prefer boring code if the current shape is clear, local, and unlikely to grow. Do not recommend a change for stylistic consistency, hypothetical extensibility, minor line-count reduction, or moving existing branching behind a new type. Be skeptical of anything that adds indirection without removing branches, duplicated rules, invalid states, or lifecycle risk.

Trace, don't assume: name the invalid states the current shape allows and the places that would have to change together today.

If a fix is clear, low-risk, and inside the current task's scope, make it and run the relevant checks. Otherwise do not implement it; return a recommendation.

Return:
1. Verdict: `implement`, `recommend`, or `skip`.
2. Opportunity: the concrete data structure or organizing model, or `none`.
3. Why: the complexity it removes and the invalid states it rules out, with file and line evidence.
4. Scope: the smallest credible change and its blast radius (files, behavior, tests).
5. Validation: checks run, or the checks that would be needed.
