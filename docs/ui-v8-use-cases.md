# UI v8.3 use-case scenarios

One scenario per subtask in [ui-v8-integration-tasks.md](ui-v8-integration-tasks.md). Labels in quotes are the exact text in the v8.3 prototype (`EngageAgent-UI-v8.3-prototype_2.html`). Where this file and the prototype differ, this file wins. The "Student experience check-in" is out of scope.

Numbers such as "24 students" are examples from the prototype; the real values come from the class.

---

## A1 — Lesson-scoped identity and data model

**Primary actor:** Teacher (also: student, GENIUS platform).
**Trigger:** The teacher opens EngageAgent from a lesson in GENIUS.

**Preconditions:**
- The teacher is signed in to GENIUS and teaches the class.
- The lesson exists in GENIUS.

**Main flow:**
1. GENIUS opens EngageAgent in an iframe with `sso_token` containing `role`, `classId`, `className`, `lessonId`, and the lesson title.
2. System verifies the token and sets `scopeId = lessonId`.
3. System loads the lesson run for (`classId`, `scopeId`). If none exists, it creates one with no linked lesson and every step "not started".
4. System opens Step 1 with the "Lesson" picker listing the EngageAgent lessons (`data/lesson1–8.json`), defaulting to the GENIUS hint if one is sent, otherwise Lesson 1.
5. Teacher picks a lesson, e.g. "Lesson 3".
6. System saves the link on the run and shows that lesson's learning objective, core ideas, misconceptions, and the default anchoring phenomenon.
7. Teacher edits "Anchoring phenomenon (optional)". System saves it on the run; `data/` is never changed.
8. The header shows "Lesson 3 · {class name}". The step nav shows each step's status, read from the run.

**Alternate flows:**
- **A. Legacy launch:** the token has `assignmentId` and no `lessonId`. System sets `scopeId = assignmentId` and existing quiz, answers, slides, and ratings for that assignment load unchanged.
- **B. Already published:** the picker is disabled with the hint "Locked after publishing". A direct API call to change the lesson returns 409.
- **C. Student launch:** a student opening the same GENIUS lesson resolves to the same run. If nothing is published they see "Nothing to do yet".
- **D. Invalid or expired token:** System shows the existing sign-in error; no run is created.
- **E. Standalone mode:** a teacher in a workspace class (`ea-class-*`) creates a lesson instead of an assignment; it behaves like a GENIUS lesson.

**Acceptance criteria:**
- New-GENIUS and legacy launches both work; legacy records still read.
- Two different GENIUS lessons in the same class have separate quizzes, answers, slides, and questions.
- GENIUS `postMessage` events include `lessonId`.
- `/test/teacher` and `/test/student` work with the new claims.

---

## A2 — Class profile

**Primary actor:** Teacher.
**Trigger:** The teacher opens EngageAgent for a class for the first time, or selects "Class profile" in the header.

**Preconditions:** Teacher is signed in to a class.

**Main flow:**
1. System shows the modal "Tell EngageAgent about this class" with the note "Used only to tailor materials. Never used to describe or label students."
2. Teacher answers:
   - "Which best describes where your school is located?" — one of City, Suburb, Town, Rural (each with its description).
   - "Which groups are most represented in this class?" — up to 3, in order of selection; each button shows its rank (1, 2, 3) and the order is listed below.
   - "What type of class is this?" — one of General education, Honors, Advanced Placement (AP) or IB, Gifted and talented, Co-taught, Special education (self-contained).
   - Checkboxes "Includes English learners (ELs)" and "Includes students with IEPs or Section 504 plans".
3. Teacher selects "Save". System saves the profile for the class and shows "Class profile saved".
4. The profile is used by Step 3's context panel and classroom context (B3).

**Alternate flows:**
- **A. Fourth group selected:** System keeps three and shows "Up to three — remove one first".
- **B. "Not sure" or "Prefer not to say":** clears the selected groups; selecting a group clears this choice.
- **C. Selecting a selected group** removes it and re-ranks the rest.
- **D. "Skip for now":** System saves nothing and does not show the modal again automatically; the profile shows "Not set".
- **E. Edit later:** "Class profile" in the header opens the same modal with saved answers; "Cancel" closes without changes.

