# Blind spot discovery

Evaluation and blindspot pass on one feature: what's done well, what could be better, and the unknown unknowns — grounded in the code before any opinion is formed. Ends by interviewing you on the answers that would most change its recommendations, and writes the report to a Solo scratchpad.

Fill the three placeholders before pasting. The bracketed notes are guidance for you, not for the model — delete them.

Adapted from [Thariq's original](https://x.com/trq212/status/2073100352921215386).

---

I want an evaluation and blindspot pass of {{FEATURE}}.

Context about me: {{ABOUT_ME}}

[READ AND DELETE: your role and how deep you are in this area — e.g. "I built
the feed queries myself but the ranking approach was improvised; I've never
shipped a recommendation surface before." Be honest about what you're weak on —
that's what steers the blindspot pass.]

Where I am in my thinking: {{STAGE}}

[READ AND DELETE: stage — "pre-launch polish" / "works but feels
naive" / "about to invest more here". Then what you care about most, pick 2-3:
correctness, ranking/relevance quality, scale, UX, abuse resistance,
maintainability]

First, ground yourself in the territory: read the actual implementation before
forming opinions. When you make a claim about how something works, cite the
file and line. Flag anywhere the code's behavior differs from what my
description implies I believe.

Then give me:

1. What's done well — only things that are genuinely non-obvious or that I
   shouldn't accidentally break later. Skip flattery.

2. What could be better — for each item: what it does now (from the code),
   what the alternative is, and why it matters for MY goals above. Rank by
   impact-to-effort, not by how easy it was to spot.

3. Blindspot pass — my unknown unknowns. Specifically:
   - Questions I should be asking about this feature that I haven't.
   - How products that do this well typically solve it, where my approach
     diverges, and whether that divergence is a problem or fine at my scale.
   - Failure modes that won't show up in dev but will in production
     (empty states, cold start, degenerate data, adversarial users).
   - Anything where the current code quietly commits me to a decision
     that's expensive to reverse later.

4. Interview me — end with the 3-5 questions where my answer would most
   change your recommendations. Distinguish clearly between what you
   verified in code and what you're inferring.

Write the results to a scratchpad.
