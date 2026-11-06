# Security Policy

## Overview

GTAR Stage Suite (Guitar Tool App Republic) is a web-based Progressive Web App (PWA) for musicians, worship teams, and live performances.

We welcome responsible security vulnerability reports that help protect GTAR users, their song libraries, account information, and application data.

GTAR is an independently maintained community project. Security reports are reviewed on a best-effort basis.

## Supported Versions

Security maintenance is focused on the latest production release of the GTAR Web/PWA application.

| Version / Component | Security Support |
|---|---|
| Latest Web/PWA production release (`main`) | Supported |
| Development builds (`dev`) | Best effort; not intended for production use |
| Older Web/PWA releases | Not officially supported |
| Native Android legacy application | Frozen; no active security maintenance |
| Forks and third-party deployments | Not officially supported |

Users are encouraged to use the latest production version.

## Reporting a Vulnerability

**Please do not publicly disclose security vulnerabilities through GitHub Issues, Discussions, or pull requests.**

To report a suspected vulnerability:

1. Visit the [GTAR Security Advisories](https://github.com/ozzzmond/GTAR/security/advisories).
2. Select **Report a vulnerability**, if available.
3. Provide a clear description of the issue and its potential impact.
4. Include reproduction steps and relevant technical evidence.
5. Allow reasonable time for review and remediation before public disclosure.

If private vulnerability reporting is unavailable, do not publish sensitive exploit details in a public issue.

Reports should include enough information to reproduce and assess the vulnerability without exposing real user credentials or private data.

## Security Scope

Security reports are particularly valuable in the following areas:

- **Authentication and authorization:** Account impersonation, unauthorized access, session handling, and permission bypasses.
- **Cloud data protection:** Unauthorized access to account-scoped song libraries, setlists, backups, or synchronized data.
- **Backup and restore:** Data exposure, unsafe restoration, malicious backup payloads, and unintended data modification.
- **Client-side security:** Cross-site scripting (XSS), unsafe content rendering, and injection vulnerabilities.
- **API and backend security:** Cloudflare Pages Functions, D1 database access controls, input validation, and server-side authorization.
- **Dependency security:** Vulnerabilities in application dependencies that have a demonstrable impact on GTAR.
- **Secrets and configuration:** Accidental exposure of credentials, tokens, or sensitive deployment configuration.
- **Data integrity:** Security weaknesses that allow unauthorized modification, deletion, or corruption of user data.

Security findings should demonstrate a plausible security impact rather than rely solely on automated scanner warnings.

## Responsible Security Research

We appreciate security research conducted responsibly and in good faith.

Researchers should:

- Test only accounts, environments, and data they own or are explicitly authorized to access.
- Avoid accessing, modifying, or deleting another user's information.
- Avoid disrupting application availability or other users' activities.
- Avoid denial-of-service testing, resource exhaustion, or excessive automated requests.
- Avoid social engineering, phishing, or attacks against third-party services.
- Use synthetic or non-sensitive test data whenever possible.
- Stop testing and report the issue privately if unintended access to real user data occurs.

This policy does not grant permission to access third-party systems, bypass applicable laws, or perform disruptive testing.

## Disclosure and Remediation

Security reports will be evaluated according to their severity, reproducibility, and potential impact.

When a vulnerability is confirmed, the maintainer may:

1. Assess the affected components and supported versions.
2. Develop and validate a remediation.
3. Release an appropriate fix through the project's established development and release process.
4. Publish a security advisory when appropriate.
5. Coordinate disclosure with the reporter when practical.

There is no guaranteed response time, remediation deadline, or security service-level agreement.

The project does not currently operate a formal vulnerability bounty or paid security research program.

## Dependency Vulnerabilities

GTAR uses automated dependency monitoring and GitHub security tooling.

A dependency alert does not automatically establish that the deployed application is exploitable.

Findings are evaluated based on:

- Whether the affected dependency is actually used.
- Whether the vulnerable code path is reachable.
- Whether the vulnerability affects production or development-only tooling.
- Whether an upstream security fix is available.
- Whether a safe mitigation can be applied without introducing regressions.

Dependency updates and security fixes are prioritized according to verified risk and compatibility.

## Privacy and User Data

Security researchers must not include actual user credentials, private song libraries, authentication tokens, or personal information in reports unless strictly necessary and explicitly authorized.

Use redacted evidence and synthetic test data wherever possible.

This security policy does not replace the project's Privacy Policy or Terms of Service.

## Maintenance and Support

GTAR is provided as an independently maintained community project.

The maintainer makes reasonable efforts to address confirmed security vulnerabilities but cannot guarantee continuous monitoring, immediate remediation, or uninterrupted availability.

Security fixes are subject to technical feasibility, available resources, and appropriate validation.

## Related Resources

- [GTAR Repository](https://github.com/ozzzmond/GTAR)
- [Security Advisories](https://github.com/ozzzmond/GTAR/security/advisories)
- [GitHub Issues](https://github.com/ozzzmond/GTAR/issues) (non-sensitive bugs and feature requests only)

---

**Thank you for helping keep GTAR and its community safer.**
