# Standalone EngageAgent

## Entry and identity

The production entry is `https://engageagent.ai4genius.org/`. GENIUS authenticates
the user; EngageAgent owns the teacher/student workspace and its class/task data.
No GENIUS Gallery item or GENIUS assignment is required for this entry.

1. `/api/auth/start` creates a 10-minute HttpOnly login cookie containing state,
   nonce and a random PKCE verifier. It redirects to GENIUS authorization.
2. GENIUS uses its existing authenticated session, or its existing login/signup
   pages, and returns a 60-second, single-use authorization code.
3. `/api/auth/callback` verifies state, exchanges the code server-to-server using
   PKCE S256, then verifies the signed identity token's issuer, audience, expiry,
   nonce, role and GENIUS ID.
4. EngageAgent creates its own signed, HttpOnly, host-only, SameSite=Lax session
   cookie for eight hours. Its signing key is domain-separated from SSO_SECRET;
   its issuer is EngageAgent, not GENIUS.
5. Teachers return to `/teacher/classes`; students and guests return to
   `/student/classes`. Logout clears the EngageAgent session, not GENIUS SSO.

Existing `?sso_token=` iframe launches still verify their GENIUS class/assignment
context and open the original workflow. An iframe's context is not converted
into permission to edit independent classes. Development mock identities cannot
access the independent workspace API and are disabled in the production client.

## Class and task storage

Independent classes and enrollments use the existing DynamoDB table under
`WORKSPACE#`, `WORKSPACE_USER#` and `WORKSPACE_JOIN#` key namespaces. Class
creation and enrollment use transactional writes. No existing GENIUS class,
learning task, question bank or student response is migrated, deleted or changed.

Teachers create their own classes and tasks in EngageAgent. Students join using
a class code. Selecting a task provides real stored class/task IDs to the existing
TeacherView or StudentView. New IDs start with `ea-class-` and `ea-task-`.

Native class APIs check authenticated membership and task ownership. Only the
owning teacher can publish or generate class content. Students can read and
submit only their own responses to the published lesson. Native class data is
excluded from anonymous legacy exports and community media results. Test-student
auto-answering is unavailable for native classes.

Class ownership does not alter the separate shared lesson question-bank policy.
Unmerged manual-question work (#26) is not part of this change.

## Configuration and release

Production defaults are the existing EngageAgent and GENIUS HTTPS domains.
`SSO_SECRET` must already match GENIUS; `DYNAMODB_TABLE` and the existing AWS
region/credentials or execution-role permissions are reused. Production refuses
to fall back to ephemeral filesystem class storage.

For isolated local tests only, set `ENGAGE_APP_URL`, `GENIUS_URL` and optionally
`ENGAGE_LOCAL_DATA_DIR`. The GENIUS provider must explicitly allow that callback
with `ENGAGE_SSO_REDIRECT_URIS`. Never allow arbitrary callback URLs or production
credentials in local fixture servers.

Release the companion GENIUS authorization endpoint and login redirect changes
first. Confirm provider deployment, then deploy EngageAgent main through Amplify.
Acceptance requires real teacher and student browser login round trips, reload,
logout, class creation/enrollment, task publication and student submission.
Unit-test identity fixtures are not evidence of production SSO working.

Rollback: redeploy the preceding EngageAgent commit. The additive GENIUS endpoint
can remain available; existing iframe SSO is unchanged. Preserve all new class
and response records, even when rolling the application code back.

## Existing limitations

The legacy API's broader authorization design and shared public lesson content
are not redesigned here. Guards added in this change protect native class IDs;
the existing GENIUS iframe API contracts remain compatible. Dependency audit
findings also require a separate, tested upgrade rather than an automatic
`npm audit fix --force` during an authentication release.
