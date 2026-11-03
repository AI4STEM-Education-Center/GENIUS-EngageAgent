# v8.4 production verification — November 3, 2026

Release: [PR #191](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/pull/191), addressing #179 and #181, merged to `main` as `95980804b0316bacce38200648a554ae570fe15d`.
Production: https://engageagent.ai4genius.org, embedded by https://learn.ai4genius.org.

## Current result

**The release is deployed, and the production workflows listed below passed.**
AWS Console inspection confirmed Amplify application `d3prw7dcjtllel`, region
`us-east-2`, deployment **93: Deployed / SUCCEED**, at the exact merge SHA above.
Deployment 92, commit `f7eebf8c05c6df3b79491c91f56c57948242b420`, was also verified
as deployed and is the rollback target. Detailed preflight/build log contents
were not retrieved; this report does not claim they were reviewed. GitHub Pages
checks are unrelated to the Amplify deployment.

Independent public monitoring recorded 13 samples from 19:59:46 to 20:08:46 UTC.
The root remained HTTP 200 throughout. The Gallery endpoint changed from 404 to
the expected unauthenticated 401 at 20:02:01 UTC, and the root JavaScript asset
fingerprint changed at 20:02:46 UTC and then remained stable. These observations
support the Console deployment evidence; they are not authenticated acceptance
tests by themselves.

With the user's authorization, dedicated synthetic teacher and student accounts,
a QA class, and QA tasks were created through the production services. Testing
used the isolated in-app browser and fresh GENIUS SSO. It included real provider
generation and persistent QA data, not just read-only probes. The user's own
browser was not used.

A production language defect was found during acceptance: a cognitive-conflict
question displayed the internal field name `observedOutcome`. Its narrow fix is
implemented and locally validated but **awaits a subsequent deployment**. The
deployed release and this pending correction must not be conflated.

## Production checks completed

| Area | Observed result |
| --- | --- |
| Teacher generation | A real cognitive-conflict lesson generated five slides, two images, and a 4.041667-second video. |
| Editing and downloads | Single-slide AI revision and Undo worked. A real PPTX was downloaded and validated. |
| Private media | Signed video access returned HTTP 206; unsigned access returned HTTP 403. The real video reached `ended=true` with no media error. |
| Gallery | Use and Adapt created usable copies. Editing a copy left the source unchanged. Withdrawing the QA source preserved existing copies and publications. The real video was also shared, adapted in a native task, edited, saved, and withdrawn at its source. After reload, the unpublished production copy renewed its media and loaded with video `readyState=4`. |
| Student activity | Prediction gating worked; the prediction survived refresh and appeared in the comparison stage. Two questions and a material rating were submitted and retained. The video received a saved rating of 5. |
| GENIUS progress | GENIUS reflected one completed task (one total, one completed). Publishing another video returned the activity to In progress; completing its student workflow restored Explore Completed and GENIUS Activity Completed. |
| Responsive layout | The student workflow was checked at a 390px viewport. |

These operations exercised the live database and private media permissions needed
for those paths. They do not constitute a complete IAM, KMS, lifecycle, or TTL
policy audit. The other three strategies and near-limit image uploads were not
generated/tested through production ingress during this acceptance run.

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

The latest local verification, including the pending language correction, used
Node 22.23.4, matching Amplify's Node 22 major version, with the committed lockfile:
**1,476 tests passed across 128 files**, with 25 opt-in tests skipped. TypeScript
and the optimized Next.js production build passed. ESLint reported zero errors
and 16 warnings. These local results do not imply that the pending correction is
already deployed. The earlier deployed candidate passed 1,471 tests across
127 files, with the same 25 skips; its production build also passed HTTP smoke
checks for the entry page and unauthenticated protected/new Gallery routes.

In the isolated in-app browser, a synthetic 45-second H.264 video played through
to the end across normal 15-second content polling, with an unchanged video URL,
no media error, and the committed prediction preserved. Restoring an unpublished
Gallery video after its signed links expired also passed locally. These longer
polling/expiry checks used local signed links; the real production video was
shorter and does not establish the same duration/expiry coverage on S3.

Regression coverage includes cross-teacher/task and student denial, expired
copy links, copies surviving withdrawal, regenerated-media precedence, playback
stability across polling, genuine media changes, early URL failure recovery,
prediction persistence, and invalid production configuration. AWS adapters are
tested with mocks; those tests do not establish permissions on the live resources.
The 25 opt-in live tests remain skipped; manual production acceptance above is
reported separately.

## Pending language correction and remaining coverage

Generation and review prompts now tell the model to use ordinary student wording.
The cognitive-conflict parser also replaces exact `observedOutcome` and
`activity.observedOutcome` references in stage titles/text with “observed result.”
It retains the structured field and its value, surrounding teacher wording,
image information, and the source input. API regressions cover generation and
review both returning the leak; a component regression exercises an already
published activity through prediction and question stages.

After the correction deploys, valid existing structured publications will receive
the stage-text correction when read, without regenerating or rewriting saved
records. This is not a historical-data migration: legacy `body`, top-level titles,
and image captions/alt text are not deterministically cleaned. The current student
reader uses the parsed stages when a valid structured activity is present. Verify
the affected production activity again after deployment before closing this defect.

Remaining coverage includes production generation for analogy, experience
bridging, and engaged critiquing; near-limit image uploads through Amplify;
long-duration polling and expired-copy restoration against production S3; and
detailed deployment/configuration and storage-policy review. Local and mocked
coverage must not be presented as completed production checks for these cases.

## Evidence and rollback

Evidence is retained in the task's local
`EngageAgent-production-evidence-20261103` directory. Relevant artifacts include
`amplify-deployment-93.png`, `deployment-probes.json`,
`production-authenticated-api-probes.json`,
`production-pptx-validation.json`, `production-video-playback.json`,
`gallery-source-immutability-and-student-feedback.json`,
`withdrawn-gallery-preserved-publications-and-video.json`,
`production-genius-completed.png`, `production-mobile-layout.json`, and
`local-playback-polling.json`. The pending correction's latest local logs are
saved separately as `language-fix-node22-tests.log`,
`language-fix-node22-build.log`, and `language-fix-eslint.log`.
Account credentials and signed access artifacts
remain private and must not be copied into repository documentation.

If a later release fails, redeploy the verified previous Amplify release 92
(`f7eebf8c05c6df3b79491c91f56c57948242b420`), preserve application records, and
confirm HTTPS entry and protected APIs recover. QA Gallery sources were withdrawn
without deleting assets needed by existing copies. Do not use a GitHub merge or
a green Pages job as deployment proof.
