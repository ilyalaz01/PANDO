# Invite-only owner provisioning

This runbook creates the first human account for PANDO's authenticated `/start` journey. It does
not grant browser or server code privileged database access. The application uses only a public
Supabase publishable key, verified user claims, RLS, and purpose-specific functions in the exposed
`api` schema.

## Safety rules

- Keep the owner password in a password manager. Never put it in Git, `.env` files, seed SQL,
  fixtures, logs, screenshots, command arguments, or chat transcripts.
- Never place an `sb_secret_...` key or a legacy `service_role` JWT in a `NEXT_PUBLIC_` variable.
- Keep `supabase/config.toml` with Data API schemas limited to `api`, global signup disabled, and
  anonymous sign-in disabled. Keep `[auth.email].enable_signup = true`: in the Supabase CLI this
  enables the email/password provider itself, while the global flag enforces invite-only creation.
- Hosted Supabase Auth settings are separate deployment state. Re-check them in the Dashboard;
  changing local `config.toml` does not update a hosted project.

## Local development

1. Start Docker Desktop, then start the ordinary local stack:

   ```shell
   pnpm supabase start
   ```

2. Read the local public connection values without copying them into tracked files:

   ```shell
   pnpm supabase status -o env
   ```

3. Create an untracked `.env.local` from `.env.example`. Set `NEXT_PUBLIC_SUPABASE_URL` to the
   reported API URL. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the reported publishable key;
   if the local CLI reports only `ANON_KEY`, that legacy anon key is the public local equivalent.
   Do not use `SERVICE_ROLE_KEY`.
4. Open local Studio at <http://127.0.0.1:54323>, navigate to Authentication → Users, and create one
   confirmed email/password owner account. Enter the password only in Studio.
5. Run `pnpm dev`, open <http://localhost:3000/sign-in>, and sign in. The first successful sign-in
   invokes the idempotent Identity bootstrap command and creates exactly one personal workspace.
6. Open `/start`, select the seeded Target Profile, reload the resulting URL, and verify the saved
   Readiness Goal is restored rather than duplicated.

Run `pnpm verify:db` after any migration, RLS, auth-query, command, or outbox change. This gate uses
its own random temporary Supabase project and does not reset the ordinary local stack.

Run `pnpm verify:auth` after any session, cookie, redirect, bootstrap, target-selection, generated
database-type, or authenticated UI change. It provisions one synthetic owner with an ephemeral
service-role credential inside its isolated test harness, then verifies the complete journey using
only the public application boundary in the browser. The gate also proves that public signup and
anonymous sign-in stay disabled and that a near-expiry session rotates its cookie through the SSR
proxy. That credential is never passed to application code or browser code, and the temporary stack
is removed when the gate finishes. Interrupts use the same cleanup path; a failed Docker stop keeps
the exact temporary recovery workdir in the reported error instead of hiding the original failure.

## Hosted deployment

1. In the Supabase Dashboard, disable **Allow new users to sign up** and anonymous sign-ins while
   keeping the email/password provider enabled for accounts created by an administrator.
2. In Authentication → Users, use the administrative Add User or invite flow for the owner email.
   Require a confirmed address before first use. Do not distribute a shared account.
3. Configure the hosting environment with only `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Keep secret/service-role credentials out of the web
   application entirely.
4. Apply migrations through the normal reviewed deployment process. Confirm that only the `api`
   schema is exposed by the Data API and that the configured site URL is the exact HTTPS origin.
5. Perform the same sign-in, single-workspace, target-selection, reload, and sign-out smoke test as
   local development. Check that unauthenticated `/start` requests redirect to `/sign-in` and that
   responses carrying refreshed cookies are marked `private, no-store`.

`@supabase/ssr` is currently pinned exactly because its public package is still marked beta. Upgrade
it only as an explicit reviewed dependency outcome with auth cookie, refresh, redirect, and negative
session tests.
