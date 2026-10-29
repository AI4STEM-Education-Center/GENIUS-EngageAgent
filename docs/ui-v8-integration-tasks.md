# UI v8.3 integration: task list

This plan connects the v8.3 prototype (`EngageAgent-UI-v8.3-prototype_2.html`) to the backend. It replaces the current 3-step teacher flow and 2-step student flow.

The work is split into **two tasks, one per developer**. Work that depends on other work sits in the same task as numbered subtasks, done in order. The two tasks touch only at four small **handoff points**, listed below. Each handoff point is agreed on day 1 and delivered as the first subtask of its owner's task, so neither developer waits.

The "Status" notes come from a quick read of the repo. Confirm them before starting a subtask.

| | Task A — Lesson scope, Assessment, Reports | Task B — UI shell, Strategy, Materials, Discussion |
|---|---|---|
| Owns | Data model, Step 1, student "Get ready", feedback reports, class profile | App shell and design system, Steps 2–4, Gallery, Dashboard, student "Explore and ask" and "Class questions" |
| Mostly | Backend and AI prompts | Frontend, plus extending existing slide and strategy backends |

---

## Background: from learning task to lesson

**Today:** GENIUS opens EngageAgent for a *Learning Task*. The SSO token carries `classId` + `assignmentId` (+ `taskId`). Every record is keyed `class_id` + `…#ASSIGN#{assignmentId}#…` (`lib/nosql.ts`).

**New GENIUS:** there is a *class* and a *lesson*, and no learning task. EngageAgent must:

1. Scope all work to **class × GENIUS lesson**.
2. Keep its **own lesson content** in `data/lesson1–8.json`, separate from GENIUS's lesson record. The teacher links a GENIUS lesson to one of these lessons with the Step 1 "Lesson" picker, and the link locks after publishing.
3. Keep **per-class edits** (added misconceptions, anchoring phenomenon, edited or uploaded quiz items) without changing `data/`.

Proposed keys:

| Record | Key | Holds |
|---|---|---|
| Lesson content (read-only) | `data/lessonN.json` | objective, core ideas, misconceptions, quiz, default check-in items, item explanations |
| Class profile | `class_id` / `CLASS_PROFILE` | locale, groups (ranked, up to 3, or "not sure" / "prefer not to say"), class type, includes ELs, includes IEP/504 |
| **Lesson run** (class × GENIUS lesson) | `class_id` / `RUN#{scopeId}` | linked lesson number, anchoring phenomenon, added misconceptions, status of the 4 steps |
| Everything else | existing prefixes, with `ASSIGN#{assignmentId}` → `{scopeId}` | — |

`scopeId` is the GENIUS lesson id for new launches and the old `assignmentId` for legacy launches, so existing data still reads.

---

## Handoff points between A and B

Agree these on day 1 as TypeScript types in `lib/types.ts`. Until each is delivered, the other developer works against today's code and the seeded test students (`/api/auto-answer-test-students`).

| # | Contract | Owner | Delivered in | Used by B for |
|---|---|---|---|---|
| H1 | `scopeId` helper and `getLessonRun()` (linked lesson, misconception list incl. teacher-added, step status) | A | A1 | All B pages read the lesson and step status from it |
| H2 | `distractor_misconception_map` values become `string[]`; a `getRunQuiz(scopeId)` that returns the teacher's final quiz | A | A3 | Strategy evidence counts (B2) |
| H3 | `StudentAnswer` gains per-item `confidence` (1–4); `getClassProfile(classId)` | A | A2 / A6 | Strategy evidence, classroom context for slides (B3) |
| H4 | Shared UI primitives and the teacher/student shell with page slots | B | B1 | All A pages are built inside it |

---

## Task A — Lesson scope, Assessment (Step 1), Reports

### A1. Lesson-scoped identity and data model *(do first; delivers H1)*
**Status:** New. Touches `lib/auth.ts`, `lib/session.ts`, `lib/nosql.ts`, `lib/workspace*.ts`, `lib/genius-notify.ts`, `lib/quiz-data.ts`, `app/api/lessons/`.
- Accept the new GENIUS SSO claims (`classId`, `lessonId`, lesson title) next to the legacy `assignmentId`/`taskId`. Derive `scopeId`. Confirm claim names with the GENIUS team.
- Replace `ASSIGN#{assignmentId}` in `nosql.ts` key builders with one `scopeKey(scopeId)` helper. Legacy records must still read.
- Lesson run record and `GET/PUT /api/lesson-run`: linked lesson, anchoring phenomenon, added misconceptions, step status. Linking a lesson is rejected once the task is published.
- Extend `data/lessonN.json` with `checkin_items` and a per-item `explanation`. Lesson 1's content is in the prototype (`EXPL_L1`, `SURVEY_PROVIDED`). Lessons 2–8 need content written (see Decisions).
- Standalone workspace classes (`ea-class-*`): "lesson" replaces "assignment".
- `genius-notify.ts` events carry `lessonId`. Update `/test/teacher` and `/test/student` mock auth.
- Done when: a new-GENIUS launch and a legacy launch both resolve to a run, and existing tests pass.

