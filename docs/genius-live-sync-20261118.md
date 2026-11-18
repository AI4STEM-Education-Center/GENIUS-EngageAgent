# Live GENIUS class synchronization

## Why the previous adapter was disconnected

Issue #179 explicitly described the experience-check-in provider as unavailable.
The previous adapter implemented an assumed v1 response, but production had no
`GENIUS_CONTEXT_ENDPOINT` or provider. Reading GENIUS production
`genius-platform-main` and its deployed revision confirmed there was no class
profile/check-in model or route. The `genius_redesign_group1` branch has a
lesson-specific `EngageClassPlan` and assessment answers, not the requested
class-wide experience check-in. Its staging workflow is not evidence of production
availability. Previous Education chats and SSO deployment documentation confirmed
that both repositories and the existing production deployment path are accessible.

## Implementation

GENIUS provider PR: https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/pull/93

- Teachers save an optional class profile and configure everyday activities in
  GENIUS **Class information**. Active students answer on their GENIUS class page.
- The provider returns class-wide totals, without student identities or individual
  answers. It checks current teacher role and ownership on every service request.
- The consumer uses `GENIUS_URL` and the existing `SSO_SECRET`, with a distinct,
  action-bound, 60-second JWT. No permanent global bearer token is introduced.
- A GENIUS iframe's authenticated MongoDB class scope connects directly.
  Independent `ea-class-*` workspaces offer **Connect GENIUS class** using only the
  current teacher's owned classes. The teacher must intentionally choose the match.
- Opening a task, returning to it, and each visible minute refresh the source.
  New facts require **Use updated information** before replacing the version used
  for generation. Notes, existing slides, saved materials and public tags are not
  silently rewritten. Generation records retain the accepted source/version.
- A changed/unlinked class invalidates previous context references. GENIUS
  authorization is checked again before using a pinned context for generation.
  Revoked access clears cached data; transient failures retain clearly marked
  last-known information. Public sharing still requires the teacher-reviewed
  summary; demographics are excluded from generation prompts.
- The independent class overview reads the same connected GENIUS profile and
  links to its GENIUS editor. Returning to the page refreshes it. Local profile
  writes are rejected while connected, avoiding an unused second profile.
- Only activities with at least one `did` or `watched` response become reported
  experiences or reported-experience generation evidence. Unanswered, skipped and
  `neither` options are not presented as students' lived experiences. A response
  still contributes once to the class response count.
- Recovery of identical inputs refreshes connection metadata automatically,
  including after DynamoDB returns map keys in a different order. Actual changes
  still require teacher acceptance. Concurrent idempotent cache/snapshot writes
  retry transaction conflicts up to twice instead of misreporting a provider
  outage; other failures retain the existing explicit error/cache behavior.

## Configuration and rollback

The live service is enabled in production when the existing SSO secret is present
and no legacy endpoint override is configured. `GENIUS_CONTEXT_MODE=disabled`
turns off live synchronization; independent classes then use their existing local
data. Development defaults to local data, unless `GENIUS_CONTEXT_MODE=live` is set.
`GENIUS_CONTEXT_ENDPOINT/TOKEN` remain supported only for an explicit legacy v1
provider. Secrets are never sent to the browser or committed.

## Verification

GENIUS: 45 root tests, 62 server tests and production build passed. EngageAgent:
the full regression suite passed (3,028 tests, 38 skipped), including twelve new
live-provider integration tests. Additional API and component tests verify automatic
refresh, connected-class changes and class-overview source consistency. TypeScript, changed-file lint and production
build passed. An existing broad Vitest mock type was narrowed to a callable mock
to resolve the main branch's three TypeScript call errors.

Production acceptance uses existing synthetic QA accounts and the dedicated
GENIUS class; no real student responses are created or modified. GENIUS PR #93
and session-isolation followup #94 deployed successfully; EngageAgent PR #226
reached Amplify deployment 122. Browser checks confirmed optimistic-write conflict
protection, student denial of the teacher API/page, saved student answers after
reload, automatic detection of 0→1 and 1→1 response updates, retained manual
teacher context, and real AI Gallery adaptation followed by a successful save.
Exact release versions and screenshots for the final followup are recorded in the
local acceptance artifact.
