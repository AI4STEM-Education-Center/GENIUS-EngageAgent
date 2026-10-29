# GENIUS standard URLs

The new GENIUS opens EngageAgent in an iframe at fixed URLs instead of a URL the
teacher pastes into a learning task. Every URL receives the GENIUS `sso_token`;
the user and role always come from that verified token, never from the URL.
The existing root-URL launch described in [GENIUS embedding](./genius-embedding.md)
keeps working unchanged.

| URL | Who | What it does |
| --- | --- | --- |
| `/create` | Teacher | Create an EngageAgent activity (its title). Posts `genius.task-created`. |
| `/edit?task_id=…` | Owning teacher | Edit the title; posts `genius.task-updated` after saving. With a class in the token, the class's teacher workflow opens below. |
| `/view?task_id=…` | Owning teacher | Preview, may show teacher-only information. With a class in the token, that class's results are shown; otherwise only the activity setup. |
| `/delete?task_id=…` | Owning teacher | Confirmation, then **archive**. Posts `genius.task-deleted`. Nothing is deleted. |
| `/launch?task_id=…` | Student (or guest) | The student activity for the class and assignment signed in the token. |

## Activity ID

`task_id` is the `agentTaskId`, an ID EngageAgent generates (`ea-agent-task-<uuid>`).
It is separate from GENIUS's class, learning-task and assignment IDs, and from
the token's `taskId` claim. The activity record holds the teacher's setup:
title, owner (GENIUS ID), archived flag and timestamps, plus a list of the GENIUS
class/assignment pairs that use it. A pair is recorded when the activity is
created or opened (`/edit`, `/view`, `/launch`) with a class in the token.

Student answers, survey results and class-tailored materials stay keyed by the
GENIUS class and assignment, as before. Sharing one activity's materials across
classes is a follow-up.

## Messages to GENIUS

After a successful save or archive, EngageAgent posts to `window.parent`:

```js
{ type: "genius.task-created" | "genius.task-updated" | "genius.task-deleted",
  version: 1, agentId: "EngageAgent", agentTaskId: "ea-agent-task-…", title: "…" }
```

The target origin is `GENIUS_EMBED_ORIGIN`, or the origin of `GENIUS_URL` when it
is unset. It is never `"*"`; when the value is not a valid origin, no message is
sent. A failed save sends nothing. GENIUS should check `event.source` and
`event.origin` (the EngageAgent origin) before acting on a message.

The student-side `engage-agent.quiz-submitted` and `engage-agent.activity-reopened`
messages are unchanged.

## Access rules

- `/api/agent-tasks` accepts only an embedded GENIUS token (`aud: engageagent-embed`)
  as a Bearer credential. A class is optional. There is no session-cookie fallback.
- Only the teacher who created an activity can edit, view or archive it.
- Unknown or malformed IDs return 404. Archived activities return 410 ("This
  activity is no longer available.") except on the `/delete` confirmation.
- `/launch` requires a GENIUS class and assignment in the token; access to class
  data is still decided by that signed scope.

## Configuration

```dotenv
GENIUS_EMBED_ORIGIN=https://new-genius.example.edu   # optional
ALLOWED_ORIGINS=https://learn.ai4genius.org,https://new-genius.example.edu
```

`ALLOWED_ORIGINS` sets the `frame-ancestors` policy and must include every GENIUS
origin that embeds EngageAgent. The production preflight rejects a
`GENIUS_EMBED_ORIGIN` that is not canonical HTTPS or is missing from `ALLOWED_ORIGINS`.

## Open assumptions

- The new GENIUS issues `aud: engageagent-embed` tokens for every standard URL,
  including `/create` with no class.
- The `/launch` token includes the GENIUS `classId` and `assignmentId`.

## Local testing

`scripts/genius-standin.mjs` is a stand-in GENIUS page that signs local test
tokens, iframes each URL and logs the messages it receives. See the comment at the
top of the script for the commands.
