# ADR-0001 — Runtime, hosting, and toolchain

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

PANDO is an authenticated responsive web application with a client-heavy graph, deterministic server calculations, browser file upload, and one current user. The monthly infrastructure ceiling is USD 10. SEO and public server rendering are not product requirements, but a single TypeScript codebase and a portable server boundary reduce delivery risk.

## Decision

- Use Next.js 16 App Router, React, and strict TypeScript.
- Use Node.js 24 LTS and pnpm 11. Commit the pnpm lockfile and pin the package manager in package.json.
- Build one modular-monolith package. Do not introduce a monorepo or a separately deployed backend in Phase 0.
- Deploy the personal non-commercial application on Vercel Hobby.
- Use Supabase Free for Postgres, Auth, private Storage, Data API, and Cron.
- Use Cloudflare R2 Standard only as the off-site destination for encrypted database dumps and storage manifests. It is not a runtime dependency or primary object store.
- Keep server code portable: no product invariant may depend on a Vercel-only API. Route handlers and application services must run on a standard Node server.
- Use Tailwind CSS with CSS variables and repository-owned accessible primitives based on Radix/shadcn patterns. Do not add a global state library until a measured feature needs it.
- Use ESLint, Prettier, strict TypeScript, Vitest, fast-check, Playwright, Testing Library, pgTAP, and axe integration.

## Alternatives considered

- Vite SPA plus Fastify on Railway: operationally strong and gives a persistent worker, but spends at least half the monthly budget before usage requires it.
- Vite SPA plus Supabase Edge Functions: zero cost, but introduces a second Deno runtime and tighter CPU constraints for validation and calculations.
- Self-hosted VPS: portable but makes patching, TLS, Auth, monitoring, backup, and recovery the solo owner's responsibility.
- Microservices: rejected by the canonical architecture.

## Consequences

- The current recurring platform cost can remain USD 0 while Vercel, Supabase, GitHub, and R2 usage stays inside their free allowances.
- Vercel Hobby is suitable only while usage is personal and non-commercial.
- Background work must be small, resumable, and invoked by an external durable wake-up.
- Next.js conventions are an implementation shell, not a domain boundary. Modules cannot import framework objects into domain logic.

## Security and privacy

- Secrets exist only in environment variables or provider secret stores, never in browser bundles or Git.
- Preview deployments must not point at production data by default.
- Logs use structured redaction and never include evidence notes, uploaded pack bodies, access tokens, or secrets.
- Backups are encrypted before leaving the backup runner. R2 credentials cannot decrypt their contents, and the decryption key is not stored with the objects.

## Migration and rollback

The application can move to Railway, Fly.io, a container host, or a VPS by running the same Node build and changing environment adapters. Move to a persistent Node service when measured jobs cannot fit the serverless handler budget, p95 projection catch-up exceeds 30 seconds, or commercial use invalidates Hobby terms. Supabase remains independently replaceable through SQL migrations, standard dumps, and adapter boundaries. R2 backups use the S3-compatible boundary and can move without changing application code.
