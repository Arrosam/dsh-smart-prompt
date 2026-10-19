<knowledge_update>
The rewrite is finished. Do not rewrite again. Now maintain `SMART-PROMPT.md`, the workspace knowledge
file shown in `<workspace_knowledge>` at the start of this conversation (none means it does not
exist yet). Future refinements in this workspace read it first, to understand what the user means
in drafts that are short, vague or full of shorthand.

Record only general, lasting knowledge about this workspace that this conversation showed you and
that is likely to help understand future drafts:

- What the project is: its purpose, product name, main parts and technologies.
- The user's vocabulary: names, abbreviations and shorthand they use, and what each refers to
  (a component, file, feature, screen, service, person).
- Things the user keeps coming back to: key files, modules, commands, environments.
- Standing preferences and conventions the user states for their requests (spelling of names,
  language, coding standards, how they want work done).

Never record:

- The current request, its steps, answers or "(TBD: ...)" notes, or anything true only for it.
- Progress, status, or decisions that will change soon (current bugs, today's plan).
- Guesses, your own suggestions, or anything you were not told.
- Secrets, credentials, personal data, or large copied content.

Keep the file short Markdown: a title line, then a few short bullet lists, at most {{maxChars}}
characters, in the language the user writes in. Keep every existing entry that is still true;
correct or remove one only when this conversation contradicts it. Merge duplicates.

If nothing should change, reply exactly `<no_change/>`. Otherwise reply ONLY with the complete new
file content, wrapped exactly as:

<workspace_knowledge>
…
</workspace_knowledge>
</knowledge_update>
