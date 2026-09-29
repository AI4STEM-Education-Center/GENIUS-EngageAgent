# Engage Agent

An AI-driven engagement tool for educators. Teachers select a lesson, publish a
quiz to students, review answers, generate engagement strategies, create
content (text, images, video), and send selected content to students. Students
answer quiz questions and rate the content they receive.

The Engage Agent is designed to be embedded inside the
[GENIUS Learning Platform](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform)
via an iframe with SSO authentication, but can also run standalone for
development.

## Features

- **Teacher workflow** (3 steps): publish quiz → review answers & generate
  strategies → generate & send content
- **Student workflow**: answer quiz questions, then rate published content
- Lesson data for 8 physics lessons (collisions & forces) with multiple-choice
  and confidence-check items
- Strategy generation using batch/cohort analysis of student answers
- Content generation with AI-generated images and video
- Role-based views determined by SSO token (`teacher` vs `student`)
- Local JSON store or DynamoDB for persistence

## Architecture

- **Framework**: Next.js 16 (App Router)
- **API routes**: `app/api/` — auth, lessons, quiz status, student answers,
  content publish, content rating, strategy, media generation
- **Data layer**: `lib/nosql.ts` — DynamoDB with local JSON fallback
- **Auth**: `lib/auth.ts` — JWT (HS256) verification via `jose`
- **Quiz data**: `lib/quiz-data.ts` — loads `docs/data/lesson1-8.json`
- **Tests**: `__tests__/` — 57 tests via Vitest

## Prerequisites

- Node.js 18+
- npm
- (Optional) MongoDB and the GENIUS Learning Platform for full integration

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` in the project root, then fill in your secrets:

```bash
cp .env.example .env
```

Current example values:

```bash
# Required — text/image/strategy generation
OPENAI_API_KEY=your_openai_api_key_here

# Required for real GENIUS SSO flows
SSO_SECRET=your_shared_sso_secret

# Required if the app is embedded in an iframe from another origin
ALLOWED_ORIGINS=http://localhost:3000

# Optional — video generation
GROK_API_KEY=your_grok_api_key_here

# Optional — model overrides
OPENAI_MODEL=gpt-5-nano
OPENAI_IMAGE_MODEL=gpt-image-1

# Optional — AWS-backed persistence
# If these are omitted, the app falls back to local JSON storage in `data/engage-nosql.json`.
DYNAMODB_TABLE=genius_engage_agent_data
ENGAGE_AWS_REGION=us-east-2
ENGAGE_AWS_ACCESS_KEY_ID=your_aws_access_key_id
ENGAGE_AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
ENGAGE_S3_BUCKET=genius-engage-agent-media
COHORT_ANALYSIS_QUEUE_URL=

# Optional — script tuning
FEEDBACK_TICKET_CONCURRENCY=6
```

Set `ENGAGE_AWS_REGION` to the actual region where your DynamoDB table and S3 bucket live. For the current shared AWS setup, that is `us-east-2`.

If you want the local app to push uncached cohort analysis work to SQS, set `COHORT_ANALYSIS_QUEUE_URL` in `.env` (or `.env.local`) before starting `npm run dev`. If that variable is missing, the teacher flow falls back to inline cohort analysis on the app server.

### 3. Run the development server

```bash
npm run dev
```

The app starts on `http://localhost:3000` (or `:3001` if 3000 is taken).

### 4. Run tests

```bash
npm test            # single run
npm run test:watch  # watch mode
```

## Running with the GENIUS Learning Platform

To test the full SSO + iframe integration you need three processes running:

| Terminal | Command | What it runs |
|----------|---------|--------------|
| 1 | `mongod --dbpath /usr/local/var/mongodb` | MongoDB (or `brew services start mongodb-community`) |
| 2 | `cd GENIUS_Learning_Platform && npm run dev:full` | Genius Platform — Next.js (:3000) + Express (:4000) |
| 3 | `cd uga-engage-agent && npm run dev` | Engage Agent (:3001) |

Once all three are running:

1. Open `http://localhost:3000` and log in to the Genius Platform as a teacher
2. Create a Learning Task that points to the Engage Agent URL
   (`http://localhost:3001`)
3. Assign the task to a class
4. Open the assignment — the Engage Agent loads in an iframe with an SSO token
   and shows the **Teacher View**
5. Log in as a student in the same class and open the assignment to see the
   **Student View** (quiz + content ratings)

### SSO details

