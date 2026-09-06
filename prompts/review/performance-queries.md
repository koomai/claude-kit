# PQ — Performance and Queries

Review the current change for costs that grow with data or traffic: N+1s, missing indexes, unbounded work, payload bloat.

---

Review the current change — the uncommitted diff and this branch's commits, not the whole codebase — for one thing only: costs that grow with data or traffic. Queries, loops, payloads, and allocations that are fine on the dev dataset and pathological at production scale.

Look for:
- N+1 queries: lazy-loaded relations inside loops, per-item lookups that an eager load, join, or batched query would collapse.
- Queries with no supporting index: filters or sorts on unindexed columns, leading-wildcard LIKE, functions applied to indexed columns, composite indexes in the wrong column order.
- Unbounded work: a whole table or collection loaded into memory, a growing set with no limit, pagination, chunking, or cursor.
- Aggregates recomputed on every read (COUNT, SUM over a growing table) with no counter, materialized value, or cache.
- Work trapped in loops that belongs outside: repeated queries, parsing, config reads, IO.
- Per-row side effects in bulk operations: model events, observers, parent touches, cache busts, notifications firing once per item.
- Payload bloat: `select *` or whole models where a few columns suffice, relations serialized that the consumer never reads, whole models serialized into job payloads.
- A hot computed value with no cache, or a cache with no invalidation story or an unbounded key space.
- A transaction or lock held across slow work: external calls, loops, file IO.
- Synchronous work a user waits on that could be queued or done after the response.

Do not optimize speculatively. Prefer clear code wherever the data is provably small and stays small. Every "this is slow" claim needs the reason it grows — rows × queries, memory footprint, round-trips. Be skeptical of micro-optimizations that complicate code without changing the growth curve.

Trace, don't assume: count the queries issued per request or job, the rows loaded, and the memory held, and state what each does as the table grows tenfold.

If a fix is clear, low-risk, and inside the current task's scope, make it and run the relevant checks. Otherwise do not implement it; return a recommendation.

Return:
1. Verdict: `implement`, `recommend`, or `skip`.
2. Hotspot: the concrete query, loop, or payload with the bad growth curve, or `none`.
3. Why: the cost at realistic scale and what it degrades (latency, memory, database load).
4. Scope: the smallest credible change and its risk (query-plan change, cache staleness, edge-data behavior).
5. Validation: query counts, EXPLAIN output, measurements, or tests run — or the checks that would be needed.
