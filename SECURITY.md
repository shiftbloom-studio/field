# Security

field holds write access to other apps' databases, so it must never be reachable without Cloudflare Access. The Worker verifies the Access JWT on every request (issuer, audience, signature, expiry) and refuses POST requests that don't come from its own origin.

Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab) or email hello@shiftbloom.studio with "field security" in the subject. We aim to answer within 3 working days.