The GENIUS Platform signs a JWT (HS256) with `SSO_SECRET` and passes it to the
Engage Agent via `?sso_token=<JWT>` in the iframe URL. The token payload
includes `sub`, `email`, `name`, `role`, `classId`, `className`,
`assignmentId`, and `taskId`. The Engage Agent verifies the token and routes to
the appropriate view based on the `role` field.

The `SSO_SECRET` is shared across all agents that connect to the Genius
Platform — you do not need a separate secret per agent. During a secret
rotation, you can set `SSO_FALLBACK_SECRET` in the Engage Agent so it accepts
both the current and previous shared secret while GENIUS catches up.

### Standalone test-login routes

If you want to test the app without coming through the GENIUS platform, open
one of these URLs directly:

- `/test/teacher`
- `/test/student`

Those routes redirect to `/` in a built-in mock auth mode and store the mock
role in browser session storage, so navigation to other app pages in the same
browser tab keeps working.

Example URLs:

```text
http://localhost:3000/test/teacher
http://localhost:3000/test/student
```

The mock teacher and student share the same `classId` (`demo-class`) and
`assignmentId` (`demo-assignment`), which makes it easier to test both sides of
one flow. Use separate browser tabs if you want the teacher and student open at
the same time.

These routes are for testing only. Anyone who can reach the app URL can use
them, so they should not remain enabled on a public production deployment.

## DynamoDB table schema

If you enable DynamoDB, create a table named `genius_engage_agent_data` (or
your chosen `DYNAMODB_TABLE`) with:

- **Partition key**: `class_id` (String)
- **Sort key**: `record_id` (String)
- **Sort key values**: prefixed by record type, such as `PLAN#...`, `MEDIA#...`,
  `QUIZ_STATUS#...`, `ANSWER#...`, `CONTENT_PUB#...`, and `RATING#...`

The current code only queries the table's primary key, so no secondary index is
required for local development or the current app flows.

If you also enable S3-backed media storage, create a bucket named
`genius-engage-agent-media` (or your chosen `ENGAGE_S3_BUCKET`) in the same
region as DynamoDB.

## Async cohort analysis queue

If you set `COHORT_ANALYSIS_QUEUE_URL`, uncached cohort analysis requests are
queued through SQS instead of running inline on the app server.

The app and worker expect:

- An SQS queue whose URL is exposed to the app as `COHORT_ANALYSIS_QUEUE_URL`
- A Lambda deployment built from `workers/cohort-analysis-worker`
- DynamoDB access to the same table configured by `DYNAMODB_TABLE`
- Lesson data bundled with the worker so queued runs use the same lesson-aware
  prompts and cache versioning as the synchronous API path

Package the worker with:

```bash
./scripts/deploy-cohort-analysis-worker.sh
```

Deploy the packaged worker to Lambda with:

```bash
COHORT_ANALYSIS_WORKER_FUNCTION_NAME=genius-engage-cohort-analysis-worker \
./scripts/update-cohort-analysis-worker.sh
```

The resulting zip includes the worker code, production dependencies, and the
lesson JSON files from `data/`.

Recommended worker configuration:

- Environment variables: `OPENAI_API_KEY`, `DYNAMODB_TABLE`, and either
  `ENGAGE_AWS_REGION` or the default Lambda `AWS_REGION`
- Optional local/non-role credentials:
  `ENGAGE_AWS_ACCESS_KEY_ID` and `ENGAGE_AWS_SECRET_ACCESS_KEY`
- IAM permissions for DynamoDB reads/writes on the app table plus standard
  CloudWatch Logs permissions
- An SQS event source mapping from the queue to the worker Lambda
- Queue visibility timeout longer than the worker runtime budget

### Automated Lambda deploy

The repository includes `.github/workflows/deploy-cohort-analysis-worker.yml`.
It deploys the worker automatically on pushes to `main` when any of these
change:

- `workers/cohort-analysis-worker/**`
- `data/lesson*.json`
- `scripts/deploy-cohort-analysis-worker.sh`
- `scripts/update-cohort-analysis-worker.sh`

It also supports manual `workflow_dispatch` runs for branch testing.

Configure these GitHub repository settings before using it:

- Secret: `AWS_ROLE_TO_ASSUME`
- Variable: `COHORT_ANALYSIS_WORKER_FUNCTION_NAME`
- Variable: `ENGAGE_AWS_REGION` (optional; defaults to `us-east-2`)

The assumed AWS role needs permission to update Lambda function code for the
worker. The workflow updates code only; queue mappings, triggers, and Lambda
environment variables remain managed in AWS.
