# Compact instructions for a Solo orchestrator

What a Solo orchestrator session must carry into its summary so orchestration resumes with no re-discovery. Paste before compacting a session that holds agents, todos, timers, or locks.

---

This is a Solo-based orchestrator session. The summary must allow resuming orchestration with zero re-discovery. Sections 1–6 are lookup tables: verbatim and complete, never paraphrased — anything summarized there is destroyed.

1. IDENTITY: my process_id, actor_id, selected project_id/name.
2. PROCESS REGISTRY: every spawned agent/process — process_id, name, task (1 line), status, unread output. A dropped process_id is a lost agent.
3. TODOS: each relevant todo — ID, title, status, blockers, open comments; ALL locks I hold; current focus todo + its very next action.
4. TIMERS: each timer — ID, fires-at (absolute), state, action-on-fire, idle-watch conditions; plus expected notifications and what they match.
5. LOCKS & SCRATCHPADS: each lock_acquire (name/why/release-when); each scratchpad (name, contents, whether source of truth — if so say "re-read before acting on X", don't duplicate).
6. IDENTIFIERS: exact paths, branches, SHAs, PR/issue numbers, URLs, IDs, and command lines known to work (exact flags) or fail (reason).
7. RULINGS: everything the user decided, rejected, or deferred — stated as standing rules; include corrections. No settled question re-litigated.
8. VERIFICATION LEDGER: verified (and how) vs done-but-unverified vs known-broken. "Implemented" never absorbs "verified".
9. IN-FLIGHT HAZARDS: uncommitted/partial changes, shared-state writers, blocking locks/todos held by others, temp files, active workarounds.
