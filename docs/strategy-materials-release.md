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

### Production timeout correction

The first production smoke test on October 6 reached the new teacher interface, generated all three Text + Image activities and their stored images, but the synchronous slide requests returned HTTP 504 before producing a draft. The follow-up uses the [OpenAI Responses background API](https://developers.openai.com/api/docs/guides/background) for slide generation, revision and checks, and the [image-generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation) for background image work. Each website request submits or polls a job; it does not continue local work after returning an HTTP response.

The existing workspace table stores an opaque job ID, owner/class/task context, bounded validation metadata and a server-only provider response ID. Every poll and cancellation rechecks the signed teacher session and class/task ownership. Provider calls explicitly use `store: false`; polling tickets expire before the provider's approximately ten-minute background retrieval window. Completed drafts are recovered from the browser's existing draft store. In-flight work is not automatically restarted after reload. Cancellation is best effort; the client does not automatically resubmit paid generation on a network failure.

The application rejects expired tickets after nine minutes. Physical DynamoDB cleanup requires TTL to be enabled for the top-level `expiresAt` attribute; that table setting has not been verified by this release. A lost initial submission response can leave provider work running until it completes, which is why submission is never automatically repeated.

Text + Image HTML downloads retain an explicit **Save material file** link in addition to automatic saving. This supports embedded browsers that do not complete automatic blob downloads. A narrow CC/EB prompt correction also requires deformation to match the named material and component; a schematic cannot invent a dent in an ordinary cart body merely because it contacts foam. Analogy prompts are unchanged by this correction.

### Download compatibility

The October 6 follow-up generated complete live Slides for all three strategies: Analogy six pages, Cognitive Conflict five pages, and Experience Bridging four pages. The exact bytes exposed by the platform's save links passed package checks and all fifteen exported pages rendered correctly. The embedded browser did not report a completed blob/data-URI download, so explicit exports now also prepare a normal HTTP attachment when private S3 hosting is available.

On **Download PPTX** or **Download material (HTML)**, the browser uploads the already-prepared file once through a teacher/class/task-authorized endpoint, with a four-megabyte limit. The existing private bucket returns a signed attachment link valid for ten minutes. Repeating Download prepares a fresh link. File bytes and local fallback saving remain unchanged; unavailable storage or an oversized file retains the local save path. Stored objects use the `material-files/` prefix. Link expiry does not delete those objects; lifecycle cleanup and permission coverage for that prefix must be managed through the existing bucket configuration.

Rollback through the existing Amplify deployment history to the preceding application commit. Preserve class/task, assessment, media and student-response records.
