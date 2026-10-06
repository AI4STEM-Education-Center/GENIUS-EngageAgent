# Strategy material generation

The teacher workflow remains **My classes → task → Assessment → Strategy recommendation → Content generation**. The lesson and selected strategies carry forward into a single material-type selector. Existing quizzes, surveys, class-level recommendations and student review questions are retained.

Teachers can prepare materials before student submissions by selecting strategies manually in Step 2. When real quiz responses exist, the class recommendation is selected automatically. Generation reads only diagnostic aggregates from the authorized class, task and lesson. Optional classroom context is shared across material formats; survey experiences are not invented or automatically inferred.

## Available materials

| Strategy | Slides | Text + Image |
| --- | --- | --- |
| Analogy | Six core slides: authentic phenomenon, difficult target, familiar analogue, mapping, explanation/prediction, student question. Add a boundary slide only when needed. Two earlier story methods remain available. | Student-facing staged activity and its illustration. |
| Cognitive Conflict | Five stages: phenomenon, prediction, discrepant evidence, comparison, student question. Withhold evidence until after the prediction. | The same inquiry structure with a recorded prediction before revealing the image. |
| Experience Bridging | Recall an accessible experience, notice a relevant feature, introduce the target, optionally connect, and generate a question. Four or five slides. | A staged activity accepting either a remembered or imagined experience. |

Slides perform text/layout checks before image generation, then check actual images against their teaching purpose. Bounded repairs retain the draft if a step fails. Teachers can edit or request a revision and must review the result before downloading an editable PPTX. Slide text, images and checks are saved in IndexedDB on the current browser/device, scoped to the teacher, class, task, lesson and strategy; recovery does not automatically restart generation or retain a prior human approval. This is device-local recovery, not cross-device cloud synchronization.

Text + Image materials can be downloaded as self-contained HTML with the image embedded and the staged student interaction preserved. Downloaded responses stay on that page; the platform's student review continues to use the existing saved-question submission. Text + Image publishing still uses the existing durable media storage. Slides are teacher preview/download materials in this release.

The existing Video option is retained; video generation is not part of this release's acceptance scope.

## Deployment and verification

Use the existing Amplify application connected to this repository. The build uses Node 22 and includes the runtime prompt reference files. Existing identity, DynamoDB, S3 and model credentials remain required; `.env.example` documents model overrides without secret values.

Local tests and a successful production build do not establish that the live site has deployed. Acceptance must separately verify the production teacher login, a private QA class/task, all three strategy generators, image checks, refresh recovery and real downloaded files. Verify long provider requests and payloads through the actual Amplify ingress. If a provider or gateway fails, the interface retains completed draft work and offers a retry.

Rollback through the existing Amplify deployment history to the preceding application commit. Preserve class/task, assessment, media and student-response records.
