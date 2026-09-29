# Security notes

- Never commit X cookies, browser storage state, passwords, or `.env` files.
- The scheduled collector accepts credentials only through the `X_COOKIES` GitHub Actions secret.
- Cookie parsing allow-lists `auth_token`, `ct0`, and optional `twid`; unrelated cookies are discarded.
- The collector does not post, like, follow, message, solve challenges, rotate identities, or bypass rate limits.
- Generated data is public metadata intended for a static GitHub Pages dashboard.
- Delete the Actions secret and revoke the X session when monitoring ends.

This is a research proof of concept, not a guarantee of complete X coverage or production security.