### A2. Class profile *(delivers half of H3)*
- `CLASS_PROFILE` record and `GET/PUT /api/class-profile`; `getClassProfile()` for B.
- Onboarding modal on the first teacher visit per class, editable from the header. Used only to tailor materials, never shown about individual students.

### A3. Quiz authoring: editable quiz and confirmation *(delivers H2)*
**Status:** Partial. Provided items load from `data/`; no editable per-class quiz.
- Per-run quiz draft: items, `source` (`provided | upload | ai`), `confirmed` per item. Seeded from the lesson.
- `distractor_misconception_map` values become `string[]`. Update `strategy-recommendation.ts` (`resolveOptionMisconception`, `countClassResponses`), `lesson-context.ts`, and the cohort worker. Old single values still read.
- Endpoints: get draft, edit item (answer key, misconceptions per option, "no misconception"), confirm, switch source, add a misconception to the run list.
- Quiz tab UI: lesson picker, objective, core ideas, misconceptions, anchoring phenomenon, item cards, Confirm, "Needs review" / "Ready".

### A4. AI quiz import, generation, and misconception matching
**Status:** New.
- Upload (docx, pdf, pptx) and link import (Google Forms, Google Docs, Microsoft Forms, web page): extract text, then an LLM returns structured `QuizItem`s (`correct_answer` may be null). Private forms will fail; say so in the UI.
- Create with AI: count 3–5, focus (all or one core idea), reading level.
- Match misconceptions per distractor: codes, confidence, one-line reason, and an optional *possible new misconception* with a "similar to" note. Suggest a missing answer key.
- Structured-output prompts following `lib/material-output-schema.ts` and `docs/LLM_PROMPTS.md`.
- Wire "Match all items", "Set as answer", "Add to lesson list and use", "Dismiss".

### A5. Experience check-in authoring
**Status:** Partial. Survey CRUD, publish, schedule, responses, and analysis exist (`/api/surveys`, `SurveyBuilderView`, `lib/survey-*.ts`). Check the existing "review" code in `SurveyBuilderView` first.
- One check-in per run; "Provided" source seeded from `checkin_items`.
- AI check per item and in bulk: 6 criteria scored y/m/n, verdict (`good | revise | bad`), note, optional rewrite. Stored with the item and cleared when the prompt text changes.
- Use rewrite / Keep mine / Re-check. Publishing is blocked while an item is unchecked or `bad` without "Keep mine".
- Write with AI: draft 3 items from optional instructions, or start from the provided items.
- Item fields: prompt, example, purpose, related idea, short or long answer (maps to `SurveyItem`). Static guidelines panel.

### A6. Publish one task + student "Get ready for the lesson" *(delivers the rest of H3)*
**Status:** Partial. Quiz publish, survey publish, student answers, and activity status exist separately.
- One publish action for quiz + check-in, allowed only when both are ready. Locks the lesson picker. "Preview as student".
- Per-item confidence (4 levels) stored on `StudentAnswer`. Replace the separate `*_confidence` items in `data/` and update the code that reads them.
- Student page: quiz part, check-in part, answered counter, "Next unanswered", required-answer highlighting, one submit for answers + confidence + check-in.
- Submission count for the publish bar and Step 2 ("0 of 24 submitted"); class size from the GENIUS roster.
- Activity status and GENIUS notify for the merged step.

### A7. Feedback reports
**Status:** New.
- Per-student report: answer, correct answer, confidence, explanation (from `explanation`, or AI-written for uploaded and AI items).
- Release per run: "Mark lesson taught" or "Release now". Teacher preview before release.
- Student "My quiz report" tab locked until release, enforced by the API as well as the UI.
- Step 4 "Feedback reports" card.

---

## Task B — UI shell, Strategy (Step 2), Materials (Step 3), Discussion (Step 4)

### B1. UI shell and design system *(do first; delivers H4)*
**Status:** New. Replaces the layout of `TeacherView`, `StudentView`, `StudentProgressStepper`.
- Port tokens and primitives (card, pill, segmented control, tabs, alert, modal, toast, tooltip, drawer) from the prototype CSS. Drop the prototype bar ("View as", "Simulate next class event", "Reset demo").
- Teacher shell: header (lesson, class, Class profile, Dashboard, Gallery, Ask EngageAgent) and 4-step nav with status text. Student shell: 4 tabs with lock states.
- Empty page slots for every screen, so A can build Step 1 pages inside the shell.
- Done when: the shell runs in the GENIUS iframe and standalone, with A's and B's pages mounted.

