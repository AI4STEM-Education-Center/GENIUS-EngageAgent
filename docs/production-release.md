# Release the GENIUS embedded material workflow

Status reviewed on October 8, 2026. This release preserves the existing split:
GENIUS manages login, enrollment, assignments and the iframe; EngageAgent
generates, publishes and presents materials. No duplicate EngageAgent class is
needed for a GENIUS assignment.

## Two production deployments

| Application | Production branch and destination | Required changes |
| --- | --- | --- |
| GENIUS | `genius-platform-main` → GitHub Actions → existing EC2/PM2 services | [#79](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/pull/79) and [#80](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/pull/80) are merged. The combined production-branch commit is `da80d670a5bd2a47af3bbc1aa5103c4ec2e764bf`; deployment remains unconfirmed. |
| EngageAgent | `main` → existing AWS Amplify application | Embedded Slides support from [#136](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/pull/136) is deployed. The latest verified public release includes [#139](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/pull/139), commit `e4a8a7170061535609a09c91959491f1fd3568b8`. |

The October 8 production browser check confirmed a fresh GENIUS teacher launch
with the correct class and assignment, but without the required
`aud: engageagent-embed` claim. Authentication can therefore open the teacher
interface while the protected Slides catalog correctly rejects the launch.
Repeatedly reopening the task cannot repair this until GENIUS is updated.
The latest inspected GENIUS [deployment run](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/actions/runs/37799687419)
did not start because of the GitHub account billing/spending restriction.
PR #80 merged on October 8 at 23:34:38 EDT (October 9, 03:34:38 UTC); its
production rollout must still be confirmed separately from this merge.

Resolving GitHub's billing/spending restriction restores the ability to run
GENIUS's deployment job. It does not merge pending pull requests or establish
that Amplify deployed the EngageAgent commit. GitHub Pages job success is not
evidence of the Amplify application release. Confirm each actual deployed SHA.

The cohort-analysis Lambda workflow is separate from the Slides job pipeline.
Slides use provider background responses with job metadata in DynamoDB; they do
not require a newly deployed Lambda worker. If updating that worker, separately
verify its `AWS_ROLE_TO_ASSUME` secret and `COHORT_ANALYSIS_WORKER_FUNCTION_NAME`
variable. Do not change production to use the local demo launcher or storage.

## Configuration and storage checks

Amplify runs `npm run check:production-config` before building. This checks
configuration presence and origins without printing values or calling external
services. A successful preflight does **not** verify credentials, IAM permissions,
SSO key equality or provider model access.

| Setting | Production requirement |
| --- | --- |
| `SSO_SECRET` | Nonempty and privately verified to match GENIUS Express. |
| `ENGAGE_APP_URL` | `https://engageagent.ai4genius.org`, with no trailing slash. The default is this origin. |
| `GENIUS_URL` | `https://learn.ai4genius.org`, with no trailing slash. The default is this origin. |
| `ALLOWED_ORIGINS` | Must contain the exact GENIUS HTTPS origin for the frame-ancestor policy. |
| `OPENAI_API_KEY` | Existing server-side key with access to the configured slide text and image models. |
| `OPENAI_SLIDES_MODEL` / `OPENAI_IMAGE_MODEL` | Verify actual access; the current code defaults are `gpt-6.1-sol` / `gpt-image-1`. Empty Amplify overrides retain these defaults. |
| `DYNAMODB_TABLE` | Existing production table with string keys `class_id` and `record_id`; verify application read/write/query and transaction permissions. |
| `ENGAGE_S3_BUCKET` | Existing private production bucket; runtime identity must upload and read the `slide-publications/` and `material-files/` prefixes. Confirm bucket policies/KMS settings permit the existing identity. |
| AWS identity | Supply both `ENGAGE_AWS_ACCESS_KEY_ID` and `ENGAGE_AWS_SECRET_ACCESS_KEY`, or use the existing AWS runtime identity. A partial static override is rejected. |
| `ENGAGE_AWS_REGION` | Must match the existing resources; the code fallback is `us-east-2`. |
| Local demo settings | Remove `ENGAGE_LOCAL_MATERIAL_STORAGE` and `ENGAGE_LOCAL_DATA_DIR`. Production storage never uses the local material-asset route. |

No new data migration or bucket is required by this change. Existing records
retain their keys. The diagnostic reader now accepts the exact logical class ID
and its DynamoDB `CLASS#` representation while still filtering by assignment and
lesson. Publication readers already apply the corresponding exact class check.

Images and prepared downloads use private S3 objects and short-lived HTTPS
links. Confirm published image objects are not covered by an aggressive temporary
export cleanup policy. Expiry of the signed link is separate from object expiry:
readers refresh image links, and Download PPTX prepares a fresh download link.
Published records must not retain staging TTLs; the publication code removes
them when committing a deck.

## Ordered release and acceptance

1. Resolve the GENIUS Actions account restriction and deploy the reviewed
   `genius-platform-main` commit containing #79 and #80. Its workflow must
   finish tests, deploy the exact tested SHA and pass internal/public health
   checks, including the live MongoDB ping. See the GENIUS repository's
   `docs/engage-production-release.md` for the server configuration checklist.
2. Open a teacher-owned GENIUS class assignment using the EngageAgent root URL.
   Confirm a new token has issuer `genius-learning-platform`, audience
   `engageagent-embed`, and matching role, class, assignment and task. An enrolled
   student's assignment response must include `learningTask.id`. Inspect only
   necessary claims privately; do not log complete tokens or secrets.
3. Confirm the deployed EngageAgent release retains the embedded Slides support
   already live through #139. For subsequent fixes, deploy the exact reviewed
   `main` commit through Amplify and confirm preflight, build and deploy succeed.
4. Reopen the GENIUS task to obtain fresh credentials. Older generic tokens
   intentionally cannot operate the protected slide APIs. Verify standalone
   sign-in still works and cannot access an unrelated GENIUS class by changing
   URL parameters.
5. In a dedicated production test class, publish a quiz and submit synthetic
   student responses. Confirm the teacher sees them and generation includes the
   diagnostic context. Generate each supported strategy: **Analogy**,
   **Cognitive Conflict**, and **Experience Bridging**, one at a time.
6. For each strategy, verify text/image completion, page preview, optional text
   editing, publication with review/refine left optional, and a valid downloaded
   PPTX. For Cognitive Conflict, verify a student records a prediction before
   advancing to the discrepant event.
7. Sign in as an enrolled test student through GENIUS. Read the published slides
   and images on the webpage, submit a scientific question and material rating,
   and confirm GENIUS records completion. Refresh/reopen and confirm materials
   remain available. Verify an unrelated student cannot read the publication.
8. Record both deployed SHAs and these outcomes. Declare production acceptance
   complete only after the real HTTPS workflow passes; local tests or a green
   build alone do not establish this.

## Evidence already collected

- Real local GENIUS Next.js/Express/MongoDB and EngageAgent integration completed
  teacher creation, actual model generation of a six-page analogy deck,
  publication without refinement, PPTX download, student enrollment, quiz,
  illustrated slide reading, question submission, rating and GENIUS completion.
- Public HTTPS framing allows the canonical GENIUS origin. Protected slide calls
  run against the iframe's own origin and use the verified scoped credential;
  they do not depend on third-party session cookies.
- Production-shaped DynamoDB diagnostic records have regression coverage, as do
  authorization, job ownership, publication, download and expired-reader handling.
- EngageAgent #139 was verified publicly on October 8 at 03:37:59 UTC. Both
  teacher and student pages referenced the expected bundles, whose SHA256 values
  matched the validated production build. Standalone generation, publication,
  download and student feedback have been verified separately.
- A fresh production GENIUS launch still lacked the required audience during the
  October 8 embedded check. A valid signed launch with the wrong or missing
  audience receives HTTP 401 with `code: genius_launch_upgrade_required` and an
  integration-update instruction in the current code. Invalid or expired tokens
  keep the generic sign-in instruction. This diagnostic change does not grant
  legacy tokens access or replace the required GENIUS deployment.

Actual production secret values and AWS resource policies were not inspected.
The complete new GENIUS-hosted HTTPS workflow remains unverified until the host
update is deployed and the teacher/student acceptance above passes. Local
success and the working standalone workflow do not establish embedded acceptance.
