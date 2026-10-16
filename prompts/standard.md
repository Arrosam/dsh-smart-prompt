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
- Every added line must be traceable to something the draft states or plainly implies.
- Put anything you could not determine into a short explicit "(TBD: ...)" note instead of
  inventing it, and keep such notes to what genuinely blocks work.
