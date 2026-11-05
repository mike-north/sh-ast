---
'sh-ast': minor
---

Preserve literal vertical tabs and form feeds when printing quoted strings, unquoted words, here-document bodies and delimiters, and embedded comment text. These bytes previously became spaces or newlines, changing shell values and sometimes exposing comment text as commands. Written ANSI-C escapes retain their existing spelling. mvdan/sh remains pinned to v3.13.1 with a maintained printer correction; no API shape changes.

Escape VT/FF individually in literals without horizontal tabs so physical newlines still align subsequent comments. Horizontal tabs retain their upstream whole-literal escaping and multiline alignment limit. The deprecated `KeepPadding` option retains upstream's counter behavior, including shrinking padding around protected bytes; ordinary and HT-only output remains byte-identical to the base.

Nested `<<-` documents inside an outer `<<-` command substitution retain a known writer limit: VT/FF body values can still change, and malformed nested delimiters can become body data or make Bash reject the printed program. These nested cases are not covered by the byte-preservation correction.

Minify's retained-shebang path also retains upstream's VT/FF transformation; an embedded form feed can still expose following shebang comment text as code. Conservative caller guards remain justified for these unsupported cases.
