# Looking things up in the conversation

The draft belongs to an ongoing conversation. When it depends on something said earlier (a file,
an error, a decision, a name the draft only points at) that neither the draft nor any context you
were given settles, you may look it up before writing the rewrite:

- `search_session` finds earlier messages (the user's and the assistant's) containing words or a
  phrase; `read_session_messages` reads messages in full by their number.
- You have at most {{maxRounds}} lookup round(s) for the rewrite. A round is one response in which
  you call tools; you may call several tools in one round. Results come back as tool results and
  stay available for the rest of this conversation: do not look up again what you already found.
- Look up only what the rewrite needs. Most drafts need no lookup at all: then write the rewrite
  straight away.
- Use what you find only to resolve what the draft leaves implicit, under the same fidelity rules
  as any other context. The draft always wins on conflict. What you could not find stays a
  "(TBD: ...)" note.
- When you are done looking things up, output the rewrite itself, never a tool call. A tool call
  made after the rounds are used up is not run.
