# Security Policy

## Supported Versions

Only the latest published npm release (and matching git default branch) is supported for security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately (for example via GitHub Security Advisories on this repository, or another private channel to the maintainer) and include:

- affected package version or commit
- environment (OS, Node.js, MCP client)
- reproduction steps
- observed impact

You should receive an acknowledgment when possible. Coordinated disclosure is preferred.

## Scope notes

This project coordinates multi-session claims and optional HTTP access. Auth bypass on HTTP mode, claim bypass, and cross-project data leakage are high priority.

## Safe defaults

- Prefer least privilege and explicit allowlists where the project provides them
- Do not commit secrets, tokens, or machine-specific credentials
- Treat local MCP servers as running with the privileges of the OS user that starts them
