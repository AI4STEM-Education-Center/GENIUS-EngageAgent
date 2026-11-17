import { createHash } from "node:crypto";
import { workspaceGet, workspacePut, workspaceQuery } from "./workspace-store";
import { getTaskDoc, listContentRatings, listPublishedContent, listReviewQuestions } from "./nosql";
import { collectQuestions, QUESTION_ANALYSIS_VERSION, questionsSourceKey, type QuestionAnalysis } from "./class-questions";
import type { GalleryFeedback, GalleryScope } from "./material-gallery";
import { ratingMatchesPublication } from "./material-feedback-version";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const partition = (id: string) => `GALLERY_FEEDBACK#${id}`;
type Use = GalleryScope & { contentItemId: string };
type Copy = { ownerId: string; templateId: string; storagePartition?: string };

/** Internal index only. A receipt is not usage: reads also verify publication.
 * Neither student identities, question text nor class identifiers are returned. */
export async function indexGalleryUse(templateId: string, scope: GalleryScope, contentItemId: string) {
  if (!scope.classId || !scope.assignmentId || !contentItemId) return;
  await workspacePut([{ partition: partition(templateId), key: `USE#${hash([scope.classId, scope.assignmentId, contentItemId])}`,
    value: { classId: scope.classId, assignmentId: scope.assignmentId, contentItemId } }]);
}

/** Called by an authorized publisher. Gallery provenance is resolved from
 * server-owned receipts, never a caller-supplied template ID or rating. */
export async function indexPublishedGalleryUse(scope: GalleryScope, ownerId: string, contentItemId: string) {
  const copyId = /^(?:slides-|gallery-copy-)([0-9a-f-]{36})$/iu.exec(contentItemId)?.[1];
  if (!copyId) return;
  const key = `COPY#${copyId}`;
  const library = `GALLERY_LIBRARY#${createHash("sha256").update(ownerId).digest("hex")}`;
  const legacy = `GALLERY_COPIES#${hash([scope.classId, scope.assignmentId])}`;
  let copy = await workspaceGet<Copy>(library, key);
  if (copy?.storagePartition) copy = await workspaceGet<Copy>(copy.storagePartition, key);
  copy ||= await workspaceGet<Copy>(legacy, key);
  if (copy?.ownerId === ownerId) await indexGalleryUse(copy.templateId, scope, contentItemId);
}

type TaskData = Awaited<ReturnType<typeof taskData>>;
async function taskData(scope: GalleryScope) {
  const [published, ratings, questions, analysis] = await Promise.all([
    listPublishedContent(scope.classId, scope.assignmentId), listContentRatings(scope.classId, scope.assignmentId),
    listReviewQuestions(scope.classId, scope.assignmentId), getTaskDoc<QuestionAnalysis>(scope.classId, scope.assignmentId, "question_analysis"),
  ]);
  const exact = (row: { class_id: string; assignment_id: string }) => [scope.classId, `CLASS#${scope.classId}`].includes(row.class_id) && row.assignment_id === scope.assignmentId;
  return { published: published.filter(row => exact(row) && row.published), ratings: ratings.filter(exact), questions: questions.filter(exact), analysis };
}
export const galleryFeedbackCache = () => new Map<string, Promise<TaskData>>();

/** Ratings describe engagement (1–5), not achievement. Questions can only be
 * attributed to the explicitly selected publication version. Legacy unbound
 * questions count only when one material was published. */
export async function galleryFeedback(templateId: string, cache = galleryFeedbackCache()): Promise<GalleryFeedback> {
  try {
    const uses = await workspaceQuery<Use>(partition(templateId), "USE#");
    const latestRatings = new Map<string, { rating: number; at: string }>();
    const questions = new Set<string>(), authors = new Set<string>(), activities = new Set<string>(), publishers = new Set<string>();
    const types: Record<string, number> = { Investigable: 0, "Explanation-seeking": 0, Clarifying: 0, "Off-topic": 0 };
    let analyzed = 0, attributableActivities = 0;
    let firstPublicationAt: string | undefined, lastFeedbackAt: string | undefined;
    const observe = (at: string) => { if (Number.isFinite(Date.parse(at)) && (!lastFeedbackAt || at > lastFeedbackAt)) lastFeedbackAt = at; };
    for (const use of uses) {
      const key = hash([use.classId, use.assignmentId]);
      let pending = cache.get(key); if (!pending) { pending = taskData(use); cache.set(key, pending); }
      const task = await pending;
      const published = task.published.find(item => item.content_item_id === use.contentItemId);
      if (!published) continue;
      activities.add(key);
      if (published.published_by) publishers.add(published.published_by);
      // Do not carry a replaced version's responses into a new publication.
      const since = Date.parse(published.published_at || "");
      if (Number.isFinite(since) && (!firstPublicationAt || published.published_at < firstPublicationAt)) firstPublicationAt = published.published_at;
      const current = (value: string) => Number.isFinite(since) && Date.parse(value) >= since;
      for (const row of task.ratings) {
        if (row.content_item_id !== use.contentItemId || !row.student_id || !Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5 || !ratingMatchesPublication(row, published.published_at)) continue;
        observe(row.rated_at);
        const previous = latestRatings.get(row.student_id);
        if (!previous || row.rated_at > previous.at) latestRatings.set(row.student_id, { rating: row.rating, at: row.rated_at });
      }
      const attributableRows = task.questions.filter(row => current(row.submitted_at)).map(row => ({ ...row, questions: row.questions.filter((_, index) => {
        const binding = row.questionMaterials?.[index];
        return binding ? binding.contentItemId === use.contentItemId && binding.publishedAt === published.published_at : !row.questionMaterials && task.published.length === 1;
      }) })).filter(row => row.questions.length);
      if (!attributableRows.length && task.published.length !== 1) continue;
      attributableActivities++;
      attributableRows.forEach(row => observe(row.submitted_at));
      const allQuestions = collectQuestions(task.questions, new Map());
      const validAnalysis = task.analysis?.version === QUESTION_ANALYSIS_VERSION && task.analysis.sourceKey === questionsSourceKey(allQuestions) ? task.analysis : null;
      const currentQuestions = collectQuestions(attributableRows, new Map());
      for (const question of currentQuestions) {
        const questionKey = `${key}:${question.id}`;
        if (questions.has(questionKey)) continue;
        questions.add(questionKey); authors.add(question.studentId);
        const tag = validAnalysis?.items[question.id]?.tag;
        if (tag && Object.hasOwn(types, tag)) { types[tag]++; analyzed++; }
      }
    }
    const ratings = [...latestRatings.values()].map(row => row.rating);
    return { status: "available", observedAt: new Date().toISOString(), ...(firstPublicationAt ? { firstPublicationAt } : {}), ...(lastFeedbackAt ? { lastFeedbackAt } : {}), ratingCount: ratings.length,
      averageRating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10 : null,
      highRatingPercent: ratings.length ? Math.round(ratings.filter(value => value >= 4).length / ratings.length * 100) : null,
      activityCount: activities.size, publishedTeacherCount: publishers.size, questionCount: questions.size, questionAuthorCount: authors.size,
      attributableActivities, analyzedQuestionCount: analyzed, questionTypes: types,
      scienceQuestionPercent: analyzed ? Math.round((types.Investigable + types["Explanation-seeking"]) / analyzed * 100) : null };
  } catch {
    // Reading the Gallery should remain possible when feedback is unavailable;
    // unavailable is not zero and must never be presented as a negative result.
    return { status: "unavailable" };
  }
}
