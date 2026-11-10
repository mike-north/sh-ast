# Security policy

## Supported versions

Security fixes are made to the latest `0.x` minor release of `sh-ast`. Older
minor releases do not receive fixes; please upgrade to the latest release.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub private vulnerability
reporting: open the repository's **Security** tab and choose **Report a
vulnerability**. Do not open a public issue or pull request for a suspected
vulnerability.

Include the `sh-ast` version, the Node.js version, a minimal input that
reproduces the problem, and what you observed.

## What counts as a security issue

`sh-ast` parses and prints shell source text; it never executes it. We treat
these as security issues:

- Untrusted input that crashes the host Node.js process, including aborting the
  embedded WebAssembly runtime.
- Untrusted input that makes parsing, printing or walking hang or consume
  unbounded CPU time or memory.
- Memory-safety or sandbox-escape problems in the WebAssembly module or its
  JavaScript loader.
- Output that differs from the input's actual structure in a way that could
  mislead a security tool built on the syntax tree.

Ordinary parse errors on malformed input, and parser differences from a given
shell's own behavior, are regular bugs; please file them as public issues.

Vulnerabilities in the upstream parser (https://github.com/mvdan/sh) are best
reported to that project as well; tell us too if `sh-ast` is affected.

## What to expect

This is a volunteer-maintained project. We will acknowledge a report, assess it,
and keep you informed of progress. We will credit reporters in the release notes
unless you prefer otherwise. Please allow us a reasonable period to publish a fix
before disclosing details publicly.
