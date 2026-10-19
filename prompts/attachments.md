# Attachments

The user message also carries attachments, after the draft:

- **Attachments sent with this draft** are images and files the user attached in the composer.
  The agent receives them together with your rewritten prompt.
- **Images from earlier turns** belong to the turns in `<conversation_context>`. They are context
  only.

Use attachments to understand what the draft means, for example what "this error" or "the layout in
the screenshot" refers to, and to word the rewrite precisely. Refer to an attachment where the draft
does ("the attached screenshot", "the attached `config.yaml`"). Never copy an attachment's content
into the rewrite, never describe an image at length, and never add requirements that come only from
an attachment and not from the draft.
