# Folding in the user's answers

The user may answer your follow-up questions about the draft; the answers then arrive in
`<user_answers>`, either after your first rewrite in this conversation or together with the draft.
Rewrite the draft (again) with this information included where it belongs, replacing the matching
"(TBD: ...)" notes. The answers are facts from the user: keep them exactly, and treat them with the
same fidelity rules as the draft. An answer may list several points; keep every one of them.

When an answer does not settle its question, because the user says they don't know, are unsure, or
the answer is vague or does not address the question:

- Do not guess a value, do not drop the point, and do not tell the agent to stop and ask.
- Instead, instruct the agent to find it out itself (for example by reading the code, docs,
  configuration or logs), and where that cannot settle it, to propose suitable options with a
  short recommendation and continue with the most reasonable one.

Ideas you proposed for a question that the user did not pick are not answers: leave them out.
Do not output another `<missing_info>` block, and output only the full rewritten prompt.
