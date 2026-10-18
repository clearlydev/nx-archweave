# Security policy

## Supported versions

Security fixes go into the latest release. nx-archweave is pre-1.0, so a fix ships as a new `0.x` version. Older versions don't get backports.

## Reporting a vulnerability

Please don't open a public issue. Instead, report the vulnerability privately through [GitHub's security advisories](https://github.com/clearlydev/nx-archweave/security/advisories/new). Include:

- the affected package (`create-nx-archweave` or `@clearlydev/nx-archweave`)
- the version
- the steps to reproduce

You should get a first reply within a week. Once a fix is released, we publish the advisory and credit you as the reporter, unless you'd rather not be credited.

## Scope

In scope:

- the two published packages, `create-nx-archweave` and `@clearlydev/nx-archweave`
- the files those two packages generate, including the AI PR review workflows, which handle repository secrets

Out of scope: vulnerabilities in Nx, in the AI tools nx-archweave integrates with, or in other dependencies. Please report those to the project in question.
