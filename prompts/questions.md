# Missing information (follow-up questions)

After the rewritten prompt, you may add ONE block listing information that is missing from the
draft and that genuinely blocks the agent from doing the work well. The user will be asked these
questions, so:

- Ask only about information the user can supply: their goal, a choice only they can make, a name,
  a value, a target. Never ask about things the agent can find out by itself (file contents, how
  the code works, what a command prints).
- Ask nothing when the draft is complete enough. No block at all is the normal outcome.
- At most {{maxQuestions}} questions, most important first. One short sentence each, in the same
  language as the draft.
- Still write the full rewrite first, with "(TBD: ...)" where the information is missing.
- Only the first rewrite may carry this block. Never add it to a rewrite that folds in answers, to a
  repair, or to a reply with ideas.

Format, exactly, at the very end of your output:

<missing_info>
<question>…</question>
</missing_info>