**Acceptance criteria:**
- One profile per class, shared by all lessons in that class.
- The modal appears automatically only on the first visit.
- Students cannot read the profile through any API.

---

## A3 — Quiz authoring: editable quiz and confirmation

**Primary actor:** Teacher.
**Trigger:** The teacher opens Step 1 → "Quiz" tab.

**Preconditions:** The run is linked to a lesson (A1). The task is not published.

**Main flow:**
1. System shows the source switch: "Provided (Lesson N)", "Upload or link", "Create with AI". "Provided" is selected.
2. System shows each lesson quiz item as a card: number, origin ("Lesson bank"), stem, image if any, and options A–D. The correct option is marked "Correct"; each other option shows its misconception chips (code and text) or "No misconception".
3. Teacher selects "+ Add / change" on an option and picks a misconception from the dropdown (the run's list, including teacher-added ones) or "No misconception".
4. System adds the chip. An option can have more than one misconception.
5. Teacher removes a chip with "×".
6. Provided items start "Confirmed". The tab badge shows "Ready" when every item is confirmed, otherwise "Needs review".
7. The publish bar (A5) reflects the count of confirmed items.

**Alternate flows:**
- **A. Uploaded or AI items** (from A4) start "Needs your review". "Confirm item" is enabled only when the item has an answer key and every wrong option has been matched. Confirming clears AI suggestion styling.
- **B. No answer key:** the item shows "No answer key" and each option key is a dashed button; clicking one sets it as correct.
- **C. Switching source** keeps each source's draft; switching back restores it.
- **D. After publishing:** all editing is disabled.

**Acceptance criteria:**
- Edits are saved per run and survive reload.
- `distractor_misconception_map` stores arrays; old single-value data still reads.
- Strategy evidence (B2) counts answers using the edited mapping, including teacher-added misconceptions.
- `getRunQuiz(scopeId)` returns the confirmed quiz.

---

## A4 — AI quiz import, generation, and misconception matching

**Primary actor:** Teacher.
**Trigger:** On the Quiz tab, the teacher selects "Upload or link" or "Create with AI".

**Preconditions:** As A3.

**Main flow — upload a file:**
1. Teacher selects "Upload or link", then "Choose file" and picks a Word, PDF, or PowerPoint file.
2. System extracts the questions and shows them as item cards with origin "Uploaded", and a toast such as "3 items read from {file} — 1 has no answer key".
3. System shows the alert "Misconceptions not matched yet" with "Match all items"; every wrong option shows "Not matched yet".

**Main flow — add a link:**
1. Teacher pastes a URL (Google Forms, Google Docs, Microsoft Forms, or a web page) and selects "Import".
2. System imports the questions as above, with a toast naming the source.

**Main flow — create with AI:**
1. Teacher selects "Create with AI", sets "Number of items" (3–5), "Focus" (all core ideas or one), and "Reading level" (Grade 6–8), then "Create items".
2. System shows "Writing items…", then the items with origin "Created with AI" and misconception suggestions already applied.

**Main flow — match misconceptions:**
1. Teacher selects "Match all items". System shows "Matching…".
2. For each wrong option, System shows a suggested chip (AI style) and "AI · {High|Medium|Low} confidence." with a one-line reason.
3. Where no listed idea fits but a new one is detected, System shows "Possible new misconception: “…”" with a "similar to" note and the buttons "Add to lesson list and use" and "Dismiss".
4. Where the answer key is missing, System marks one option "AI suggests this is the correct answer" with "Set as answer".
5. Teacher accepts, changes, or removes suggestions (A3 flows) and selects "Confirm item".

**Alternate flows:**
- **A. "Add to lesson list and use":** System adds the misconception to the run with the next code (`c1`, `c2`…), labelled "Added by you", and maps the option to it.
- **B. Private or unreadable link / unreadable file:** System shows a clear error and imports nothing.
- **C. No questions found:** System says so and keeps the previous items.

**Acceptance criteria:**
- All AI calls use structured output; malformed responses are retried or reported, never shown half-parsed.
- Items without an answer key cannot be confirmed.
- Each uploaded or AI item has an explanation available for reports (A6).

---

## A5 — Publish the quiz + student "Get ready for the lesson"

**Primary actor:** Teacher, then student.
**Trigger:** The teacher selects "Publish task"; later a student opens "Get ready for the lesson".

**Preconditions:** Every quiz item is confirmed (A3).

**Main flow — teacher:**
1. The publish bar shows "One task for students" and "Quiz · N items confirmed". "Publish task" is disabled until every item is confirmed.
2. Teacher selects "Preview as student". System shows the quiz exactly as students will see it, then "Close preview".
3. Teacher selects "Publish task". System publishes and shows "Task published to {class size} students".
4. The bar shows "Task published to Period 3." and "Waiting for students — 0 of 24 submitted." The lesson picker locks.

**Main flow — student:**
1. Student opens the "Get ready for the lesson" tab.
2. System shows each item: stem, image, options A–D, and "How confident are you about your answer?" with "Very confident", "Somewhat confident", "Not very confident", "Just guessing".
3. A sticky bar shows "{x} of {y} answered" (each answer and each confidence counts) and "Next unanswered".
4. Student answers everything and selects "Submit answers".
5. System saves answers and confidence, shows "Submitted — thank you!", and shows "Go to Explore and ask" if materials have been sent.
6. The teacher's count updates ("1 of 24 submitted"), and GENIUS is notified that the activity is complete.

**Alternate flows:**
- **A. Missing answers on submit:** System highlights unanswered items in amber, shows "{n} still to answer — highlighted in amber", and scrolls to the first.
- **B. Not published:** student sees "Nothing to do yet".
- **C. Already submitted:** student sees the submitted screen; answers cannot be changed.

**Acceptance criteria:**
- Confidence is stored per item (1–4) on the student's answer record.
- Code that read the old `*_confidence` items is updated.
- Once at least one student has submitted, the publish bar shows "Go to Step 2".

---

## A6 — Feedback reports

**Primary actor:** Teacher, then student.
**Trigger:** The teacher opens Step 4 → "Feedback reports".

**Preconditions:** At least one student has submitted (A5).

**Main flow:**
1. System shows "{n} reports ready" and "Held until Lesson N is taught".
2. Teacher selects "Preview a report". System shows one student's report marked "Preview · not yet released".
3. Teacher selects "Mark Lesson N as taught". System sets the run to taught, releases all reports, and shows "Lesson N marked as taught — {n} reports released".
4. The card shows "Released" and "Released to {n} students".
5. A student opens "My quiz report". System shows "{x} of {y} correct" and, for each item: "Correct" or "Not quite", "Your answer", "Correct answer" (when wrong), "You felt" (their confidence), and "Why:" with the explanation.

**Alternate flows:**
- **A. "Release now instead":** releases reports without marking the lesson taught.
- **B. No submissions:** card shows "No reports yet".
- **C. Student opens the tab before release:** sees "Available after Lesson N"; the API returns 403.
- **D. Student submits after release:** their report is available immediately.

**Acceptance criteria:**
- Explanations come from the lesson data, or from A4 for uploaded and AI items.
- The release state is per run and enforced on the server.

---

## B1 — UI shell and design system

**Primary actor:** Teacher and student.
**Trigger:** Any EngageAgent page loads.

**Preconditions:** Signed in (A1).

**Main flow — teacher:**
1. Header shows the EngageAgent mark, "Lesson N · {class}", and "Class profile", "Dashboard", "Gallery", "Ask EngageAgent", and the teacher's initials.
2. Step nav shows 1 "Assessment", 2 "Strategy", 3 "Engagement materials", 4 "Questions & discussion". Each shows a status line from the run, e.g. "Ready to publish", "24 responses in", "Draft ready", "Board published". Completed steps show a check.
3. Selecting a step or header link switches the page; the active one is highlighted.

**Main flow — student:**
1. Header shows the lesson, class, and student name.
2. Tabs: "Get ready for the lesson", "Explore and ask", "Class questions", "My quiz report". Unavailable tabs show a lock and a reason ("Not available yet", "Your teacher will share these", "After Lesson N").

**Alternate flows:**
- **A. Narrow screen (~400px):** layout stacks; the step nav scrolls horizontally.
- **B. Inside the GENIUS iframe and standalone:** both render the same.

**Acceptance criteria:**
- Shared primitives (card, pill, segmented control, tabs, alert, modal, toast, tooltip, drawer) are reusable components.
- Each A and B page mounts in its slot without editing the shell.
- The prototype bar ("View as", "Simulate next class event", "Reset demo") is not shipped.

---

## B2 — Strategy step: evidence, recommendation, focus

**Primary actor:** Teacher.
**Trigger:** The teacher opens Step 2.

**Preconditions:** The task is published (A5).

**Main flow:**
1. System shows the quiz evidence card: "{correct} of {answers} answers correct ({pct}%) · incorrect answers by misconception", a bar per misconception ("{n} of {incorrect}"), and "Not tied to a listed misconception".
2. System shows the "Recommended" card with the strategy name, its info tooltip, and the reason, e.g. "22 of 50 incorrect answers (44%) point to the same idea — more than a quarter — and only 48% of answers were correct (below the 70% threshold for Engaged Critiquing)."
3. Under "Your choice", System shows four cards — Cognitive Conflict, Analogy, Experience Bridging, Engaged Critiquing — with the recommended one preselected. Each card's tooltip shows the description, "Fits when", and "Slide sequence".
4. System shows the "Focus" card for the selected strategy:
   - Cognitive Conflict: "Misconception to target" (radio list with answer counts).
   - Engaged Critiquing: "Misconception to turn into a claim".
   - Analogy: "Core idea to explain".
   - Experience Bridging: "Core idea to connect to".
5. Teacher selects "Use {strategy}". System saves the choice and focus, shows "Saved: {strategy}", and opens Step 3.

**Alternate flows:**
- **A. No submissions yet:** System shows "0 of 24 submitted" (or "Task not published yet") and "No responses yet"; no recommendation is preselected.
- **B. Teacher picks a different strategy:** System shows "Why a different strategy? (optional)". The saved line reads "(instead of {recommended})".
- **C. More students submit later:** evidence and recommendation recompute; a saved choice is kept.

**Acceptance criteria:**
- Thresholds match the prototype and reuse `recommendStrategy`.
- Choice, focus, and override reason are stored on the run and passed to B3.
- No check-in evidence or "student experience" picker is shown.

---

## B3 — Materials: generate

**Primary actor:** Teacher.
**Trigger:** The teacher opens Step 3 → "Generate".

**Preconditions:** A strategy is saved (B2).

**Main flow:**
1. System shows the context panel: "Lesson", "Strategy" (with the focus summary, e.g. "Target: a"), and "Class profile" (with "Edit").
2. Teacher picks "Material type": "Slide deck" or "Animated video".
3. System shows "Classroom context" prefilled from the class profile and the focus; teacher can edit it.
4. Teacher selects "Generate slide deck" (or "Generate animated video"). System shows "Generating…" and job progress.
5. System shows "Draft ready" and the review section (B4): a thumbnail per slide with its stage name, a large preview, and an editor with "Title", "Body", "Thinking task", and a "Teacher notes" tab.
6. Teacher edits text. Changes are saved to the draft.

**Alternate flows:**
- **A. No strategy:** "Generate" is disabled and System shows "Choose a strategy in Step 2".
- **B. "Generate again":** replaces the draft, resets "Sent to students", and clears check results.
- **C. Animated video:** the review shows a video player and the stage list instead of the slide editor.
- **D. Generation fails:** System shows the error and keeps the previous draft.

**Acceptance criteria:**
- The slide sequence matches the strategy (e.g. Cognitive Conflict: Phenomenon → Prediction → Conflicting evidence → Compare → Question).
- The focus from B2 changes the content (e.g. a different target misconception gives a different phenomenon).
- The classroom context the teacher edited is the one sent to generation.

---

## B4 — Materials: revise, Check slides, video links, send

**Primary actor:** Teacher.
**Trigger:** A draft exists in Step 3 (B3).

**Preconditions:** As B3.

**Main flow — revise:**
1. Teacher chooses "Whole deck" or "Slide N only", types a request (e.g. "Change the phenomenon to skateboarding"), and selects "Revise".
2. System shows "Revising…", then a result line: "Changed slides 1, 2, 4 · unchanged 3, 5 — {summary}" with "Undo". Changed thumbnails show "Revised".
3. Teacher selects "Undo". System restores the previous draft and shows "Revision undone".

**Main flow — video link:**
1. On a slide, teacher pastes a URL into "Video link (optional)" and selects "Add".
2. The slide preview shows a video tile instead of the image, with the hint "Plays on the slide in place of the image". "Update" and "Remove" are available.

**Main flow — check slides:**
1. Teacher selects "Check slides". System shows "Checking…".
2. System shows "{n} to look at" or "No issues found", and a list of the criteria with issues (e.g. "Short, clear tasks" — "Slide 4: “…” asks two things.").
3. For a text issue, teacher selects "Fix with AI". System changes only that slide and field, marks the item "Fixed", and shows "Slide N updated".
4. For a missing video, teacher selects "Go to slide N", which opens the video field.

**Main flow — send:**
1. Teacher selects "Send to students". The button changes to "Sent to students"; System shows "Sent to students — their questions will come to Step 4"; step 3 shows "Sent to students".
2. "Download .pptx" (or "Download video") downloads the current draft.

**Alternate flows:**
- **A. Empty revise request:** "Describe the change you want".
- **B. Invalid video URL:** "Paste a full video link starting with https://".
- **C. Revise after a check:** the check results are re-run.

**Acceptance criteria:**
- Check covers six areas: Science, Inquiry, Strategy, Student-facing text, Images & video, Questions & notes, built on the existing review findings.
- Video links are saved, exported, and play in the student reader (B6).

---

## B5 — Gallery: share materials with other teachers

**Primary actor:** Teacher (sharer), other teachers (viewers).
**Trigger:** The teacher selects "Share to Gallery" in Step 3.

**Preconditions:** A draft exists (B3).

**Main flow:**
1. System shows "Share with other teachers" with a preview of the first slide, "Title", "Grade band" (Middle school / High school), "Topic", "Include teacher notes" (checked), and "Remove class details — student counts, names" (checked and locked).
2. Teacher selects "Share to Gallery". System removes class details from the text, saves a gallery copy, and shows "Shared to Gallery — students won’t see it". Step 3 shows "In Gallery".
3. On the "Gallery" page, the teacher's card shows "Shared by you" and "Remove from Gallery".
4. Another teacher opens "Gallery" and sees cards with format, grade and topic, strategy, and "used by N teachers".
5. They select "Use as a starting point". System copies the deck into their current Step 3 draft and increases the usage count.

**Alternate flows:**
- **A. "Cancel":** nothing is shared.
- **B. "Remove from Gallery":** the card disappears for everyone; copies already taken are kept.
- **C. "Preview":** opens the deck read-only.

**Acceptance criteria:**
- The shared copy never contains student names, counts, or quotes.
- Students get 403 from all gallery endpoints.
- Sharing is separate from sending; sharing does not send to students and vice versa.

---

## B6 — Student "Explore and ask"

**Primary actor:** Student.
**Trigger:** The student opens the "Explore and ask" tab.

**Preconditions:** The teacher has sent materials (B4).

**Main flow:**
1. System shows the slide reader with "Previous", "Slide n of N", and "Next".
2. On the "Prediction" slide, System shows "Your prediction" with the hint "Write your prediction to continue"; "Next" is disabled until text is entered.
3. Student writes a prediction and selects "Next". System saves it; the field becomes read-only with "Saved".
4. On the "Compare" slide, System shows "Your prediction: {text}".
5. On the last slide, "Next" becomes "Write your question".
6. Student writes one or more questions ("Add another question") and selects "Submit questions". System shows "Submitted" and the list.
7. "Rate the material" unlocks (1 = not engaging · 5 = extremely engaging). Student picks a number and selects "Submit rating". System shows "Thanks — you rated it {n} / 5."

**Alternate flows:**
- **A. Materials not sent:** "Waiting for your teacher".
- **B. Submit with no question:** "Write at least one question".
- **C. Student returns later:** reader opens on the last slide they viewed; saved prediction, questions, and rating are shown.
- **D. A slide has a video link:** the video plays in place of the image.

**Acceptance criteria:**
- Prediction, questions, rating, and reading position are saved on the server.
- Questions appear in the teacher's Step 4 (B7).

---

## B7 — Questions & discussion and the class question board

**Primary actor:** Teacher, then student.
**Trigger:** The teacher opens Step 4 → "Student questions".

**Preconditions:** Materials are sent (B4) and students have submitted questions (B6).

**Main flow:**
1. System shows "{n} questions from {m} students" and the alert "{k} suggested for discussion".
2. Questions are grouped by theme (e.g. "Forces we can’t see", "Clarifying", "Off-topic"), each with a count and "Select all".
3. Each question shows a checkbox, the text, the student's name, a type pill ("Investigable", "Explanation-seeking", "Clarifying", "Off-topic"), and "Suggested" where applicable. Suggested questions are preselected.
4. Teacher selects "Edit wording" on a question, changes the text, and leaves the field. The question shows "Edited for the board"; the student's original is kept.
5. Footer shows "{n} selected · Shown without names". Teacher selects "Publish {n} to Class Question Board".
6. System shows "{n} questions published to the Class Question Board". The board section shows "Live for students" and the questions as notes, labelled by theme.
7. Student opens "Class questions" and sees "Questions we’ll explore together", grouped by theme, with no names.

**Alternate flows:**
- **A. Materials not sent:** section is locked: "Available after materials are sent in Step 3".
- **B. No questions yet:** "No questions yet".
- **C. Board already live:** button reads "Update board ({n})".
- **D. "Unpublish":** board is removed for students; "Board unpublished".
- **E. Question from an earlier lesson:** added from the Dashboard (B8); appears under "From earlier lessons" with "Lesson N" and is preselected.
- **F. New questions arrive later:** they are classified and added to their themes without re-classifying the rest.

**Acceptance criteria:**
- The board API never returns student names or ids.
- Classification is cached per run.
- "Earlier lessons' questions" links to the Dashboard questions table.

---

## B8 — Dashboard

**Primary actor:** Teacher.
**Trigger:** The teacher selects "Dashboard" in the header.

**Preconditions:** Signed in as teacher.

**Main flow:**
1. System shows tiles: "Task submitted" ({n} / {class size}), "Questions this lesson", "On the board", "Feedback reports" ("Released", "Held", or "—").
2. System shows a table per student: Student, Task ("Submitted"), Quiz correct ("x of y"), Questions.
3. System shows "Student questions" for the class across lessons, with a lesson filter ("All lessons", "Lesson N · current", other lessons) and a search box.
4. Each row shows the question, student, lesson and date, type, and "On board" if it was published.
5. For a question from an earlier lesson, teacher selects "Use in Lesson N". System adds it to Step 4 under "From earlier lessons" and the row shows "In Lesson N".

**Alternate flows:**
- **A. No submissions:** "No submissions yet".
- **B. Search:** filters rows by question text or student name.

**Acceptance criteria:**
- Data covers every lesson run in the class, not just the current one.
- Uses B7's questions API.

---

## B9 — Ask EngageAgent drawer

**Primary actor:** Teacher.
**Trigger:** The teacher selects "Ask EngageAgent" in the header.

**Preconditions:** Signed in as teacher.

**Main flow:**
1. System opens a side drawer with "Helping with: {current step or page}".
2. System shows suggested questions for the current page.
3. Teacher selects a suggestion or types a question and presses Enter.
4. System sends the question with the page and a short summary of the lesson's state, and shows the answer in the thread.
5. Teacher closes the drawer with "×" or the header button.

**Alternate flows:**
- **A. Page changes while open:** the scope line and suggestions update; the thread is kept for the session.
- **B. Model error:** System shows a short error in the thread.

**Acceptance criteria:**
- Students never see the drawer or its API.
- Lowest priority; ships last.
