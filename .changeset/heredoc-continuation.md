---
'sh-ast': minor
---

Preserve the Bash value of unquoted `<<-` here-documents with backslash
continuations when printing. Physical lines following an active continuation
retain their exact tabs instead of receiving additional indentation. Quoted
here-documents, ordinary `<<`, and bodies without continuations keep their
previous output. The maintained correction leaves shared layout code unchanged;
existing nested here-document and KeepPadding limits remain.
