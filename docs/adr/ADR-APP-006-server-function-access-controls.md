# ADR-APP-006 — Server-function access controls and input limits

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Amir (product owner), implementation agent
- **Money-adjacent:** No — security and provider-cost controls only
- **Serves:** ADR-APP-001, AIOS-SEC-003, AIOS-SEC-007

## Context

The application already attaches a signed-in user's Supabase bearer token to
TanStack Start server-function RPC calls. However, server functions that call
market-data, RSS, calendar, and AI providers did not enforce that token or
validate payload size. They could be invoked outside authenticated UI routes.

## Decision

1. Apply `requireSupabaseAuth` to every existing server function that calls an
   external data or AI provider.
2. Validate symbols, calendar windows, chat message count, individual-message
   length, aggregate chat length, and system-message ordering at the server
   boundary with Zod.
3. Track `.env` files locally only and commit a redacted `.env.example` instead.

## Consequences

Unauthenticated requests fail before any provider call. Oversized or malformed
requests fail before any provider call. This does not implement durable,
distributed rate limiting; that remains the next security hardening item.
