"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { UserContext } from "@/lib/auth";
import {
  engagementStrategies,
  getEngagementStrategyLabel,
} from "@/lib/engagement-strategies";
import type {
  ContentItem,
  ContentRatingRecord,
  Plan,
  QuizStatus,
  StudentAnswer,
} from "@/lib/types";

type Props = {
  user: UserContext;
};

type DashboardPublishedRecord = {
  content_item_id: string;
  content_json: string;
  published_at: string;
  published_by: string;
};

type DashboardMediaRecord = {
  content_item_id: string;
  media_type: "image" | "video";
  data_url?: string;
};

type DashboardStudentRow = {
  id: string;
  name: string;
  submittedAt: string;
  strategy?: string;
  tldr?: string;
};

type DashboardReviewQuestionRow = {
  studentId: string;
  name: string;
  questions: string[];
};

const formatDate = (iso: string) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDateTime = (iso: string) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function TeacherDashboardView({ user }: Props) {
  const classId = user.classId ?? "";
  const assignmentId = user.assignmentId ?? "";
  const hasAssignmentContext = Boolean(classId && assignmentId);

  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<string | null>(null);
  const [dashboardStudents, setDashboardStudents] = useState<DashboardStudentRow[]>([]);
  const [dashboardStrategyDistribution, setDashboardStrategyDistribution] = useState<Record<string, number>>({});
  const [dashboardPublishedRecords, setDashboardPublishedRecords] = useState<DashboardPublishedRecord[]>([]);
  const [dashboardRatings, setDashboardRatings] = useState<ContentRatingRecord[]>([]);
  const [dashboardReviewQuestions, setDashboardReviewQuestions] = useState<DashboardReviewQuestionRow[]>([]);
  const [dashboardMedia, setDashboardMedia] = useState<Record<string, { image: boolean; video: boolean }>>({});
  const [quizStatus, setQuizStatus] = useState<QuizStatus>("draft");
  const [selectedLesson, setSelectedLesson] = useState<number | null>(null);

  const loadDashboard = useCallback(async (options?: { silent?: boolean }) => {
    if (!classId || !assignmentId) {
      setDashboardStudents([]);
      setDashboardStrategyDistribution({});
      setDashboardPublishedRecords([]);
      setDashboardRatings([]);
      setDashboardReviewQuestions([]);
      setDashboardMedia({});
      setDashboardUpdatedAt(null);
      setSelectedLesson(null);
      setQuizStatus("draft");
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      setDashboardLoading(true);
    }
    setDashboardError(null);

    try {
      const [quizResult, answersResult, cacheResult, publishedResult, ratingsResult, mediaResult, reviewQuestionsResult] = await Promise.allSettled([
        fetch(`/api/quiz-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        fetch(`/api/student-answers?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        fetch(`/api/strategy-cache?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        fetch(`/api/content-publish?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        fetch(`/api/content-rating?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        fetch(`/api/media?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=cohort`),
        fetch(`/api/review-questions?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
      ]);

      let partialFailure = false;
      let fetchedAnswers: StudentAnswer[] = [];
      let fetchedPublished: DashboardPublishedRecord[] = [];
      let fetchedRatings: ContentRatingRecord[] = [];
      let fetchedMedia: DashboardMediaRecord[] = [];
      let fetchedStrategyResults: Array<{ studentId?: string; plan?: Plan }> = [];
      let fetchedReviewQuestions: Array<{ student_id?: string; questions?: string[] }> = [];

      if (quizResult.status === "fulfilled" && quizResult.value.ok) {
        const quizData = (await quizResult.value.json()) as {
          quizStatus?: { lesson_number?: number; status?: QuizStatus };
        };
        setSelectedLesson(quizData.quizStatus?.lesson_number ?? null);
        setQuizStatus(quizData.quizStatus?.status ?? "draft");
      } else if (quizResult.status === "fulfilled" || quizResult.status === "rejected") {
        partialFailure = true;
      }

      if (answersResult.status === "fulfilled" && answersResult.value.ok) {
        const answersData = (await answersResult.value.json()) as { answers?: StudentAnswer[] };
        fetchedAnswers = answersData.answers ?? [];
      } else if (answersResult.status === "fulfilled" || answersResult.status === "rejected") {
        partialFailure = true;
      }

      if (cacheResult.status === "fulfilled" && cacheResult.value.ok) {
        const cacheData = (await cacheResult.value.json()) as {
          results?: Array<{ studentId?: string; plan?: Plan }>;
        };
        fetchedStrategyResults = cacheData.results ?? [];
      } else if (cacheResult.status === "fulfilled" || cacheResult.status === "rejected") {
        partialFailure = true;
      }

      if (publishedResult.status === "fulfilled" && publishedResult.value.ok) {
        const publishedData = (await publishedResult.value.json()) as {
          items?: DashboardPublishedRecord[];
        };
        fetchedPublished = publishedData.items ?? [];
      } else if (publishedResult.status === "fulfilled" || publishedResult.status === "rejected") {
        partialFailure = true;
      }

      if (ratingsResult.status === "fulfilled" && ratingsResult.value.ok) {
        const ratingsData = (await ratingsResult.value.json()) as {
          ratings?: ContentRatingRecord[];
        };
        fetchedRatings = ratingsData.ratings ?? [];
      } else if (ratingsResult.status === "fulfilled" || ratingsResult.status === "rejected") {
        partialFailure = true;
      }

      if (mediaResult.status === "fulfilled" && mediaResult.value.ok) {
        const mediaData = (await mediaResult.value.json()) as {
          results?: DashboardMediaRecord[];
        };
        fetchedMedia = mediaData.results ?? [];
      } else if (mediaResult.status === "fulfilled" || mediaResult.status === "rejected") {
        partialFailure = true;
      }

      if (reviewQuestionsResult.status === "fulfilled" && reviewQuestionsResult.value.ok) {
        const reviewQuestionsData = (await reviewQuestionsResult.value.json()) as {
          reviewQuestions?: Array<{ student_id?: string; questions?: string[] }>;
        };
        fetchedReviewQuestions = reviewQuestionsData.reviewQuestions ?? [];
      } else if (reviewQuestionsResult.status === "fulfilled" || reviewQuestionsResult.status === "rejected") {
        partialFailure = true;
      }

      const strategyDistribution: Record<string, number> = {};
      const strategyByStudent = new Map<string, { strategy?: string; tldr?: string }>();
      for (const entry of fetchedStrategyResults) {
        if (!entry.studentId || !entry.plan) continue;
        strategyByStudent.set(entry.studentId, {
          strategy: entry.plan.strategy,
          tldr: entry.plan.tldr,
        });
        if (entry.plan.strategy) {
          strategyDistribution[entry.plan.strategy] = (strategyDistribution[entry.plan.strategy] ?? 0) + 1;
        }
      }

      const mediaMap: Record<string, { image: boolean; video: boolean }> = {};
      for (const record of fetchedMedia) {
        if (!record.content_item_id) continue;
        if (!mediaMap[record.content_item_id]) {
          mediaMap[record.content_item_id] = { image: false, video: false };
        }
        if (record.media_type === "image" && record.data_url) {
          mediaMap[record.content_item_id].image = true;
        }
        if (record.media_type === "video" && record.data_url) {
          mediaMap[record.content_item_id].video = true;
        }
      }

      const studentRows = fetchedAnswers
        .map((answer) => ({
          id: answer.student_id,
          name: answer.student_name,
          submittedAt: answer.submitted_at,
          strategy: strategyByStudent.get(answer.student_id)?.strategy,
          tldr: strategyByStudent.get(answer.student_id)?.tldr,
        }))
        .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime());

      const studentNameById = new Map(studentRows.map((row) => [row.id, row.name]));
      const reviewQuestionRows = fetchedReviewQuestions
        .filter((entry): entry is { student_id: string; questions: string[] } =>
          Boolean(entry.student_id && entry.questions && entry.questions.length > 0),
        )
        .map((entry) => ({
          studentId: entry.student_id,
          name: studentNameById.get(entry.student_id) ?? entry.student_id,
          questions: entry.questions,
        }));

      setDashboardStudents(studentRows);
      setDashboardStrategyDistribution(strategyDistribution);
      setDashboardPublishedRecords(fetchedPublished);
      setDashboardRatings(fetchedRatings);
      setDashboardReviewQuestions(reviewQuestionRows);
      setDashboardMedia(mediaMap);
      setDashboardUpdatedAt(new Date().toISOString());

      if (partialFailure) {
        setDashboardError("Some dashboard data could not be refreshed. Showing the latest available results.");
      }
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      if (!options?.silent) {
        setDashboardLoading(false);
      }
    }
  }, [assignmentId, classId]);

  useEffect(() => {
    if (!hasAssignmentContext) {
      setDashboardStudents([]);
      setDashboardStrategyDistribution({});
      setDashboardPublishedRecords([]);
      setDashboardRatings([]);
      setDashboardReviewQuestions([]);
      setDashboardMedia({});
      setDashboardUpdatedAt(null);
      return;
    }

    void loadDashboard();
    const intervalId = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [hasAssignmentContext, loadDashboard]);

  const strategyChartRows = useMemo(() => {
    const analyzedStudentTotal = Object.values(dashboardStrategyDistribution).reduce((sum, count) => sum + count, 0);
    return {
      analyzedStudentTotal,
      rows: engagementStrategies.map((strategy) => {
        const count = dashboardStrategyDistribution[strategy.id] ?? 0;
        return {
          ...strategy,
          count,
          percent: analyzedStudentTotal > 0 ? Math.round((count / analyzedStudentTotal) * 100) : 0,
        };
      }),
    };
  }, [dashboardStrategyDistribution]);

  const dominantStrategy = useMemo(
    () =>
      strategyChartRows.rows
        .slice()
        .sort((left, right) => right.count - left.count)[0],
    [strategyChartRows.rows],
  );

  const publishedContentRows = useMemo(
    () =>
      dashboardPublishedRecords.map((record) => {
        let parsedItem: ContentItem = {
          id: record.content_item_id,
          type: "unknown",
          title: "Content",
          body: "",
          strategy: "",
        };

        try {
          parsedItem = JSON.parse(record.content_json) as ContentItem;
        } catch {
          parsedItem = {
            id: record.content_item_id,
            type: "unknown",
            title: record.content_item_id,
            body: "",
            strategy: "",
          };
        }

        const itemRatings = dashboardRatings.filter((rating) => rating.content_item_id === record.content_item_id);
        const averageRating = itemRatings.length > 0
          ? itemRatings.reduce((sum, rating) => sum + rating.rating, 0) / itemRatings.length
          : null;
        const mediaState = dashboardMedia[record.content_item_id] ?? { image: false, video: false };

        return {
          id: record.content_item_id,
          title: parsedItem.title,
          type: parsedItem.type,
          strategy: parsedItem.strategy,
          averageRating,
          ratingsCount: itemRatings.length,
          mediaState,
          publishedAt: record.published_at,
          publishedBy: record.published_by,
        };
      }),
    [dashboardMedia, dashboardPublishedRecords, dashboardRatings],
  );

  const ratingsByStudent = useMemo(
    () =>
      dashboardRatings.reduce<Record<string, number>>((accumulator, rating) => {
        accumulator[rating.student_id] = (accumulator[rating.student_id] ?? 0) + 1;
        return accumulator;
      }, {}),
    [dashboardRatings],
  );

  const ratingChartRows = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((value) => {
        const count = dashboardRatings.filter((rating) => rating.rating === value).length;
        return {
          value,
          count,
          percent: dashboardRatings.length > 0 ? Math.round((count / dashboardRatings.length) * 100) : 0,
        };
      }),
    [dashboardRatings],
  );

  const averageStudentRating = useMemo(
    () =>
      dashboardRatings.length > 0
        ? (dashboardRatings.reduce((sum, rating) => sum + rating.rating, 0) / dashboardRatings.length).toFixed(1)
        : null,
    [dashboardRatings],
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4">
          <nav className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Engage Agent</p>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-700">Teacher</span>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Dashboard</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Link href={user.classId?.startsWith("ea-class-") ? `/teacher/classes?classId=${encodeURIComponent(user.classId)}&assignmentId=${encodeURIComponent(user.assignmentId || "")}` : "/"} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
                Back to workflow
              </Link>
              <Link href="/community" className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
                Community Gallery
              </Link>
            </div>
          </nav>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Teacher dashboard</p>
                  <h1 className="text-3xl font-semibold text-slate-900">Assignment summary</h1>
                </div>
                <p className="max-w-3xl text-sm text-slate-600">A separate reporting space for this assignment. Review quiz completion, cohort strategy patterns, published content, and student feedback without interrupting the content-generation workflow.</p>
                {dashboardUpdatedAt && (
                  <p className="text-xs text-slate-400">Last updated {formatDateTime(dashboardUpdatedAt)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={dashboardLoading || !hasAssignmentContext}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {dashboardLoading ? "Refreshing..." : "Refresh dashboard"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Teacher</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{user.name}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Class ID</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{classId || "—"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Assignment ID</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{assignmentId || "—"}</p>
              </div>
            </div>
          </div>
        </header>

        {!hasAssignmentContext ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            Open the Engage Agent from a specific GENIUS class assignment to view the teacher dashboard for that assignment.
          </div>
        ) : (
          <section className="grid gap-6">
            {dashboardError && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {dashboardError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Quiz status</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{quizStatus.charAt(0).toUpperCase() + quizStatus.slice(1)}</p>
                <p className="mt-1 text-xs text-slate-500">Current lesson workflow state</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Lesson</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{selectedLesson ? `Lesson ${selectedLesson}` : "—"}</p>
                <p className="mt-1 text-xs text-slate-500">Selected lesson for this assignment</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Responses</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{dashboardStudents.length}</p>
                <p className="mt-1 text-xs text-slate-500">Students who submitted the quiz</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Dominant strategy</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{dominantStrategy?.count ? dominantStrategy.label : "Not analyzed"}</p>
                <p className="mt-1 text-xs text-slate-500">Lead strategy for the current cohort</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Content sent</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{publishedContentRows.length}</p>
                <p className="mt-1 text-xs text-slate-500">Published items available to students</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-slate-400">Average rating</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{averageStudentRating ?? "—"}</p>
                <p className="mt-1 text-xs text-slate-500">Student engagement rating across sent items</p>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Strategy chart</p>
                    <h2 className="text-lg font-semibold text-slate-900">Cohort strategy distribution</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{strategyChartRows.analyzedStudentTotal} analyzed</span>
                </div>
                {strategyChartRows.analyzedStudentTotal === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Run cohort analysis after students submit the quiz to populate this chart.</p>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {strategyChartRows.rows.map((row) => (
                      <div key={row.id} className="grid gap-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-slate-800">{row.label}</span>
                          <span className="text-xs font-semibold text-slate-500">{row.count} students ({row.percent}%)</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full ${row.color}`} style={{ width: `${row.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Ratings chart</p>
                    <h2 className="text-lg font-semibold text-slate-900">Student content ratings</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{dashboardRatings.length} ratings</span>
                </div>
                {dashboardRatings.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Ratings appear here after students review sent content.</p>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {ratingChartRows.map((row) => (
                      <div key={row.value} className="grid gap-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-slate-800">{row.value} / 5</span>
                          <span className="text-xs font-semibold text-slate-500">{row.count} ratings ({row.percent}%)</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-[#BA0C2F]" style={{ width: `${row.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Content table</p>
                    <h2 className="text-lg font-semibold text-slate-900">Published content performance</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{publishedContentRows.length} items</span>
                </div>
                {publishedContentRows.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Send content to students in Step 3 to populate this table.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                          <th className="pb-3 pr-4 font-semibold">Content</th>
                          <th className="pb-3 pr-4 font-semibold">Media</th>
                          <th className="pb-3 pr-4 font-semibold">Ratings</th>
                          <th className="pb-3 font-semibold">Sent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {publishedContentRows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-800">{row.title}</p>
                              <p className="mt-1 text-xs uppercase text-slate-400">{row.type} · {row.strategy ? getEngagementStrategyLabel(row.strategy) : "No strategy"}</p>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-wrap gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.mediaState.image ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>Image {row.mediaState.image ? "ready" : "missing"}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.mediaState.video ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>Video {row.mediaState.video ? "ready" : "missing"}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-800">{row.averageRating ? `${row.averageRating.toFixed(1)} / 5` : "—"}</p>
                              <p className="mt-1 text-xs text-slate-500">{row.ratingsCount} response{row.ratingsCount === 1 ? "" : "s"}</p>
                            </td>
                            <td className="py-3">
                              <p className="font-semibold text-slate-800">{row.publishedAt ? formatDate(row.publishedAt) : "Just now"}</p>
                              <p className="mt-1 text-xs text-slate-500">{row.publishedBy || "Teacher"}</p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Student table</p>
                    <h2 className="text-lg font-semibold text-slate-900">Latest student activity</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{dashboardStudents.length} students</span>
                </div>
                {dashboardStudents.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Student submissions appear here after the quiz is completed.</p>
                ) : (
                  <div className="mt-4 max-h-96 overflow-y-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                          <th className="pb-3 pr-4 font-semibold">Student</th>
                          <th className="pb-3 pr-4 font-semibold">Submitted</th>
                          <th className="pb-3 pr-4 font-semibold">Strategy</th>
                          <th className="pb-3 font-semibold">Ratings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardStudents.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-800">{row.name}</p>
                              {row.tldr && <p className="mt-1 text-xs text-slate-500">{row.tldr}</p>}
                            </td>
                            <td className="py-3 pr-4 text-slate-600">{formatDate(row.submittedAt)}</td>
                            <td className="py-3 pr-4 text-slate-600">{row.strategy ? getEngagementStrategyLabel(row.strategy) : "Not analyzed yet"}</td>
                            <td className="py-3 text-slate-600">{ratingsByStudent[row.id] ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">Student questions</p>
                  <h2 className="text-lg font-semibold text-slate-900">Questions from Content Review</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{dashboardReviewQuestions.length} students</span>
              </div>
              {dashboardReviewQuestions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Questions appear here after students write them during Content Review.</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {dashboardReviewQuestions.map((row) => (
                    <div key={row.studentId} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-800">{row.name}</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {row.questions.map((q, i) => (
                          <li key={i} className="text-sm text-slate-600">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
