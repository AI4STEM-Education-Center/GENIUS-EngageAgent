# Material workflow delivery — 2026-11-17

Scope: #179, #181, #196 and the supplied v8.4 HTML. This implements the gaps recorded against main `4a33033`; the earlier audit remains a baseline, not the status of this change.

## Requirement-to-implementation record

| Requirement / prototype area | Delivered behavior |
| --- | --- |
| #179 Class profile and experience check-in; HTML Step 2 / Classroom context | Versioned server-side GENIUS adapter with an explicit v1 contract, scope validation, timeout, local fallback when disconnected, empty/error/stale/forbidden states, source and update time. Teachers explicitly accept new information; manual supplements and existing materials are preserved. Permission loss invalidates earlier context references. |
| #179 Experience selection; HTML reported counts, weak fit, suggestions | Actual check-in counts, automatic concept-specific fit assessment, fewer-than-two-good-matches guidance, cached AI suggestions, manual examples. Selected source and stable activity ID survive draft recovery. Renames follow the ID; removed selections need a current choice or explicit conversion to a personal example. |
| #179 Prompt context | Generation and revision use the teacher-accepted immutable context snapshot. A configured GENIUS integration cannot silently fall back to local profiles when the accepted reference is missing. |
| #196 All prompt variables | Private generation records capture actual prompts, model, parameters, focus, context versions and selected experience. Text/image/video generation and revision are recorded; receipts survive private saves, Gallery copies and sharing. The client cannot forge another teacher's receipt. Raw classroom inputs are not public Gallery tags. |
| #179/#196 Recommendations and tags | Seven matching dimensions, normalized grade choices, standard quiz bands, up to three relevant cards above generation. Editable public topic labels are separated from immutable curriculum identity, so relabeling does not break recommendations or mix different courses with the same lesson number. |
| #196 Historical labels and authors | Owners can review and correct public metadata with revision conflict protection; omitted existing labels are preserved. Verified owner identity can fill a missing author. Original generation inputs remain unchanged; missing historical inputs remain explicitly unrecorded. |
| #179 Independent materials | Step 3 can save a new deck directly to My saved materials. Gallery edits save on the server and reopen independently of a class; class/task selection occurs when sending. Save conflicts retain edits. |
| #179 HTML Check slides | Fifteen criteria with checked/issue/not-applicable/needs-review states; structured findings locate the relevant slide or image. A targeted repair triggers text rechecking and displays repair history. Image-plan findings revise the plan, rather than regenerating unchanged pixels. |
| #179 HTML editor and presenter | Revised thumbnail badges, unchanged-page count, undo, arrow/Page key navigation, optional private presenter notes and fullscreen. AI tools stay behind Advanced; saving, download and sending remain primary. Existing per-page video links are preserved. |
| #179 HTML video workspace | Player alongside the actual activity stages, optional legacy tools collapsed, direct Gallery video download using authenticated media delivery. Video adaptation changes teaching text; it does not claim to regenerate the MP4. |
| #179 HTML sharing | Inherited grade/experience/quiz settings, editable topic and seven-tag preview, teacher-note switch. AI suggests text cleanup as before/after edits; only selected edits are applied to the shared copy. The private source stays unchanged. Images/video still require teacher review. |
| #181 HTML Explore and ask | A single active reader with explicit material switching; existing prediction gate, version-isolated recovery, question submission, ratings and completion remain. Each question can target its material/publication or the whole activity. Stale or cross-task bindings are rejected without losing input. |
| User-requested student feedback on Gallery cards | Ratings, sample sizes and question classifications carry a reporting time/range. Explicit multi-material question attribution prevents crediting every material for the same question. These are feedback measures, not claims of learning improvement. |

## Validation

- Full test suite: **2,999 passed; 38 skipped** across 199 passing files and four skipped files. Skipped checks are not counted as verified.
- TypeScript check and production build passed. ESLint: zero errors, 17 warnings (existing image/unused-variable warnings).
- Background in-app browser: synthetic GENIUS ready/update/error/forbidden transitions; explicit acceptance; supplements preserved; real experience-fit AI; real six-slide and image generation; private save/reopen/edit; concurrent-save conflict; sharing cleanup with real AI and explicit approval; teacher-note exclusion; real slide review and targeted repair/recheck; keyboard presenter navigation; delivery to an isolated test class.
- Stored-data assertions: original versus reviewed topic, immutable curriculum identity, private-context isolation, shared-note exclusion and generation receipts.
- Student browser acceptance: two materials in one reader; prediction gate and refresh recovery; two submitted questions persisted with distinct publication bindings; rating gate and completion after rating; 390px viewport without document overflow.
- Final targeted checks after the context-version refresh change: 39 passed; final production build passed.
- Browser screenshots and local execution logs are kept in the delivery evidence directory. Production deployment and post-deploy checks are recorded separately after release.

## Integration boundary

The readiness implementation is complete and testable now. `GENIUS_CONTEXT_ENDPOINT` and `GENIUS_CONTEXT_TOKEN` remain optional server-only configuration. No synthetic provider is enabled for real classes. The real GENIUS service must implement the documented contract (or be translated by an adapter), then pass identity/scope and representative-data checks before activation. This is an external service activation step, not a missing teacher workflow.

Historical authors and parameters without evidence are not invented. Owners can repair public metadata; this change does not fabricate or silently bulk-rewrite old generation histories. Per-slide video exports are PowerPoint links, not embedded copies of remote video.
