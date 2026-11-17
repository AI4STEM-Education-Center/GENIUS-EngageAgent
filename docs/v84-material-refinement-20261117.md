# Material workflow refinement — 17 November 2026

References: #179, #181, #196 and the supplied `EngageAgent-UI-v8.4-prototype_1 (1).html`.
The user's latest rules take precedence over the prototype: at most three suitable recommendations at the top of Step 3; materials remain independent of classes; one or two strategy focus items.

This is an implementation summary, not a complete requirements sign-off. The subsequent [one-to-one requirements audit](v84-requirement-audit-20261117.md) identifies remaining UI and data-provenance gaps. Upstream service availability does not block implementing the [integration state and adapter design](v84-genius-readiness-design-20261117.md); that readiness work remains separate from successful local/production feature checks.

| Requirement / prototype area | Result |
| --- | --- |
| Step 2: experience selection | Reported activities with actual counts, focus-specific AI suggestions and good/weak-fit explanations, and a custom experience. Changing task/strategy/focus isolates the selection. Suggestions are explicitly distinguished from survey results. |
| Step 3: classroom context | Lesson, strategy, class profile and chosen experience summaries; material format and grade beside task context; generation and review anchors. Teaching choices travel through slide/video generation, revision, private saving and sharing defaults. |
| Step 3: Gallery matches | Seven dimensions: lesson, strategy, focus, grade, prior quiz, experience, format. Known matches receive equal weight; extra focus overlap breaks ties. Same lesson/strategy and overlapping focus are required for recommendations. Unknown values earn no match; incompatible curriculum identities cannot match merely by lesson number. At most three, hidden when none qualify. |
| Adapt to my class | An explicit Adapt action copies the material and starts one AI adaptation using the current task focus, grade, selected experience and authorized class context. Ordinary Open/Use does not generate. Slide revisions support undo. Video adaptation edits activity language and questions while preserving the existing scene, evidence, stage order and media. |
| Independent materials | Newly generated slides and videos can be saved directly to My saved materials. Private staging does not publish to Gallery. Existing revision-conflict, ownership, media and cross-class delivery protections apply. |
| Slide editor: video | Add/update/remove YouTube, Vimeo or public HTTPS media links per slide. The teacher and student reader play the video. PowerPoint exports an external video hyperlink. AI text revision preserves teacher-selected video links. |
| Check slides | Findings identify a slide or image when grounded in its identifier. Go to slide navigates there; Fix with AI targets that slide or image. Other findings retain whole-deck refinement. Image correction and text revision can be undone. |
| Share to Gallery | Grade, experience and prior-quiz tags inherit from the material. Include teacher notes controls the shared snapshot without removing the teacher's original notes. Raw classroom context stays private. |
| Gallery information | Seven compact matching tags on recommendations, richer teaching metadata and truthful engagement/question metrics in Gallery; author details collapse in the editor to keep editing actions prominent. |
| Student view | Per-slide video works in regular and enlarged reading. Published video JSON excludes private classroom context, teaching settings and notes, including legacy records. Existing question, prediction, rating and completion flow remains in place. |

## Verification

Automated checks on Node 22 after the production-acceptance corrections: full suite 2,970 passed / 38 opt-in tests skipped; production build and TypeScript passed. Changed files lint with no errors (existing image-element warnings). Coverage includes targeted image-correction undo, stable video controls, legacy video saves and actual DynamoDB marshalling of Gallery writes.

Background in-app browser acceptance with isolated synthetic accounts:

- Requested real AI experience suggestions and selected a spring comparison for Analogy.
- Generated a real six-slide deck with three images; AI review completed.
- Added a test video, saved to the private library, reopened it independently of its class and exported PPTX. The archive contains six slides and the video hyperlink.
- Sent the saved version to a second test class. The student reader loaded the media successfully, accepted two questions and a rating, and restored completed status after reload.
- Removed the technical test video from the private teaching copy; the previously sent student version remained unchanged.
- Shared without teacher notes; grade and experience were prefilled.
- Verified the new recommendation at the top of Step 3 with six of seven known tags matched (no quiz data was invented).
- Changed grade and classroom context, selected Adapt, and observed a real automatic revision: shorter sentences and a new “Draw Two Ball Outlines” slide matching the request. Saved the adapted independent copy.

## External data boundaries

GENIUS automatic class-profile / experience-check-in synchronization is not claimed complete. #179 explicitly identifies the experience service as pending upstream; the current GENIUS Class contract does not expose the prototype's full profile fields. Available local profiles and actual task survey data are used now. Missing historical authors/tags are not reconstructed from guesses. Engagement ratings and question counts are feedback metrics, not evidence of knowledge gain.

Production deployment and acceptance evidence is recorded separately so local verification is never confused with deployed verification.

## Production acceptance corrections

Deployment 116 (PR #220, `35cdebaf7bf47bddf5d60518dd2e98f4c9d76f1d`) completed successfully. Real video text adaptation worked in production. Acceptance then exposed two failures, addressed by the follow-up change:

- A duplicate sibling React key caused the video library-save button to accumulate after rerenders. The save control now has its own identity, with a regression that edits classroom context repeatedly.
- Old copies without teaching settings failed DynamoDB marshalling on save. Optional focus/media fields are now omitted and missing teaching settings use an empty object. Gallery API tests exercise the real AWS marshaller before local writes; this reproduced nine failures before correction and passes all 30 API cases afterward.

Manual video adaptation leaves its result and Undo visible. Legacy generated videos can use their task's lesson when no lesson was recorded, while an explicitly recorded material lesson remains authoritative. No cloud permissions were broadened for these fixes.
