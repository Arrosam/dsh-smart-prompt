# Mode: standard (restate so an agent can execute it)

Goal: the same request, restated so an autonomous coding agent can act on it without guessing.
Sharpen what is already there — add nothing that is not.

Apply only the moves this draft actually needs; skip the rest:
- **Deliverable** — say concretely what the finished artifact is (a file, a function, a fix, an
  answer), when the draft implies one.
- **Scope and constraints** — make implied boundaries explicit: what must not change, what must
  keep working, which files or areas are in play when the draft names them.
- **Steps** — when the request bundles several things, split it into short numbered steps.
- **Output format** — state the expected shape (language, format, length) only when the draft
  implies one.
- **Acceptance** — state how the result will be judged correct, when the draft implies it.

Rules:
- Section headings are optional. Use structure only when the draft carries enough substance to
  warrant it. A one-line request must not be padded into a specification.
- Every added line must be traceable to something the draft states or plainly implies, or be a
  guess listed under "Follow-up rounds" below.
- Gaps are asked one at a time, never left as TBD. Count as a gap only what genuinely blocks the
  work, and sort each gap before writing anything about it:
  - **The agent can settle it itself** (by reading code, docs, configuration or logs, or by
    running an existing command): write it as a step — what to look up, where, and what result
    counts as settled. Never ask about it and never guess it.
  - **Only the user can decide it** (their goal, a choice between options, a value, a name, a
    target): it must be asked, as described under "Follow-up rounds" below.
- Never write "TBD", "(TBD: …)" or any other placeholder note in the rewrite. In this mode these
  rules replace the "(TBD: ...)" notes of the discipline, missing-information and answers rules.

## Follow-up rounds

These rules override the missing-information rules and the answers rules wherever they differ.

- Every message from the user ends with a `<follow_up_status>` note saying whether you may still
  ask and how many questions are left. Follow it.
- **While you may ask:** ask at most ONE question per reply — the most important gap only the
  user can decide — in the `<missing_info>` block of the missing-information rules. In this mode,
  ask whenever such a gap exists; that overrides "no block is the normal outcome". Leave the other
  gaps for later rounds.
- **A rewrite that folds in the user's answers may ask again**, under the same note — one question
  per reply, until nothing the user must decide is missing. This overrides "only the first rewrite
  may carry this block" and "do not output another `<missing_info>` block". An answer that does not
  settle its question (the user does not know, is unsure, or answers vaguely) may be asked about
  again, more precisely, while questions are left.
- While asking, still write the full rewrite with everything known so far. Where a gap still to be
  asked applies, keep the wording general; never mark it with a placeholder.
- **When asking has ended** — the question limit is reached, the user skipped the questions, or
  questions cannot be asked for this request; the note says which — output no `<missing_info>`
  block. Fill every remaining gap that only the user could have decided with your best guess: the
  most reasonable value given the draft, its context and the user's answers, written directly where
  it applies, as concrete as any other detail.
- **List every guess under the rewrite**: end the output with a section headed in the draft's
  language (English `## Guessed details`, 中文 `## 猜测补充`), one bullet per guess saying where it
  applies (the step or part of the request) and what was guessed. Put nothing else in that section,
  and leave it out when nothing was guessed. It is added even when the rest of the rewrite has no
  headings.
- Guess only when asking has ended. Never guess while a question may still be asked.
