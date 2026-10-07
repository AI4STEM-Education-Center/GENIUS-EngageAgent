# Use EngageAgent inside GENIUS

The same production URL, `https://engageagent.ai4genius.org/`, supports both
independent workspaces and GENIUS learning tasks. An assigned GENIUS task opens
the existing three-step teacher workflow or student activity directly. It does
not require creating a second class in EngageAgent.

## Teacher setup

1. In GENIUS, open **My Classes → Create New Class**, or use an existing class.
2. Open **Learning Tasks → Create New Task**.
3. Select **Interactive** and enter `https://engageagent.ai4genius.org/` in
   **External URL (iframe source)**. Keep context/SSO enabled, then save.
4. Choose **Assign to Class**, select the class, and confirm the assignment.
5. Open **Preview**. If the task has several assignments, use **Assignments →
   Open preview with this class context** for the intended class.
6. Inside EngageAgent, follow the existing lesson/quiz, strategy, and material
   steps. In Step 3 select **Slides**, generate, optionally edit/refine, and
   **Send to students**. Complete slides can be published without refinement.

The task must be assigned before creating class materials. An unassigned task
preview has no class/assignment context. Paste the root URL above, not a
standalone `/teacher/classes?classId=ea-class-…` address or a copied SSO URL.

## Student access

1. In GENIUS, open **My Classes → Join Class** and enter the GENIUS class code.
2. Open that class and its assigned learning task.
3. EngageAgent opens inside the task using the student's GENIUS identity.
4. Complete the published quiz, then open **Explore and ask** when the teacher
   has published materials. Read the slides in the page, ask questions, and
   submit the material rating.

Guest students enrolled through GENIUS have the same read-only slide access.
Students see only student-facing content; teacher notes are not published.
The existing completion message to GENIUS remains unchanged.

## Authentication and deployment contract

Follow [the production release checklist](./production-release.md) for the
ordered GENIUS/Amplify rollout and real HTTPS acceptance checks.

GENIUS launches the iframe with a one-hour signed `sso_token` containing the
user's role, `classId`, `assignmentId` and `taskId`. For EngageAgent, GENIUS must
validate class ownership/enrollment and assignment scope before issuing an
`aud: engageagent-embed` token. Deploy that provider update before the
EngageAgent slide API update. Legacy tokens without this audience do not grant
access to the protected slide APIs; reopen the task to obtain a fresh token.

After successful verification, the client keeps a scoped credential in memory
(with session storage for reloads where available). Protected same-origin
requests attach it as a Bearer token. Generation, polling, image checks,
publication, student reading and hosted downloads all use this same identity.
No iframe launch replaces the independent workspace's session cookie.

The server requires a valid issuer/signature, audience, expiry and exact signed
class/assignment. Only teachers can generate or publish. A mismatched or invalid
token never falls back to another signed-in account. GENIUS credentials cannot
access independent `ea-class-*` classes; those retain their own session and
ownership/membership checks. In-flight operations retain their original scope.

Keep `SSO_SECRET` synchronized with GENIUS and include the GENIUS origin in
EngageAgent's `ALLOWED_ORIGINS` frame-ancestor list. Keep the existing iframe
`allow-downloads` sandbox permission. Do not add wildcard framing or disable
authentication. If a token expires, reopen the activity from GENIUS.

Independent entry still uses **Sign in with GENIUS → My classes** and its own
class codes. Standalone and host-managed classes remain separate records.

## Local integration

Run the real GENIUS frontend and Express API with an isolated local MongoDB,
then run EngageAgent in development mode. For example, use GENIUS on
`http://localhost:3100`, its API on `http://localhost:4100`, and EngageAgent on
`http://localhost:3104`. Both servers must share a locally generated `SSO_SECRET`.
Set GENIUS's `ENGAGE_SSO_REDIRECT_URIS` to
`http://localhost:3104/api/auth/callback` so it issues audience-bound embedded
credentials for this origin.

EngageAgent's ignored local environment should contain:

```dotenv
ENGAGE_APP_URL=http://localhost:3104
GENIUS_URL=http://localhost:3100
ALLOWED_ORIGINS=http://localhost:3100
ENGAGE_LOCAL_DATA_DIR=/absolute/path/to/isolated/engage-data
ENGAGE_LOCAL_MATERIAL_STORAGE=1
DYNAMODB_TABLE=
ENGAGE_S3_BUCKET=
```

Reuse the project's model API key through the local environment; do not commit
it or copy production database credentials into the demo. JSON records, slide
images and hosted exports remain in the isolated data directory. This optional
storage backend requires development mode, a loopback app origin and no cloud
storage configuration; it cannot enable local storage in production. Reading
and publishing still require the same scoped authentication. Local assets use
short-lived signed URLs, just like the production private storage flow.

Create real local teacher/student accounts and follow the same GENIUS task
setup above, using `http://localhost:3104/` as the External URL. No mock identity
or substitute material-generation route is needed. GENIUS remains the course
and task host; EngageAgent owns the material generation and viewing interface.
