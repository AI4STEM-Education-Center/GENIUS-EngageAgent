# LLM Prompts Reference

All prompts used across the application when calling external LLM / generative-AI APIs.

> **Last updated:** 2026-03-02

---

## Table of Contents

| # | Prompt | Source File |
|---|--------|-------------|
| 1 | [Strategy — Single Student](#1-strategy--single-student) | `app/api/strategy-single/route.ts` |
| 2 | [Strategy — Batch](#2-strategy--batch) | `app/api/strategy-batch/route.ts` |
| 3 | [Engagement Plan (with Cohort Context)](#3-engagement-plan-with-cohort-context) | `app/api/engagement-plan/route.ts` |
| 4 | [Engagement Content](#4-engagement-content) | `app/api/engagement-content/route.ts` |
| 5 | [Engagement Image](#5-engagement-image) | `app/api/engagement-image/route.ts` |
| 6 | [Engagement Video](#6-engagement-video) | `app/api/engagement-video/route.ts` |
| 7 | [Ask EngageAgent](#7-ask-engageagent) | `lib/ask-engageagent-server.ts` |

---

## 1. Strategy — Single Student

**Source:** `app/api/strategy-single/route.ts`
**API:** OpenAI Chat Completions
**Model:** `OPENAI_MODEL` env var (default: `gpt-5-nano`)
**Response format:** JSON object

### System Prompt

```
You are an education engagement planner.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Use the student's two-question quiz (concept understanding and past experience) to justify the recommendation.
Make the recommendationReason reference the student by name and the assignment/topic.
For recommendationReason and rationale, cite 2+ concrete details from the student's answers and connect them directly to the chosen strategy.
```

### User Prompt

```
Student name: {{student.name}}
Assignment: {{student.assignment ?? "Not provided"}}

Questionnaire answers:
{{JSON.stringify(student.answers, null, 2)}}

Return a plan:
- name: short label
- strategy: one of [cognitive conflict, analogy, experience bridging, engaged critiquing]
- relevance: scores 0-100 for each strategy
- overallRecommendation: 1-2 sentences, teacher-facing
- recommendationReason: 2-3 sentences explaining why this strategy fits {{student.name}}; reference the assignment/topic and cite 2+ specific answer details
- summary: 1 sentence
- tldr: 8-14 words, teacher-facing
- rationale: 3-5 sentences; reference the assignment/topic and include at least one concrete in-class example of how the teacher would use the strategy with {{student.name}}
- tactics: 3-5 bullets
- cadence: short phrase
- checks: 1-3 quick checks
```

### Dynamic Variables

| Variable | Description |
|----------|-------------|
| `student.name` | Student's full name |
| `student.assignment` | Assignment or topic (falls back to "Not provided") |
| `student.answers` | JSON object of questionnaire answers |

---

## 2. Strategy — Batch

**Source:** `app/api/strategy-batch/route.ts`
**API:** OpenAI Chat Completions
**Model:** `OPENAI_MODEL` env var (default: `gpt-5-nano`)
**Response format:** JSON object

Uses the **same system and user prompts** as [Strategy — Single Student](#1-strategy--single-student), but called in a loop for each student in the batch. The route aggregates results and returns a strategy distribution across the cohort.

---

## 3. Engagement Plan (with Cohort Context)

**Source:** `app/api/engagement-plan/route.ts`
**API:** OpenAI Chat Completions
**Model:** `OPENAI_MODEL` env var (default: `gpt-5-nano`)
**Response format:** JSON object

### System Prompt

```
You are an education engagement planner.
The plan will be used by teachers to engage students at the beginning of class.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Keep it concise and aligned to the student profile.
For recommendationReason and rationale, be specific: mention the student by name, mention the assignment/topic, and cite 2+ concrete details from the student's answers that justify the strategy.
```

### User Prompt

```
Questionnaire answers:
{{JSON.stringify(answers, null, 2)}}

Student name: {{studentName ?? "Unknown"}}
Assignment: {{assignment ?? "Not provided"}}

{{IF cohortDistribution}}
Cohort strategy distribution:
{{JSON.stringify(cohortDistribution, null, 2)}}
{{END IF}}

{{IF cohortStudents}}
Cohort student answers:
{{JSON.stringify(cohortStudents, null, 2)}}
{{END IF}}

Return a plan:
- name: short label
- strategy: one of [cognitive conflict, analogy, experience bridging, engaged critiquing]
- relevance: scores 0-100 for each strategy
- overallRecommendation: 1-2 sentences, teacher-facing
- recommendationReason: 2-3 sentences; include the student's name, assignment/topic, and 2+ specific details from their answers that justify the strategy
- summary: 1 sentence
- tldr: 8-14 words, teacher-facing
- rationale: 3-5 sentences; name the student, reference the assignment/topic, and give at least one concrete in-class example of how the recommendation would look (what the teacher says/does)
- tactics: 3-5 bullets
- cadence: short phrase
- checks: 1-3 quick checks
```

### Dynamic Variables

| Variable | Description |
|----------|-------------|
| `answers` | JSON object of student questionnaire answers |
| `studentName` | Student name (falls back to "Unknown") |
| `assignment` | Assignment or topic (falls back to "Not provided") |
| `cohortDistribution` | *(optional)* Strategy distribution across the cohort |
| `cohortStudents` | *(optional)* Array of other students' answers for context |

### Differences from Strategy — Single

- Adds teacher-facing framing: *"The plan will be used by teachers to engage students at the beginning of class."*
- Optionally includes cohort distribution and cohort student answers for contextual recommendations.

---

## 4. Engagement Content

**Source:** `app/api/engagement-content/route.ts`
**API:** OpenAI Chat Completions
**Model:** `OPENAI_MODEL` env var (default: `gpt-5-nano`)
**Response format:** JSON object

### System Prompt

```
You are an education engagement content designer.
Return JSON only with key: items (array). Each item has type, title, body.
```

### User Prompt

```
Student profile:
{{JSON.stringify(answers, null, 2)}}

Engagement plan:
{{JSON.stringify(plan, null, 2)}}

Generate 3 content items:
- Warm-up (short hook)
- Mini lesson (core idea)
- Practice (quick application)
Align the content to the strategy: {{strategy}}.
Keep each body 1-3 sentences.
```

### Dynamic Variables

| Variable | Description |
|----------|-------------|
| `answers` | JSON object of student questionnaire answers |
| `plan` | Full engagement plan object |
| `strategy` | The selected strategy string (may be called multiple times for comparison) |

### Notes

- If `selectedStrategies` contains multiple strategies, this prompt is called once per strategy (in parallel) and the results are merged.

---

## 5. Engagement Image

**Source:** `app/api/engagement-image/route.ts`
**API:** OpenAI Images (`images.generate`)
**Model:** `OPENAI_IMAGE_MODEL` env var (default: `gpt-image-1`)
**Output:** 1024x1024, webp, low quality

### Prompt

```
Create a simple, student-friendly illustration for an 8th grade physics lesson.
Topic: {{topic}}
Content type: {{item.type}}
Title: {{item.title}}
Plan: {{planName}}
Description: {{item.body}}

Style: clean, minimal, classroom-friendly.
Hard requirement: no text anywhere in the image.
Do not render words, letters, numbers, symbols, labels, captions, signs, or watermarks.
```

### Dynamic Variables

| Variable | Source | Fallback |
|----------|--------|----------|
| `topic` | `answers.topic` | `"gravity"` |
| `item.type` | Content item type (Warm-up / Mini lesson / Practice) | — |
| `item.title` | Content item title | — |
| `planName` | `plan.name` | `"Engagement plan"` |
| `item.body` | Content item description | — |

### Notes

- Grade level is hardcoded to **8th grade**.
- Subject is hardcoded to **physics**.

---

## 6. Engagement Video

**Source:** `app/api/engagement-video/route.ts`
**API:** Grok / x.ai Video (`https://api.x.ai/v1/videos/generations`)
**Model:** `grok-imagine-video`
**Auth:** `GROK_API_KEY` env var
**Output:** The request specifies four seconds at 480p. Structured analogies request 16:9. Clips that animate a still inherit its aspect ratio.

### Prompt and visual input

| Material | xAI visual input | Intended sequence |
|---|---|---|
| Staged analogy | `reference_images: [{ url: imageUrl }]` and `aspect_ratio: "16:9"` | Start with the target alone, cut to the familiar analogue, then hold both side by side to show one correspondence. Both subjects use the teacher's selected illustration as a visual reference. |
| Other staged activities | `image: { url: imageUrl }` | Start on the supplied image and follow the strategy-specific activity and reveal stage. |
| Older items without stages | `image: { url: imageUrl }` | Preserve the original scene. Older analogies hold the depicted comparison for observation. |

The strategy prompts live in `lib/material-video.ts`. The timings guide the model. Actual cuts may vary. Using a reference image permits a target-only opening because the provider does not pin the entire comparison illustration to frame zero. In image-to-video mode the provider pins that illustration and derives the aspect ratio from it. See the [xAI video mode table](https://docs.x.ai/developers/model-capabilities/video/overview) and [reference-image request format](https://docs.x.ai/developers/model-capabilities/video/reference-to-video).

The request starts a single asynchronous job. The client polls `app/api/engagement-video/status/route.ts` for completion.

---

## 7. Ask EngageAgent

**Source:** `app/api/ask-engageagent/route.ts`, with the prompt in `lib/ask-engageagent-server.ts`
**Model:** `OPENAI_CHAT_MODEL` env var (default: `gpt-4o-mini`)
**Input:** The page the teacher is on, the selected lesson's title, objective, core ideas and misconceptions, the teacher's question, and the earlier messages in the chat. No class or student data is sent.
**Output:** A short plain-text answer, capped at 500 tokens.

---

## Environment Variables Summary

| Variable | Used By | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | Sections 1–5, 7 | *(required)* |
| `OPENAI_MODEL` | Sections 1–4 | `gpt-5-nano` |
| `OPENAI_IMAGE_MODEL` | Section 5 | `gpt-image-1` |
| `GROK_API_KEY` | Section 6 | *(required)* |
| `OPENAI_CHAT_MODEL` | Section 7 | `gpt-4o-mini` |