### B2. Strategy step: evidence, recommendation, focus
**Status:** Partial. `recommendStrategy`, cohort analysis (SQS worker), strategy cache, and `getTaskInterests` exist.
- `GET /api/strategy-evidence`:
  - quiz: students, answers, correct, incorrect by misconception (using H2), unclassified;
  - check-in: top 2 activities (category, count, did vs. watched, objects with counts, a quote), "also mentioned", count with no clear activity. Extend `TaskInterests` where fields are missing.
- Recommendation and reason using the prototype thresholds (over 25% on one misconception → Cognitive Conflict; over 70% correct → Engaged Critiquing), reconciled with `recommendStrategy`, not duplicated.
- Save choice, focus, and override reason. Focus: target misconception (Cognitive Conflict, Engaged Critiquing); core idea + experience (Analogy); experience + core idea (Experience Bridging).
- Strategy tooltips: add `fit` and `flow` to `lib/engagement-strategies.ts`.

### B3. Materials: generate
**Status:** Mostly exists (`/api/slides`, jobs, per-strategy prompts, analogy methods, `/api/engagement-video`, PPTX export).
- Context panel: lesson, strategy + focus, class profile summary (H3), students' experiences.
- Editable classroom context, auto-built from profile + check-in + focus, passed as `classroomContext`.
- Pass the B2 focus into generation; the teacher's choice overrides `resolveCognitiveConflictTarget`. Add an equivalent focus for the other three strategies.
- Slide deck or animated video; "Generate again"; job progress via the jobs API.
- Thumbnails, large preview, and editor (title, body, thinking task, teacher notes) saved to draft storage.

### B4. Materials: revise, Check slides, video links, send
**Status:** Partial. `lib/slides/revision.ts`, `/api/slides/check`, `lib/slides/quality.ts`, and publication exist.
- Revise with AI, scope "whole deck" or "slide N". Response lists changed and unchanged slides and a summary. Undo restores the previous version.
- Video link per slide: validated, shown instead of the image, exported, played in the student reader.
- Check slides: 6 groups (Science, Inquiry, Strategy, Student-facing text, Images & video, Questions & notes), pass/issue per criterion. Map the existing review findings onto these instead of writing a new reviewer. "Fix with AI" revises only the affected slide and field; "Go to slide" for a missing video.
- Send to students via the existing publication endpoints. Download .pptx or video (exists).

### B5. Gallery: share materials with other teachers
**Status:** Partial. `/api/gallery` lists images and videos; deck sharing is new.
- Share dialog: title, grade band, topic, include notes. Always remove class details (counts, check-in quotes, names), and show the teacher the cleaned text.
- Global gallery record: owner, strategy, format, topic, usage count. List, preview, "Use as a starting point" (copies into the current lesson's draft), "Remove from Gallery".
- Block students from the gallery API in `guardWorkspaceRequest`.

### B6. Student "Explore and ask"
**Status:** Partial. `PublishedSlidesReader`, `/api/review-questions`, and `/api/content-rating` exist.
- Prediction gate: the Prediction slide needs text before Next; the prediction is saved and shown again on the Compare slide.
- Several questions per student (record already stores `string[]`). Rating 1–5 unlocks after questions are submitted.
- Resume reading position. Play B4 videos.

### B7. Questions & discussion and the class question board
**Status:** New, except raw question storage.
- LLM classification per lesson: theme (generated, plus "Clarifying", "Off-topic", "From earlier lessons"), type (Investigable / Explanation-seeking / Clarifying / Off-topic), and "suggested". Cached; re-run only for new questions.
- Teacher: select, select all in a theme, edit wording for the board (keep the original), publish / update / unpublish.
- Board record per lesson: anonymised text grouped by theme. Student "Class questions" tab.
- Earlier lessons: query questions across every lesson in the class; "Use in Lesson N" copies one into the current lesson.

### B8. Dashboard
**Status:** Partial. `TeacherDashboardView` and `app/dashboard` exist.
- Stat tiles (task submitted, questions this lesson, on the board, report status), per-student table (task, quiz correct, questions).
- "Student questions" table across lessons, with lesson filter and search, using B7's API.

### B9. Ask EngageAgent drawer *(optional, last)*
- Chat drawer scoped to the current page: sends page id and a short context summary to an LLM endpoint. Static suggested questions per page.

---

## Decisions needed in week 1

1. **GENIUS SSO payload**: claim names for the lesson, and whether GENIUS sends a lesson-number hint so the picker can default. *(A1)*
2. **Confidence**: per-item 4-level on the answer (recommended), or keep the separate confidence items. *(A6, affects B2)*
3. **Check-in items and explanations for Lessons 2–8**: who writes them, and whether AI drafts are acceptable. *(A1)*
4. **Link import**: which form providers must work in v1. *(A4)*
5. **Gallery moderation**: review before other teachers see shared materials, or not. *(B5)*
6. **Legacy data**: keep reading `ASSIGN#` records, or migrate once. *(A1)*
