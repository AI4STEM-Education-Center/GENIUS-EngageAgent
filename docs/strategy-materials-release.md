# Strategy material generation

The teacher workflow remains **My classes → task → Assessment → Strategy recommendation → Content generation**. Step 2 selects one strategy at a time: choosing another replaces the current choice, and clicking the current choice keeps it selected. The lesson and selected strategy carry forward into the material-type selector. Older drafts with several selected strategies retain their last valid choice; existing generated and published materials remain available. Existing quizzes, surveys, class-level recommendations and student review questions are retained.

Teachers can prepare materials before student submissions by selecting strategies manually in Step 2. When real quiz responses exist, the class recommendation is selected automatically. Generation reads only diagnostic aggregates from the authorized class, task and lesson. Optional classroom context is shared across material formats; survey experiences are not invented or automatically inferred.

## Available materials

| Strategy | Slides | Text + Image |
| --- | --- | --- |
| Analogy | Six core slides: authentic phenomenon, difficult target, familiar analogue, mapping, explanation/prediction, student question. Add a boundary slide only when needed. Two earlier story methods remain available. | Student-facing staged activity and its illustration. |
| Cognitive Conflict | Five stages: phenomenon, prediction, discrepant evidence, comparison, student question. Withhold evidence until after the prediction. | The same inquiry structure with a recorded prediction before revealing the image. |
| Experience Bridging | Recall an accessible experience, notice a relevant feature, introduce the target, optionally connect, and generate a question. Four or five slides. | A staged activity accepting either a remembered or imagined experience. |

Slides perform text/layout checks before image generation, then check actual images against their teaching purpose. Bounded automatic repairs retain the draft if refinement fails. Review-service failures and remaining teaching suggestions do not stop image generation or require another refinement. Once the draft has a valid layout and all images, teachers can immediately download an editable PPTX or send slides to students. Checking, confirming review and refining are optional. Editable drafts, images and checks are saved in IndexedDB on the current browser/device, scoped to the teacher, class, task, lesson and strategy; recovery does not automatically restart generation. Published student slides are stored on the platform and can be read from another device.

The **Review and publish** area groups the optional review record, PowerPoint download and student publication immediately below the slide preview. **Send to students** is enabled for a complete, valid deck even when the checkbox is unchecked, an AI or teaching-rule suggestion remains, or checks are missing or stale. The same policy applies to export and the publication endpoint. Schema/layout failures and missing or invalid image files still explain why a deck cannot be used; a check or refinement is never a prerequisite on its own. Editing clears the previous publication/export state but does not require new AI checks or a review confirmation before sending the edited version.

Text + Image materials can be downloaded as self-contained HTML with the image embedded and the staged student interaction preserved. Downloaded responses stay on that page; the platform's student review continues to use the existing saved-question submission. Text + Image publishing still uses the existing durable media storage.

### Reading Slides on the web

In **Content generation → Slides**, the teacher generates a completed deck and selects **Send to students**. Optional review and revision can be performed before sending or when updating the material. The **Published slides** list opens the published version directly on the web, even when the current device has no editable draft. PowerPoint download remains available.

Students open the task's existing **Explore and ask** step to read published slides. The reader displays one page at a time with previous/next controls, an enlarged view and a readable text alternative. Cognitive Conflict requires a written prediction before revealing the discrepant event and carries that prediction into the comparison page. The final question page links to the existing question submission form; student completion and ratings use the same workflow as other materials. Reading state and the prediction survive background content polling, but are not saved as a submitted student response.

When no quiz has been published, a task with published materials opens **Explore and ask** automatically. Students can still move between activities that are available. Progress counts available activities only: a materials-only task reaches **1 of 1 available activity completed** after the student submits questions and rates every published item. The unpublished assessment card remains visible and unavailable; it is not marked completed.

Publication uploads each image separately into private S3 storage, then commits a bounded manifest and a standard published-content record. The manifest contains only student-visible text, geometry and image references. Teacher notes, generation prompts, diagnostic context and review metadata are excluded. Image URLs are signed afresh for authorized readers; permanent records contain storage keys, not expiring URLs or embedded image data. Every read checks the signed session, class membership or teacher ownership, task and current published record. Incomplete uploads never appear to students. Publishing a revision updates the same content item; a newly generated deck has its own item.

This uses the existing workspace table and private bucket under `slide-publications/`; no public bucket access or new service is required. Uncommitted publication metadata expires after 30 minutes at the application level. Physical deletion of abandoned uploads requires existing bucket lifecycle management. Published assets must not be expired while their material remains available.

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

On **Download PPTX** or **Download material (HTML)**, the browser uploads the already-prepared file once through a teacher/class/task-authorized endpoint, with a 4.4 MB (4,400,000-byte) limit. The existing private bucket returns a signed attachment link valid for ten minutes. Repeating Download prepares a fresh link. File bytes and local fallback saving remain unchanged; unavailable storage or an oversized file retains the local save path. Stored objects use the `material-files/` prefix. Link expiry does not delete those objects; lifecycle cleanup and permission coverage for that prefix must be managed through the existing bucket configuration.

Live HTTP acceptance on October 6 downloaded all three PPTX files into Downloads; their slide XML matched the fifteen visually inspected exported pages. Cognitive Conflict and Experience Bridging HTML downloads also succeeded. Unsigned access to a stored attachment returned HTTP 403. A 4,246,943-byte Analogy HTML exposed the earlier four-megabyte fallback boundary; the final limit above accommodates that file without changing image quality.

Restoration retains the original order of validated prompt-provenance fields so an unchanged draft does not lose its matching text-review key when DynamoDB returns those fields in a different order. It does not recompute review keys or claim that changed content has been checked. Missing or stale review records are advisory, including for older saved drafts; they never require a fresh **Check slides** action before publishing a complete deck.

Rollback through the existing Amplify deployment history to the preceding application commit. Preserve class/task, assessment, media and student-response records.
