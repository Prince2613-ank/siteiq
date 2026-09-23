# ADR-0005: Self-Managed JWT Authentication Over an Auth-as-a-Service Provider

## Status
Accepted

## Context
SiteIQ needs authentication and three fixed roles (Administrator, Analyst, Viewer) for an internal team of roughly 5–20 users, with admin-driven invitations (no public self-registration) and standard password-reset support.

## Decision
Implement authentication in-house: bcrypt-hashed passwords, short-lived JWT access tokens plus rotating httpOnly refresh tokens, admin-issued invitations, and a standard email-based password-reset flow — rather than adopting a third-party identity provider (Auth0, Clerk, AWS Cognito).

## Consequences
- Positive: zero recurring third-party cost and no external dependency for a genuinely small problem (login + 3 roles, no SSO requirement today).
- Positive: full control over the exact invitation/reset lifecycle the client specified (§6.2 of the technical discovery package).
- Negative: the project now owns getting password-reset security, brute-force protection on `/auth/*`, and token handling correctness right, rather than delegating that to a vendor whose whole job is getting it right.
- Revisit if: the client wants SSO (Google Workspace/Microsoft), self-serve multi-organization signup, or the user base grows well past "small internal team" — at that point an IdP's added cost is easily justified by what it removes from the project's own security surface.
