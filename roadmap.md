# Roadmap

- [ ] Remove sign-up mode from /auth (temporary; will restore later)
- [ ] Audit 17 pending migrations: report applied vs pending (no changes yet)
- [ ] Apply pending migrations one at a time, in filename order, showing SQL and waiting for approval each time
- [ ] After all applied: confirm accounts financial columns accept NULL and metadata columns exist; confirm handle_new_user() no longer seeds personal values
