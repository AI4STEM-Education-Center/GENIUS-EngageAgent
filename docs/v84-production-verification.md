# v8.4 production verification — November 3, 2026

Candidate: [PR #191](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/pull/191), addressing #179 and #181.
Production: https://engageagent.ai4genius.org, embedded by https://learn.ai4genius.org.

## Current result

**Production acceptance is pending.** The production root, teacher and student
entry pages returned HTTP 200. Nine protected API probes, including missing and
invalid authentication, returned HTTP 401. Both new Gallery routes returned HTTP
404: the live service does not yet expose this candidate's Gallery implementation.
These probes were read-only and did not create classroom data or provider jobs.
The public frame policy allows the canonical GENIUS origin.

The dedicated in-app browser initially had no GENIUS or AWS session. With the
user's authorization, a new synthetic QA teacher was registered through GENIUS;
fresh SSO and creation of an isolated EngageAgent class succeeded against HTTPS.
AWS access is still unavailable. The actual Amplify deployment SHA, runtime IAM,
model overrides, and complete teacher/student material workflows remain to be
verified. GitHub Pages checks are unrelated to this Amplify application.

## Problems found and corrected before release

- Unpublished Gallery video copies had expiring URLs without a renewal path.
  A teacher/task-scoped copy receipt now allows renewal on restoration, periodic
  refresh and return to the tab, even after the original template is withdrawn.
  Regenerated task media takes precedence over original template assets.
- Student polling replaced video `src` whenever a signature changed, interrupting
  playback. Matching media resources retain their current URL until shortly
  before expiry. Genuine resource/version changes still update immediately.
- A signer credential can expire earlier than the URL's nominal lifetime.
  Video errors now adopt an already-received fresh URL, or recover on the next
  normal poll, without repeatedly retrying failed URLs or losing a prediction.
- A saved-media refresh could overwrite a newly selected image history version
  while its debounced save was pending. Renewal now checks the underlying media
  resource as well as in-flight local changes before updating a history slot.
- A production override could retain the retired `gpt-image-1` model after the
  code default changed. Production preflight now rejects that explicit override;
  set `OPENAI_IMAGE_MODEL=gpt-image-2` or remove the override before deployment.

## Automated verification

The candidate is tested using Node 22.23.4, matching Amplify's Node 22 major
version, with the committed lockfile: **1,471 tests passed across 127 files**;
25 opt-in tests skipped. TypeScript and the optimized Next.js production build
passed. ESLint reported zero errors and 16 existing warnings; whitespace
validation passed. The production build also started successfully and returned
200 for the entry page and 401 for unauthenticated protected/new Gallery routes.

In the isolated in-app browser, a synthetic 45-second H.264 video played through
to the end across normal 15-second content polling, with an unchanged video URL,
no media error, and the committed prediction preserved. This checks actual
browser media playback using local signed links, not production S3 permissions.

Regression coverage includes cross-teacher/task and student denial, expired
copy links, copies surviving withdrawal, regenerated-media precedence, playback
stability across polling, genuine media changes, early URL failure recovery,
prediction persistence, and invalid production configuration. AWS adapters are
tested with mocks; those tests do not establish permissions on the live resources.
The 25 opt-in live tests remain skipped without their integration credentials.

## Required production checks

Use the existing Amplify application connected to `main`. Record its exact
previous deployed SHA and successful deployment before changing the release;
retain that deployment as the rollback target. No new table, index or secret is
required. Do not enable local storage in production.

1. Confirm preflight/build/deploy logs and the actual deployed SHA. Verify the
   configured model is available. A successful local build does not read the
   actual Amplify environment.
2. Confirm the runtime identity can read/write the existing table and query the
   Gallery/copy partition keys, including `MATERIAL_GALLERY#v1` and
   `GALLERY_COPIES#...`. An IAM policy restricted to `CLASS#...` is insufficient.
   DynamoDB transactional writes require the corresponding item permissions.
3. Confirm private S3 GetObject/PutObject for `material-gallery/*`, GetObject for
   copied `media/*` sources, and applicable KMS access. Keep committed Gallery
   assets and copied assets out of temporary-file expiration rules. Withdrawal
   preserves copy access. Check top-level `expiresAt` TTL for abandoned staging
   records; committed sources must not retain staging TTLs.
4. Use dedicated teacher/student test identities and a synthetic QA task. Verify
   all four strategies, generation, one-slide revision/Undo, download and actual
   signed S3 reads. Exercise near-limit image uploads through Amplify ingress.
5. Share a clearly labelled synthetic QA template; preview, copy and adapt it in
   another test task. Confirm the original remains unchanged. Restore an
   unpublished video after link expiry, and verify a regenerated asset and a
   selected image version are retained. Cross-account/task requests must fail.
6. Through a real GENIUS student launch, verify prediction gating and refresh,
   video playback across multiple content polls, question/rating persistence,
   completion/reopen events, and narrow-screen layout.
7. Withdraw only the QA templates owned by the test teacher after acceptance.
   Gallery is global: a private QA class alone does not hide shared templates.
   Do not delete shared asset objects because existing copies still depend on
   them. Record results and evidence before declaring production acceptance.

If verification fails after deployment, redeploy the recorded previous Amplify
release, preserve application records, and confirm its HTTPS entry and protected
APIs recover. Do not use a GitHub merge or a green Pages job as deployment proof.
