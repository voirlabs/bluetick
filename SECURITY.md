# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems.

Report it privately through GitHub:
**Security → Report a vulnerability** on this repository
([docs](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
If you can't use that, email [contact@voirlabs.io](mailto:contact@voirlabs.io) instead.

Include steps to reproduce and the impact you expect. We aim to acknowledge reports within
three business days and will keep you updated until it's resolved.

## Scope

In scope: accepting webhooks without a valid Meta signature, bypassing `ADMIN_PASSWORD` or the
session check, cross-site requests that change data, leaking access tokens or API keys, and
tools in this repository or the examples returning one customer's data to another.

Out of scope: prompt injection that only changes what the agent says to the same customer, and
the login rate limit across multiple serverless instances (documented limitation).

## Supported versions

Only the latest release on `main` receives security fixes.
