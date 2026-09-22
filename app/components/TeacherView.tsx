"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { UserContext } from "@/lib/auth";
import { MOCK_USER_STORAGE_KEY, parseMockUserRole } from "@/lib/mock-auth";
import {
  engagementStrategies as strategies,
  getEngagementStrategyDescription,
  getEngagementStrategyLabel,
} from "@/lib/engagement-strategies";
import type {
  Plan,
  ContentItem,
  ImageState,
  ImageVersion,
  VideoState,
  StudentStrategyResult,
  Lesson,
  QuizItem,
  StudentAnswer,
  TextMode,
} from "@/lib/types";

const MAX_IMAGE_VERSIONS = 10;
const SSO_TOKEN_STORAGE_KEY = "engage-sso-token";

type Props = {
  user: UserContext;
};

type SharedContentMedia = {
  image?: string;
  video?: string;
};

type PublishableContentItem = ContentItem & {
  media?: SharedContentMedia;
};

type PublishedContentPayloadItem = {
  content_item_id?: string;
  content_json?: string;
  media?: SharedContentMedia;
};

type StrategyBatchResponse = {
  results?: StudentStrategyResult[];
  distribution?: Record<string, number>;
  errors?: Array<{ id?: string; name?: string; error?: string }>;
  error?: string;
};

type StrategyJobStartResponse = {
  jobId?: string;
  queuedStudents?: number;
  totalStudents?: number;
  status?: "queued";
  missingEnv?: string[];
  error?: string;
};

type StrategyJobStatusResponse = {
  job?: {
    jobId?: string;
    classId?: string;
    assignmentId?: string;
    totalStudents?: number;
    processedStudents?: number;
    completedStudents?: number;
    failedStudents?: number;
    status?: "queued" | "running" | "completed" | "completed_with_errors" | "failed_to_queue";
    errorMessage?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
  results?: StudentStrategyResult[];
  errors?: Array<{ id?: string; name?: string; error?: string }>;
  distribution?: Record<string, number>;
  error?: string;
};

type StrategyJobStatus = NonNullable<StrategyJobStatusResponse["job"]>["status"];

type CohortAnalysisRequestOptions = {
  forceRefresh?: boolean;
};

const COHORT_ANALYSIS_CHUNK_SIZE = 4;
const COHORT_ANALYSIS_MAX_ATTEMPTS = 2;
const COHORT_ANALYSIS_JOB_POLL_MS = 1500;

const collectPublishedMedia = (
  items: PublishedContentPayloadItem[] | undefined,
  contentIds: Set<string>,
) => {
  const restoredImages: Record<string, ImageState> = {};
  const restoredVideos: Record<string, VideoState> = {};

  for (const item of items ?? []) {
    const itemId = item.content_item_id;
    if (!itemId || !contentIds.has(itemId) || !item.media) continue;

    if (item.media.image) {
      restoredImages[itemId] = { status: "ready", url: item.media.image };
    }
    if (item.media.video) {
      restoredVideos[itemId] = { status: "ready", url: item.media.video };
    }
  }

  return { restoredImages, restoredVideos };
};


type PersistedDraft = {
  version: number;
  classId: string;
  assignmentId: string;
  lessonNumber: number | null;
  currentStep: number;
  plan: Plan | null;
  selectedStrategies: string[];
  annotationDecision: "agree" | "disagree" | null;
  annotationReason: string;
  annotationStatus: "idle" | "saved";
  content: ContentItem[];
  images?: Record<string, ImageState>;
  videos?: Record<string, VideoState>;
  selectedForPublish?: string[];
  publishedContentIds?: string[];
};


// Survives component unmount/remount during SPA navigation; cleared on full page refresh.
const imageHistoryCache = new Map<string, { history: ImageVersion[]; historyIndex: number }>();

const COHORT_STUDENT_ID = "cohort";

/** Merge cached/existing history into a restored ImageState. */
const mergeImageWithHistory = (
  itemId: string,
  base: ImageState,
  existingHistory?: ImageVersion[],
  existingIndex?: number,
): ImageState => {
  const cached = imageHistoryCache.get(itemId);
  const history = existingHistory?.length ? existingHistory : cached?.history;
  const historyIndex = existingHistory?.length ? (existingIndex ?? 0) : cached?.historyIndex;

  if (history?.length) {
    return { ...base, history, historyIndex: historyIndex ?? 0, url: history[historyIndex ?? 0]?.url ?? base.url };
  }
  if (base.url) {
    return { ...base, history: [{ url: base.url, createdAt: new Date().toISOString() }], historyIndex: 0 };
  }
  return base;
};

const LEGACY_DRAFT_STORAGE_KEY = "engage-agent:draft:v2";
const DRAFT_STORAGE_PREFIX = "engage-agent:draft:v3";
const DRAFT_VERSION = 2;

const clampStep = (value: number) => Math.min(3, Math.max(1, value));

const getDraftStorageKey = (classId: string, assignmentId: string) =>
  `${DRAFT_STORAGE_PREFIX}:${classId || "__no-class__"}:${assignmentId || "__no-assignment__"}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isQuotaExceededError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

const trimPersistedImageState = (state: ImageState): ImageState | null => {
  if (state.status === "error") {
    return { status: "error", error: state.error };
  }

  if (state.status === "ready" && state.url && !state.url.startsWith("data:")) {
    const trimmedHistory = state.history?.filter((v) => !v.url.startsWith("data:"));
    return {
      status: "ready",
      url: state.url,
      ...(trimmedHistory?.length ? { history: trimmedHistory, historyIndex: Math.min(state.historyIndex ?? 0, trimmedHistory.length - 1) } : {}),
    };
  }

  return null;
};

const trimPersistedVideoState = (state: VideoState): VideoState | null => {
  if (state.status === "loading") {
    return { status: "loading" };
  }

  if (state.status === "polling") {
    return { status: "polling", operationName: state.operationName };
  }

  if (state.status === "error") {
    return { status: "error", error: state.error };
  }

  if (state.status === "ready" && state.url && !state.url.startsWith("data:")) {
    return { status: "ready", url: state.url };
  }

  return null;
};

const getEmbeddablePublishedMediaUrl = (value: string | undefined) => {
  if (!value || value.startsWith("data:")) {
    return undefined;
  }
  return value;
};

const clearOtherDraftStorage = (keepKey: string) => {
  const keysToRemove: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key === LEGACY_DRAFT_STORAGE_KEY) {
      keysToRemove.push(key);
      continue;
    }
    if (key.startsWith(`${DRAFT_STORAGE_PREFIX}:`) && key !== keepKey) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
};

const CONTENT_TEXT_MODE_LABELS: Record<TextMode, string> = {
  questions: "Questions",
  phenomenon: "Phenomenon",
  dialogue: "Dialogue",
};

const isTextModeValue = (value: string): value is TextMode =>
  value === "questions" || value === "phenomenon" || value === "dialogue";

const parseJsonResponse = async <T,>(response: Response): Promise<T | null> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const formatStrategyBatchError = (
  status: number,
  message?: string,
) => {
  if (message) {
    return message;
  }

  if (status === 504) {
    return "A cohort analysis batch timed out before the server could finish. Try again; cached students will be reused.";
  }

  if (status === 502 || status === 503) {
    return "The server was temporarily unavailable during cohort analysis. Try again.";
  }

  return `Cohort analysis failed (HTTP ${status}).`;
};

const isTerminalCohortJobStatus = (
  status: StrategyJobStatus | undefined,
) =>
  status === "completed" ||
  status === "completed_with_errors" ||
  status === "failed_to_queue";

const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const getContentModeLabels = (item: ContentItem) => {
  if (item.textModes && item.textModes.length > 0) {
    return item.textModes.map((mode) => CONTENT_TEXT_MODE_LABELS[mode] ?? mode);
  }

  return item.type ? [item.type] : [];
};

const parsePersistedContentItem = (
  value: unknown,
  fallbackId?: string,
): ContentItem | null => {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id : fallbackId;
  const type = typeof value.type === "string" ? value.type : "";
  const title = typeof value.title === "string" ? value.title : "";
  const body = typeof value.body === "string" ? value.body : "";
  const strategy = typeof value.strategy === "string" ? value.strategy : "";
  const textModes = Array.isArray(value.textModes)
    ? value.textModes
        .filter((mode): mode is string => typeof mode === "string")
        .map((mode) => mode.trim().toLowerCase())
        .filter(isTextModeValue)
    : [];
  const visualBrief = typeof value.visualBrief === "string" ? value.visualBrief : undefined;

  if (!id || !title || !body) return null;

  return {
    id,
    type,
    title,
    body,
    strategy,
    ...(textModes.length > 0 ? { textModes } : {}),
    ...(visualBrief ? { visualBrief } : {}),
  };
};

const stepLabels = [
  "Assessment",
  "Strategy recommendation",
  "Content generation",
];

export default function TeacherView({ user }: Props) {
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const isMountedRef = useRef(true);
  const activeVideoPollersRef = useRef<Set<string>>(new Set());
  const classId = user.classId ?? "";
  const assignmentId = user.assignmentId ?? "";
  const hasAssignmentContext = Boolean(classId && assignmentId);
  const draftStorageKey = getDraftStorageKey(classId, assignmentId);

  // Lesson picker
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<number | null>(null);
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [quizStatus, setQuizStatus] = useState<"draft" | "published" | "closed">("draft");
  const [publishingQuiz, setPublishingQuiz] = useState(false);
  // Assessment step sub-tabs (quiz vs survey), mirrors the tab pattern in StudentView.
  const [assessmentTab, setAssessmentTab] = useState<"quiz" | "survey">("quiz");

  // Student answers
  const [studentAnswers, setStudentAnswers] = useState<StudentAnswer[]>([]);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [autoAnsweringTestStudents, setAutoAnsweringTestStudents] = useState(false);

  // Plan
  const [plan, setPlan] = useState<Plan | null>(null);

  // Content
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [images, setImages] = useState<Record<string, ImageState>>({});
  const [videos, setVideos] = useState<Record<string, VideoState>>({});
  const [focusImage, setFocusImage] = useState<{ url: string; title: string } | null>(null);
  const [focusVideo, setFocusVideo] = useState<{ url: string; title: string } | null>(null);

  // Refine modal
  const [refineTarget, setRefineTarget] = useState<{ itemId: string; title: string } | null>(null);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const refineImgRef = useRef<HTMLImageElement>(null);

  // Content publishing
  const [selectedForPublish, setSelectedForPublish] = useState<Set<string>>(new Set());
  const [publishingContent, setPublishingContent] = useState(false);
  const [publishedContentIds, setPublishedContentIds] = useState<Set<string>>(new Set());

  // Strategy
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([]);
  const [annotationDecision, setAnnotationDecision] = useState<"agree" | "disagree" | null>(null);
  const [annotationReason, setAnnotationReason] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [annotationError, setAnnotationError] = useState<string | null>(null);

  // Cohort
  const [cohortResults, setCohortResults] = useState<StudentStrategyResult[]>([]);
  const [cohortDistribution, setCohortDistribution] = useState<Record<string, number>>({});
  const [loadingCohort, setLoadingCohort] = useState(false);
  const [cohortProgress, setCohortProgress] = useState<{ processed: number; total: number; currentName: string }>({ processed: 0, total: 0, currentName: "" });
  const [showStudentRecommendations, setShowStudentRecommendations] = useState(false);
  const [showCohortHelp, setShowCohortHelp] = useState(false);
  const [openStrategyInfo, setOpenStrategyInfo] = useState<Set<string>>(new Set());


  // General
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isRestoringDraftMedia, setIsRestoringDraftMedia] = useState(false);
  const [isRestoringPublishedState, setIsRestoringPublishedState] = useState(false);
  const isRestoringStep3State = isRestoringDraftMedia || isRestoringPublishedState;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);



  const getStrategyLabel = getEngagementStrategyLabel;

  const getStrategyDescription = getEngagementStrategyDescription;

  const buildDraftSnapshot = useCallback(
    (nextVideos?: Record<string, VideoState>): PersistedDraft => {
      const serializableImages = Object.fromEntries(
        Object.entries(images)
          .map(([itemId, state]) => [itemId, trimPersistedImageState(state)] as const)
          .filter((entry): entry is [string, ImageState] => Boolean(entry[1])),
      );
      const serializableVideos = Object.fromEntries(
        Object.entries(nextVideos ?? videos)
          .map(([itemId, state]) => [itemId, trimPersistedVideoState(state)] as const)
          .filter((entry): entry is [string, VideoState] => Boolean(entry[1])),
      );

      return {
        version: DRAFT_VERSION,
        classId,
        assignmentId,
        lessonNumber: selectedLesson,
        currentStep: clampStep(currentStep),
        plan,
        selectedStrategies,
        annotationDecision,
        annotationReason,
        annotationStatus: annotationStatus === "saved" ? "saved" : "idle",
        content,
        images: serializableImages,
        videos: serializableVideos,
        selectedForPublish: Array.from(selectedForPublish),
        publishedContentIds: Array.from(publishedContentIds),
      };
    },
    [
      classId,
      assignmentId,
      selectedLesson,
      currentStep,
      plan,
      selectedStrategies,
      annotationDecision,
      annotationReason,
      annotationStatus,
      content,
      images,
      videos,
      selectedForPublish,
      publishedContentIds,
    ],
  );

  const persistDraftSnapshot = useCallback(
    (snapshot: PersistedDraft) => {
      const serialized = JSON.stringify(snapshot);

      try {
        localStorage.setItem(draftStorageKey, serialized);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
        return;
      } catch (error) {
        if (!isQuotaExceededError(error)) {
          console.warn("Failed to persist Engage Agent draft.", error);
          return;
        }
      }

      try {
        clearOtherDraftStorage(draftStorageKey);
        localStorage.setItem(draftStorageKey, serialized);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
        return;
      } catch (error) {
        if (!isQuotaExceededError(error)) {
          console.warn("Failed to persist Engage Agent draft after pruning old drafts.", error);
          return;
        }
      }

      try {
        const minimalSnapshot: PersistedDraft = {
          ...snapshot,
          images: {},
          videos: {},
        };
        localStorage.setItem(draftStorageKey, JSON.stringify(minimalSnapshot));
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to persist Engage Agent draft after trimming media state.", error);
      }
    },
    [draftStorageKey],
  );

  const toggleStrategyInfo = (strategyId: string) => {
    setOpenStrategyInfo((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const buildCohortDistribution = (results: StudentStrategyResult[]) => {
    const distribution: Record<string, number> = {};
    results.forEach((result) => {
      distribution[result.plan.strategy] = (distribution[result.plan.strategy] ?? 0) + 1;
    });
    return distribution;
  };

  const autoAnswerTestStudents = async () => {
    if (!classId || !assignmentId) {
      setError("Missing class or assignment context.");
      return;
    }

    setAutoAnsweringTestStudents(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (typeof window !== "undefined") {
        const token = window.sessionStorage.getItem(SSO_TOKEN_STORAGE_KEY);
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const mockRole = parseMockUserRole(
          window.sessionStorage.getItem(MOCK_USER_STORAGE_KEY),
        );
        if (mockRole) {
          headers["x-engage-mock-user"] = mockRole;
        }
      }

      const res = await fetch("/api/auto-answer-test-students", {
        method: "POST",
        headers,
        body: JSON.stringify({ classId, assignmentId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error ??
            "Failed to auto-answer test students.",
        );
      }

      await loadStudentAnswers();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to auto-answer test students.",
      );
    } finally {
      setAutoAnsweringTestStudents(false);
    }
  };

  const buildCohortMasterPlan = (
    results: StudentStrategyResult[],
    distribution: Record<string, number>,
  ): Plan | null => {
    if (results.length === 0) {
      return null;
    }

    const rankedStrategies = strategies
      .map((strategy) => {
        const matchingResults = results.filter((result) => result.plan.strategy === strategy.id);
        const averageRelevance = matchingResults.length > 0
          ? Math.round(
              matchingResults.reduce((sum, result) => sum + (result.plan.relevance?.[strategy.id] ?? 0), 0) / matchingResults.length,
            )
          : 0;

        return {
          id: strategy.id,
          label: strategy.label,
          count: distribution[strategy.id] ?? 0,
          averageRelevance,
          matchingResults,
        };
      })
      .sort((left, right) => right.count - left.count || right.averageRelevance - left.averageRelevance);

    const primary = rankedStrategies[0];
    const representative = primary.matchingResults
      .slice()
      .sort((left, right) => (right.plan.relevance?.[primary.id] ?? 0) - (left.plan.relevance?.[primary.id] ?? 0))[0] ?? results[0];

    const relevance = Object.fromEntries(
      strategies.map((strategy) => [
        strategy.id,
        Math.round(((distribution[strategy.id] ?? 0) / results.length) * 100),
      ]),
    ) as Record<string, number>;

    const supportingStrategies = rankedStrategies
      .filter((strategy) => strategy.id !== primary.id && strategy.count > 0)
      .map((strategy) => `${strategy.label} (${strategy.count})`);

    const lessonLabel = selectedLesson ? `Lesson ${selectedLesson}` : "this lesson";
    const cohortLabel = `${primary.count} of ${results.length} student${results.length === 1 ? '' : 's'}`;

    return {
      ...representative.plan,
      name: `${lessonLabel} Cohort Plan`,
      strategy: primary.id,
      relevance,
      overallRecommendation: `Use ${primary.label.toLowerCase()} as the lead strategy for this cohort.`,
      recommendationReason: supportingStrategies.length > 0
        ? `${cohortLabel} aligned most closely with ${primary.label}. Secondary patterns also appeared in ${supportingStrategies.join(', ')}, so start whole-class instruction with ${primary.label} and differentiate as needed.`
        : `${cohortLabel} aligned most closely with ${primary.label}, making it the clearest whole-class starting point from the submitted responses.`,
      summary: `${primary.label} is the best starting point for the current cohort.`,
      tldr: `Lead with ${primary.label.toLowerCase()} for this cohort.`,
      rationale: supportingStrategies.length > 0
        ? `Student-level analysis points to ${primary.label} as the dominant pattern across the submitted quiz responses. Launch whole-class content there first, then differentiate for students who may benefit from ${supportingStrategies.join(' or ')}.`
        : `Student-level analysis points to ${primary.label} as the dominant pattern across the submitted quiz responses. Launch whole-class content there first, then monitor which students need a different scaffold.`,
      cadence: representative.plan.cadence || 'Whole-class first, then differentiate',
      tactics: representative.plan.tactics?.length > 0 ? representative.plan.tactics : [
        `Start the class with a ${primary.label.toLowerCase()} prompt tied to ${lessonLabel}.`,
        'Ask students to explain their thinking before revealing the next support.',
        'Use the responses to decide which students need a follow-up scaffold.',
      ],
      checks: representative.plan.checks?.length > 0 ? representative.plan.checks : [
        'Check whether students can explain why the new idea fits better than their first response.',
      ],
    };
  };


  // Load lessons list
  useEffect(() => {
    fetch("/api/lessons/1")
      .then(() => {
        // Load all 8 lessons metadata
        const lessonList: Lesson[] = [];
        const promises = Array.from({ length: 8 }, (_, i) =>
          fetch(`/api/lessons/${i + 1}`)
            .then((r) => r.json())
            .then((data) => { lessonList[i] = data as Lesson; }),
        );
        Promise.all(promises).then(() => setLessons(lessonList.filter(Boolean)));
      })
      .catch(() => {});
  }, []);

  // Load quiz status on mount
  useEffect(() => {
    if (!classId || !assignmentId) return;
    fetch(`/api/quiz-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.quizStatus) {
          setSelectedLesson(data.quizStatus.lesson_number);
          setQuizStatus(data.quizStatus.status);
          // Load quiz items for this lesson
          fetch(`/api/lessons/${data.quizStatus.lesson_number}`)
            .then((r) => r.json())
            .then((lesson) => setQuizItems(lesson.quiz_items ?? []));
        }
      })
      .catch(() => {});
  }, [classId, assignmentId]);


  // Load draft from localStorage
  useEffect(() => {
    const scopedRaw = localStorage.getItem(draftStorageKey);
    const legacyRaw = scopedRaw ? null : localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
    const raw = scopedRaw ?? legacyRaw;
    let matchedDraft = false;
    let shouldRestorePersistedMedia = false;

    setSelectedLesson(null);
    setPlan(null);
    setSelectedStrategies([]);
    setAnnotationDecision(null);
    setAnnotationReason("");
    setAnnotationStatus("idle");
    setContent([]);
    setImages({});
    setVideos({});
    setSelectedForPublish(new Set());
    setPublishedContentIds(new Set());
    setCurrentStep(1);

    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && parsed.version === DRAFT_VERSION && parsed.classId === classId && parsed.assignmentId === assignmentId) {
          matchedDraft = true;
          const draft = parsed as PersistedDraft;
          const restoredContent = draft.content ?? [];
          const contentIds = new Set(restoredContent.map((item) => item.id));
          const restoredImages = Object.fromEntries(
            Object.entries(draft.images ?? {}).filter(
              ([itemId, state]) =>
                contentIds.has(itemId) &&
                (
                  state.status === "error" ||
                  (state.status === "ready" && Boolean(state.url))
                ),
            ).map(([itemId, state]) => {
              if (state.status === "ready") return [itemId, mergeImageWithHistory(itemId, state, state.history, state.historyIndex)];
              return [itemId, state];
            }),
          ) as Record<string, ImageState>;
          const restoredVideos = Object.fromEntries(
            Object.entries(draft.videos ?? {}).filter(
              ([itemId, state]) =>
                contentIds.has(itemId) &&
                (
                  state.status === "loading" ||
                  state.status === "polling" ||
                  state.status === "error" ||
                  (state.status === "ready" && Boolean(state.url))
                ),
            ),
          ) as Record<string, VideoState>;

          setSelectedLesson(draft.lessonNumber);
          setPlan(draft.plan);
          setSelectedStrategies(draft.selectedStrategies ?? []);
          setAnnotationDecision(draft.annotationDecision);
          setAnnotationReason(draft.annotationReason ?? "");
          setAnnotationStatus(draft.annotationStatus ?? "idle");
          setContent(restoredContent);
          const mergedImages = { ...restoredImages };
          for (const item of restoredContent) {
            if (!mergedImages[item.id]) {
              const cached = imageHistoryCache.get(item.id);
              if (cached) mergedImages[item.id] = mergeImageWithHistory(item.id, { status: "ready" });
            }
          }
          setImages(mergedImages);
          setVideos(restoredVideos);
          setSelectedForPublish(new Set((draft.selectedForPublish ?? []).filter((itemId) => contentIds.has(itemId))));
          setPublishedContentIds(new Set((draft.publishedContentIds ?? []).filter((itemId) => contentIds.has(itemId))));
          setCurrentStep(clampStep(draft.currentStep));

          shouldRestorePersistedMedia = restoredContent.length > 0 && Boolean(classId && assignmentId);

          if (legacyRaw) {
            persistDraftSnapshot(draft);
          }
        }
      } catch {}
    }

    setIsRestoringDraftMedia(matchedDraft && shouldRestorePersistedMedia);
    setIsHydrated(true);
  }, [classId, assignmentId, draftStorageKey, persistDraftSnapshot]);

  // Persist draft
  useEffect(() => {
    if (!isHydrated) return;
    const timeout = window.setTimeout(() => {
      persistDraftSnapshot(buildDraftSnapshot());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [isHydrated, buildDraftSnapshot, persistDraftSnapshot]);

  useEffect(() => {
    if (!isHydrated) return;
    const hasPendingVideos = Object.values(videos).some(
      (state) => state.status === "loading" || state.status === "polling",
    );
    if (!hasPendingVideos) return;
    persistDraftSnapshot(buildDraftSnapshot());
  }, [isHydrated, videos, buildDraftSnapshot, persistDraftSnapshot]);

  // Sync image history to module-level cache so it survives SPA navigation
  useEffect(() => {
    for (const [itemId, state] of Object.entries(images)) {
      if (state.history?.length) {
        imageHistoryCache.set(itemId, { history: state.history, historyIndex: state.historyIndex ?? 0 });
      }
    }
  }, [images]);

  // Restore persisted Step 3 media/publish state before any regeneration kicks in.
  useEffect(() => {
    if (!isRestoringDraftMedia || !content.length || !classId || !assignmentId) return;

    let cancelled = false;
    const contentIds = new Set(content.map((item) => item.id));

    const restorePersistedStep3State = async () => {
      try {
        const [mediaRes, publishRes] = await Promise.all([
          fetch(`/api/media?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${COHORT_STUDENT_ID}`),
          fetch(`/api/content-publish?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`),
        ]);

        if (cancelled) return;

        if (mediaRes.ok) {
          const mediaData = (await mediaRes.json()) as {
            results?: Array<{
              content_item_id?: string;
              media_type?: "image" | "video";
              data_url?: string;
            }>;
          };

          const persistedImages: Record<string, ImageState> = {};
          const persistedVideos: Record<string, VideoState> = {};

          for (const record of mediaData.results ?? []) {
            const itemId = record.content_item_id;
            if (!itemId || !contentIds.has(itemId) || !record.data_url) continue;
            if (record.media_type === "image") {
              // Build history from DB versions if available
              const dbVersions = (record as { versions?: Array<{ data_url?: string; refinement_prompt?: string; created_at?: string }> }).versions;
              const activeIdx = (record as { active_version?: number }).active_version;
              if (dbVersions?.length) {
                const history: ImageVersion[] = dbVersions
                  .filter((v: { data_url?: string }) => v.data_url)
                  .map((v: { data_url?: string; refinement_prompt?: string; created_at?: string }) => ({
                    url: v.data_url!,
                    refinementPrompt: v.refinement_prompt,
                    createdAt: v.created_at ?? "",
                  }));
                const idx = Math.min(activeIdx ?? history.length - 1, history.length - 1);
                persistedImages[itemId] = {
                  status: "ready",
                  url: history[idx]?.url ?? record.data_url,
                  history,
                  historyIndex: idx,
                };
              } else {
                persistedImages[itemId] = { status: "ready", url: record.data_url };
              }
            }
            if (record.media_type === "video") {
              persistedVideos[itemId] = { status: "ready", url: record.data_url };
            }
          }

          setImages((prev) => {
            const merged = { ...prev };
            for (const [itemId, persisted] of Object.entries(persistedImages)) {
              merged[itemId] = persisted;
            }
            return merged;
          });
          setVideos((prev) => ({ ...prev, ...persistedVideos }));
        }

        if (publishRes.ok) {
          const publishData = (await publishRes.json()) as {
            items?: PublishedContentPayloadItem[];
          };
          const publishedMedia = collectPublishedMedia(publishData.items, contentIds);
          setImages((prev) => ({ ...prev, ...publishedMedia.restoredImages }));
          setVideos((prev) => ({ ...prev, ...publishedMedia.restoredVideos }));
          setPublishedContentIds(
            new Set(
              (publishData.items ?? [])
                .map((item) => item.content_item_id)
                .filter((itemId): itemId is string => typeof itemId === "string" && contentIds.has(itemId)),
            ),
          );
        }

        setSelectedForPublish((prev) => new Set(Array.from(prev).filter((itemId) => contentIds.has(itemId))));
      } catch {
        // Draft media restore is best-effort; missing persisted media should simply fall back to generation.
      } finally {
        if (!cancelled) {
          setIsRestoringDraftMedia(false);
        }
      }
    };

    void restorePersistedStep3State();

    return () => {
      cancelled = true;
    };
  }, [isRestoringDraftMedia, content, classId, assignmentId]);


  // If there is no local draft for this assignment, fall back to previously published Step 3 content.
  useEffect(() => {
    if (!isHydrated || isRestoringDraftMedia || content.length > 0 || !classId || !assignmentId) return;

    let cancelled = false;
    setIsRestoringPublishedState(true);

    const restorePublishedStep3State = async () => {
      try {
        const publishRes = await fetch(
          `/api/content-publish?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
        );
        if (!publishRes.ok) {
          return;
        }

        const publishData = (await publishRes.json()) as {
          items?: PublishedContentPayloadItem[];
        };

        if (cancelled) return;

        const restoredContent = (publishData.items ?? [])
          .map((item) => {
            if (typeof item.content_json !== "string") return null;
            try {
              return parsePersistedContentItem(
                JSON.parse(item.content_json),
                item.content_item_id,
              );
            } catch {
              return null;
            }
          })
          .filter((item): item is ContentItem => Boolean(item))
          .sort((left, right) => left.id.localeCompare(right.id));

        if (restoredContent.length === 0) {
          return;
        }

        const contentIds = new Set(restoredContent.map((item) => item.id));
        const mediaRes = await fetch(
          `/api/media?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${COHORT_STUDENT_ID}`,
        );

        if (cancelled) return;

        const publishedMedia = collectPublishedMedia(publishData.items, contentIds);
        const restoredImages: Record<string, ImageState> = {
          ...publishedMedia.restoredImages,
        };
        const restoredVideos: Record<string, VideoState> = {
          ...publishedMedia.restoredVideos,
        };

        if (mediaRes.ok) {
          const mediaData = (await mediaRes.json()) as {
            results?: Array<{
              content_item_id?: string;
              media_type?: "image" | "video";
              data_url?: string;
            }>;
          };

          for (const record of mediaData.results ?? []) {
            const itemId = record.content_item_id;
            if (!itemId || !contentIds.has(itemId) || !record.data_url) continue;
            if (record.media_type === "image") {
              restoredImages[itemId] = { status: "ready", url: record.data_url };
            }
            if (record.media_type === "video") {
              restoredVideos[itemId] = { status: "ready", url: record.data_url };
            }
          }
        }

        const restoredStrategies = Array.from(
          new Set(
            restoredContent
              .map((item) => item.strategy)
              .filter((strategy): strategy is string => typeof strategy === "string" && strategy.length > 0),
          ),
        );
        const publishedIds = restoredContent.map((item) => item.id);

        setContent(restoredContent);
        const imagesWithHistory: Record<string, ImageState> = {};
        for (const [itemId, state] of Object.entries(restoredImages)) {
          imagesWithHistory[itemId] = mergeImageWithHistory(itemId, state);
        }
        setImages(imagesWithHistory);
        setVideos(restoredVideos);
        setSelectedForPublish(new Set(publishedIds));
        setPublishedContentIds(new Set(publishedIds));
        setSelectedStrategies((prev) => (prev.length > 0 ? prev : restoredStrategies));
        setCurrentStep(3);
      } catch {
        // Published restore is best-effort; keep the empty state if nothing can be recovered.
      } finally {
        if (!cancelled) {
          setIsRestoringPublishedState(false);
        }
      }
    };

    void restorePublishedStep3State();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, isRestoringDraftMedia, content.length, classId, assignmentId]);

  const pollVideoUntilComplete = useCallback(
    async (itemId: string, requestId: string) => {
      if (!requestId || !classId || !assignmentId) return;
      if (activeVideoPollersRef.current.has(itemId)) return;

      activeVideoPollersRef.current.add(itemId);

      try {
        let result: { done: boolean; url?: string; error?: string } = { done: false };
        let pollCount = 0;

        while (!result.done && pollCount < 120) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          if (!isMountedRef.current) {
            return;
          }

          pollCount++;
          const params = new URLSearchParams({
            requestId,
            contentItemId: itemId,
            classId,
            assignmentId,
            studentId: COHORT_STUDENT_ID,
          });
          const res = await fetch(`/api/engagement-video/status?${params}`);
          const data = (await res.json()) as {
            done?: boolean;
            url?: string;
            error?: string;
            transient?: boolean;
          };

          if (!res.ok) {
            if (data.transient) {
              continue;
            }
            result = {
              done: true,
              error: data.error ?? "Failed to check video status.",
            };
            break;
          }

          result = {
            done: Boolean(data.done),
            url: data.url,
            error: data.error,
          };
        }

        if (!isMountedRef.current) {
          return;
        }

        if (result.done && result.url) {
          setVideos((prev) => ({ ...prev, [itemId]: { status: "ready", url: result.url } }));
          return;
        }

        setVideos((prev) => ({
          ...prev,
          [itemId]: {
            status: "error",
            error: result.error ?? "Timed out.",
          },
        }));
      } catch (err) {
        if (!isMountedRef.current) {
          return;
        }
        setVideos((prev) => ({
          ...prev,
          [itemId]: {
            status: "error",
            error: err instanceof Error ? err.message : "Video failed.",
          },
        }));
      } finally {
        activeVideoPollersRef.current.delete(itemId);
      }
    },
    [assignmentId, classId],
  );

  useEffect(() => {
    if (isRestoringStep3State || !content.length) return;

    for (const item of content) {
      const state = videos[item.id];
      if (state?.status === "polling" && state.operationName) {
        void pollVideoUntilComplete(item.id, state.operationName);
      }
    }
  }, [content, videos, isRestoringStep3State, pollVideoUntilComplete]);

  const selectLesson = async (lessonNumber: number) => {
    setSelectedLesson(lessonNumber);
    setPlan(null);
    setSelectedStrategies([]);
    setAnnotationDecision(null);
    setAnnotationReason("");
    setAnnotationStatus("idle");
    setContent([]);
    setImages({});
    setVideos({});
    setSelectedForPublish(new Set());
    setPublishedContentIds(new Set());
    setCohortResults([]);
    setCohortDistribution({});
    const res = await fetch(`/api/lessons/${lessonNumber}`);
    const data = await res.json();
    setQuizItems(data.quiz_items ?? []);
    // Save as draft
    if (classId && assignmentId) {
      await fetch("/api/quiz-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, assignmentId, lessonNumber, status: "draft", publishedBy: user.userId }),
      });
      setQuizStatus("draft");
    }
  };

  const publishQuiz = async () => {
    setError(null);

    if (!selectedLesson) {
      setError("Select a lesson before publishing the quiz.");
      return;
    }

    if (!classId || !assignmentId) {
      setError(
        "This preview is missing class or assignment context. Open the Engage Agent from a class assignment in GENIUS to publish to students.",
      );
      return;
    }

    setPublishingQuiz(true);
    try {
      const response = await fetch("/api/quiz-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, assignmentId, lessonNumber: selectedLesson, status: "published", publishedBy: user.userId }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          (data as { error?: string }).error ?? "Failed to publish quiz.",
        );
      }

      setQuizStatus("published");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to publish quiz.",
      );
    } finally {
      setPublishingQuiz(false);
    }
  };

  const loadStudentAnswers = async (options?: { silent?: boolean }) => {
    if (!classId || !assignmentId || !selectedLesson) return;
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoadingAnswers(true);
    }
    try {
      const res = await fetch(`/api/student-answers?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&lessonNumber=${encodeURIComponent(selectedLesson)}`);
      const data = await res.json();
      setStudentAnswers(data.answers ?? []);
    } catch {
      setError("Failed to load student answers.");
    } finally {
      if (!silent) {
        setLoadingAnswers(false);
      }
    }
  };

  // Refresh student answers when entering step 2, then poll while the quiz is live.
  useEffect(() => {
    if (currentStep !== 2 || quizStatus !== "published" || !classId || !assignmentId) {
      return;
    }

    loadStudentAnswers();

    const intervalId = window.setInterval(() => {
      void loadStudentAnswers({ silent: true });
    }, 10000);

    return () => window.clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, quizStatus, classId, assignmentId, selectedLesson]);

  useEffect(() => {
    if (!loadingCohort) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [loadingCohort]);

  const runSynchronousCohortAnalysis = async ({
    forceRefresh,
    lessonNumber,
    studentsForApi,
    uncachedStudents,
    resultsMap,
  }: {
    forceRefresh: boolean;
    lessonNumber: number;
    studentsForApi: Array<{
      id: string;
      name: string;
      assignment?: string;
      answers: Record<string, string | undefined>;
    }>;
    uncachedStudents: Array<{
      id: string;
      name: string;
      assignment?: string;
      answers: Record<string, string | undefined>;
    }>;
    resultsMap: Map<string, StudentStrategyResult>;
  }) => {
    const actionLabel = forceRefresh ? "Reanalyzing" : "Analyzing";
    const studentScopeLabel = forceRefresh ? "students" : "uncached students";
    const studentChunks = chunkItems(
      uncachedStudents,
      COHORT_ANALYSIS_CHUNK_SIZE,
    );

    for (let chunkIndex = 0; chunkIndex < studentChunks.length; chunkIndex += 1) {
      let pendingStudents = studentChunks[chunkIndex];

      for (let attempt = 1; attempt <= COHORT_ANALYSIS_MAX_ATTEMPTS; attempt += 1) {
        const batchStart = chunkIndex * COHORT_ANALYSIS_CHUNK_SIZE + 1;
        const batchEnd = Math.min(
          batchStart + pendingStudents.length - 1,
          uncachedStudents.length,
        );

        setCohortProgress({
          processed: resultsMap.size,
          total: studentsForApi.length,
          currentName:
            attempt === 1
              ? `${actionLabel} batch ${chunkIndex + 1} of ${studentChunks.length} (${batchStart}-${batchEnd} of ${uncachedStudents.length} ${studentScopeLabel})...`
              : `Retrying ${pendingStudents.length} student${pendingStudents.length === 1 ? "" : "s"} in batch ${chunkIndex + 1} of ${studentChunks.length}...`,
        });

        const res = await fetch("/api/strategy-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            students: pendingStudents,
            classId,
            assignmentId,
            lessonNumber,
            forceRefresh,
          }),
        });
        const data = await parseJsonResponse<StrategyBatchResponse>(res);

        for (const result of data?.results ?? []) {
          resultsMap.set(result.id, result);
        }

        const orderedResults = studentsForApi
          .filter((student) => resultsMap.has(student.id))
          .map((student) => resultsMap.get(student.id) as StudentStrategyResult);
        setCohortResults(orderedResults);
        setCohortProgress({
          processed: orderedResults.length,
          total: studentsForApi.length,
          currentName:
            orderedResults.length < studentsForApi.length
              ? `Completed ${orderedResults.length} of ${studentsForApi.length} students.`
              : "Finalizing cohort recommendation...",
        });

        const failedStudents = pendingStudents.filter((student) =>
          (data?.errors ?? []).some((error) => error.id === student.id),
        );

        if (res.ok && failedStudents.length === 0) {
          break;
        }

        const isRetryable =
          res.status === 0 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          failedStudents.length > 0;
        if (isRetryable && attempt < COHORT_ANALYSIS_MAX_ATTEMPTS) {
          pendingStudents = failedStudents.length > 0 ? failedStudents : pendingStudents;
          await delay(1000 * attempt);
          continue;
        }

        if (failedStudents.length > 0) {
          const failedNames = failedStudents.map((student) => student.name).join(", ");
          throw new Error(
            `Failed to analyze ${failedStudents.length} student${failedStudents.length === 1 ? "" : "s"} after retry: ${failedNames}.`,
          );
        }

        if (!res.ok) {
          throw new Error(
            formatStrategyBatchError(res.status, data?.error),
          );
        }

        throw new Error("Cohort analysis returned an invalid response.");
      }
    }
  };

  const requestCohortAnalysis = async ({
    forceRefresh = false,
  }: CohortAnalysisRequestOptions = {}) => {
    if (!classId || !assignmentId) return;
    if (!selectedLesson) {
      setError("Select a lesson before generating strategies.");
      return;
    }
    const lessonNumber = selectedLesson;
    if (studentAnswers.length === 0) {
      setError("No student answers available. Wait for students to submit.");
      return;
    }

    setLoadingCohort(true);
    setError(null);
    setPlan(null);
    setSelectedStrategies([]);
    setContent([]);
    setImages({});
    setVideos({});
    imageHistoryCache.clear();
    setSelectedForPublish(new Set());
    setCohortResults([]);
    setCohortDistribution({});
    setCohortProgress({
      processed: 0,
      total: studentAnswers.length,
      currentName: forceRefresh
        ? "Starting cohort reanalysis..."
        : "Loading cache...",
    });

    try {
      let cohortWarning: string | null = null;
      const studentsForApi = studentAnswers.map((sa) => ({
        id: sa.student_id,
        name: sa.student_name,
        assignment: `Lesson ${lessonNumber}`,
        answers: sa.answers,
      }));

      const cacheUrl = `/api/strategy-cache?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&lessonNumber=${encodeURIComponent(lessonNumber)}`;
      let cacheData: { results?: Array<{ studentId?: string; plan?: unknown }> } = { results: [] };
      if (!forceRefresh) {
        const cacheRes = await fetch(cacheUrl);
        if (cacheRes.ok) {
          cacheData = await cacheRes.json();
        }
      }

      const cachedMap = new Map<string, Plan>();
      for (const entry of cacheData.results ?? []) {
        if (entry.studentId && entry.plan) {
          cachedMap.set(entry.studentId, entry.plan as Plan);
        }
      }

      const resultsMap = new Map<string, StudentStrategyResult>();
      for (const student of studentsForApi) {
        const cached = cachedMap.get(student.id);
        if (!cached) continue;
        resultsMap.set(student.id, { id: student.id, name: student.name, plan: cached });
      }

      const initialResults = studentsForApi
        .filter((student) => resultsMap.has(student.id))
        .map((student) => resultsMap.get(student.id) as StudentStrategyResult);
      setCohortResults(initialResults);
      setCohortProgress({
        processed: initialResults.length,
        total: studentsForApi.length,
        currentName:
          initialResults.length > 0
            ? `Loaded ${initialResults.length} cached student${initialResults.length === 1 ? "" : "s"}.`
            : forceRefresh
              ? "Starting cohort reanalysis..."
              : "Starting cohort analysis...",
      });

      const uncachedStudents = forceRefresh
        ? studentsForApi
        : studentsForApi.filter(
            (student) => !cachedMap.has(student.id),
          );
      if (uncachedStudents.length > 0) {
        const startRes = await fetch("/api/strategy-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            students: uncachedStudents,
            classId,
            assignmentId,
            lessonNumber,
            forceRefresh,
          }),
        });
        const startData = await parseJsonResponse<StrategyJobStartResponse>(startRes);

        if (startRes.status === 501) {
          const missingEnv = (startData?.missingEnv ?? [])
            .filter((name) => typeof name === "string" && name.length > 0);
          cohortWarning =
            missingEnv.length > 0
              ? `Cohort analysis queue is not configured on this environment (${missingEnv.join(", ")}). Running inline ${forceRefresh ? "reanalysis" : "analysis"} instead.`
              : `${startData?.error ?? "Cohort analysis queue is not configured on this environment."} Running inline ${forceRefresh ? "reanalysis" : "analysis"} instead.`;
          setCohortProgress({
            processed: initialResults.length,
            total: studentsForApi.length,
            currentName: forceRefresh
              ? "Queue not configured here; reanalyzing inline instead..."
              : "Queue not configured here; analyzing inline instead...",
          });
          await runSynchronousCohortAnalysis({
            forceRefresh,
            lessonNumber,
            studentsForApi,
            uncachedStudents,
            resultsMap,
          });
        } else {
          if (!startRes.ok || !startData?.jobId) {
            throw new Error(
              startData?.error ?? "Failed to start cohort analysis.",
            );
          }

          for (;;) {
            const statusRes = await fetch(
              `/api/strategy-job/${encodeURIComponent(startData.jobId)}`,
              {
                cache: "no-store",
              },
            );
            const statusData = await parseJsonResponse<StrategyJobStatusResponse>(statusRes);

            if (!statusRes.ok || !statusData?.job) {
              throw new Error(
                statusData?.error ?? "Failed to load cohort analysis status.",
              );
            }

            for (const result of statusData.results ?? []) {
              resultsMap.set(result.id, result);
            }

            const orderedResults = studentsForApi
              .filter((student) => resultsMap.has(student.id))
              .map((student) => resultsMap.get(student.id) as StudentStrategyResult);
            setCohortResults(orderedResults);

            const processedStudents = statusData.job.processedStudents ?? 0;
            const queuedStudents = statusData.job.totalStudents ?? uncachedStudents.length;
            const terminal = isTerminalCohortJobStatus(statusData.job.status);

            setCohortProgress({
              processed: Math.min(
                studentsForApi.length,
                initialResults.length + processedStudents,
              ),
              total: studentsForApi.length,
              currentName: terminal
                ? "Finalizing cohort recommendation..."
                : statusData.job.status === "queued"
                  ? forceRefresh
                    ? `Queued ${queuedStudents} student${queuedStudents === 1 ? "" : "s"} for reanalysis...`
                    : `Queued ${queuedStudents} uncached student${queuedStudents === 1 ? "" : "s"} for analysis...`
                  : forceRefresh
                    ? `Reanalyzing ${processedStudents} of ${queuedStudents} student${queuedStudents === 1 ? "" : "s"}...`
                    : `Analyzing ${processedStudents} of ${queuedStudents} uncached student${queuedStudents === 1 ? "" : "s"}...`,
            });

            if (terminal) {
              if (statusData.job.status === "failed_to_queue") {
                throw new Error(
                  statusData.job.errorMessage ?? "Failed to queue cohort analysis.",
                );
              }

              if ((statusData.job.failedStudents ?? 0) > 0) {
                const failedNames = (statusData.errors ?? [])
                  .map((error) => error.name)
                  .filter((name): name is string => Boolean(name))
                  .join(", ");
                cohortWarning =
                  failedNames.length > 0
                    ? `Finished with ${statusData.job.failedStudents} failed student${statusData.job.failedStudents === 1 ? "" : "s"}: ${failedNames}.`
                    : `Finished with ${statusData.job.failedStudents} failed student${statusData.job.failedStudents === 1 ? "" : "s"}.`;
              }

              break;
            }

            await delay(COHORT_ANALYSIS_JOB_POLL_MS);
          }
        }
      }

      const results = studentsForApi
        .filter((student) => resultsMap.has(student.id))
        .map((student) => resultsMap.get(student.id) as StudentStrategyResult);

      const distribution = buildCohortDistribution(results);
      const masterPlan = buildCohortMasterPlan(results, distribution);

      setCohortResults(results);
      setCohortDistribution(distribution);
      setCohortProgress({ processed: studentsForApi.length, total: studentsForApi.length, currentName: "" });

      if (masterPlan) {
        setPlan(masterPlan);
        setSelectedStrategies([masterPlan.strategy]);
      }

      if (cohortWarning) {
        setError(cohortWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingCohort(false);
    }
  };

  const requestContent = async () => {
    if (!plan || selectedStrategies.length === 0) return;
    if (!selectedLesson) {
      setError("Select a lesson before generating content.");
      return;
    }
    setLoadingContent(true);
    setError(null);
    setContent([]);
    try {
      // Two-tier model strategy: first attempt uses the primary model
      // (gpt-5-mini, higher quality). If it returns an error status — most
      // commonly the Amplify 29s API Gateway 504 — retry once with
      // `fallback: true`, which flips the route to gpt-4o-mini (p95 ~3s).
      // Primary usually succeeds, so users almost never notice the retry;
      // on the rare failure they wait a bit longer but still get content.
      const callContent = (useFallback: boolean) =>
        fetch("/api/engagement-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonNumber: selectedLesson,
            selectedStrategies,
            ...(useFallback ? { fallback: true } : {}),
          }),
        });
      let res = await callContent(false);
      if (!res.ok) {
        console.warn(
          `[engagement-content] primary attempt failed (HTTP ${res.status}); retrying with fallback model`,
        );
        res = await callContent(true);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>)?.error ?? "Failed to generate content.");
      }
      const data = await res.json();
      const items = (data.items ?? []).map(
        (item: Omit<ContentItem, "id">, index: number) => ({
          ...item,
          id: `${item.strategy ?? "strategy"}-${index}-${item.title}`,
        }),
      );
      setContent(items);
      setImages({});
      setVideos({});
      imageHistoryCache.clear();
      setSelectedForPublish(new Set());
      setCurrentStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingContent(false);
    }
  };

  const toggleStrategySelection = (strategyId: string) => {
    setSelectedStrategies((prev) =>
      prev.includes(strategyId) ? prev.filter((s) => s !== strategyId) : [...prev, strategyId],
    );
  };

  const submitAnnotation = async () => {
    if (!plan || !annotationDecision) {
      setAnnotationError("Please choose agree or disagree.");
      setAnnotationStatus("error");
      return;
    }
    if (annotationDecision === "disagree" && !annotationReason.trim()) {
      setAnnotationError("Please add the reason you disagree.");
      setAnnotationStatus("error");
      return;
    }

    setAnnotationStatus("saving");
    setAnnotationError(null);
    try {
      const res = await fetch("/api/teacher-annotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: null,
          classId,
          assignmentId,
          assignment: selectedLesson ? `Lesson ${selectedLesson}` : null,
          overallRecommendation: plan.overallRecommendation,
          recommendationReason: plan.recommendationReason,
          decision: annotationDecision,
          reason: annotationReason.trim() || null,
          aiPlan: plan,
          selectedStrategies,
          answers: {},
        }),
      });
      if (!res.ok) throw new Error("Failed to save annotation.");
      setAnnotationStatus("saved");
    } catch (err) {
      setAnnotationError(err instanceof Error ? err.message : "Failed to save.");
      setAnnotationStatus("error");
    }
  };

  const toggleContentForPublish = (itemId: string) => {
    setSelectedForPublish((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const publishSelectedContent = async () => {
    if (selectedForPublish.size === 0 || !classId || !assignmentId) return;
    setPublishingContent(true);
    try {
      const items: PublishableContentItem[] = content
        .filter((item) => selectedForPublish.has(item.id))
        .map((item) => {
          const imageUrl =
            images[item.id]?.status === "ready"
              ? getEmbeddablePublishedMediaUrl(images[item.id]?.url)
              : undefined;
          const videoUrl =
            videos[item.id]?.status === "ready"
              ? getEmbeddablePublishedMediaUrl(videos[item.id]?.url)
              : undefined;

          const media: SharedContentMedia = {
            ...(imageUrl ? { image: imageUrl } : {}),
            ...(videoUrl ? { video: videoUrl } : {}),
          };

          return {
            ...item,
            ...(Object.keys(media).length > 0 ? { media } : {}),
          };
        });

      const res = await fetch("/api/content-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, assignmentId, contentItems: items, publishedBy: user.userId }),
      });
      if (!res.ok) throw new Error("Failed to publish content.");
      setPublishedContentIds((prev) => {
        const next = new Set(prev);
        for (const id of selectedForPublish) next.add(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish content.");
    } finally {
      setPublishingContent(false);
    }
  };

  // Image generation effect
  useEffect(() => {
    if (isRestoringStep3State || !content.length || !selectedLesson) return;
    const pending = content.filter((item) => !images[item.id]?.status);
    if (pending.length === 0) return;

    setImages((prev) => {
      const next = { ...prev };
      for (const item of pending) next[item.id] = { ...prev[item.id], status: "loading" };
      return next;
    });

    let cancelled = false;
    (async () => {
      for (const item of pending) {
        if (cancelled) break;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch("/api/engagement-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ item, lessonNumber: selectedLesson, classId, assignmentId, studentId: COHORT_STUDENT_ID }),
            });
            const text = await res.text();
            let data: Record<string, unknown>;
            try { data = JSON.parse(text); } catch { throw new Error(`Image request failed (${res.status}): ${text.slice(0, 120)}`); }
            if (!res.ok) throw new Error((data?.error as string) ?? "Failed to generate image.");
            lastError = null;
            if (!cancelled) {
              const newUrl = data.url as string;
              setImages((prev) => {
                if (prev[item.id]?.history?.length) {
                  return { ...prev, [item.id]: { ...prev[item.id], status: "ready", url: newUrl } };
                }
                return {
                  ...prev,
                  [item.id]: {
                    status: "ready",
                    url: newUrl,
                    history: [{ url: newUrl, createdAt: new Date().toISOString() }],
                    historyIndex: 0,
                  },
                };
              });
            }
            break; // success — skip retry
          } catch (err) {
            lastError = err instanceof Error ? err : new Error("Image failed.");
            // Retry once on timeout/network errors
          }
        }
        if (lastError && !cancelled) {
          setImages((prev) => ({ ...prev, [item.id]: { status: "error", error: lastError!.message } }));
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, isRestoringStep3State, selectedLesson]);

  const requestVideo = async (item: ContentItem) => {
    const imageUrl = images[item.id]?.url;
    if (!imageUrl) return;

    setVideos((prev) => ({ ...prev, [item.id]: { status: "loading" } }));
    try {
      const startRes = await fetch("/api/engagement-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, plan, answers: {}, imageUrl }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData?.error ?? "Failed to start video.");

      const requestId = typeof startData?.requestId === "string" ? startData.requestId : "";
      if (!requestId) {
        throw new Error("Video request started but returned no request id.");
      }

      setVideos((prev) => ({ ...prev, [item.id]: { status: "polling", operationName: requestId } }));
      void pollVideoUntilComplete(item.id, requestId);
    } catch (err) {
      setVideos((prev) => ({ ...prev, [item.id]: { status: "error", error: err instanceof Error ? err.message : "Video failed." } }));
    }
  };

  const downloadFile = (url: string, filename: string) => {
    const anchor = downloadRef.current;
    if (!anchor) return;
    if (url.startsWith("data:")) {
      const [header, base64] = url.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } else {
      anchor.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      anchor.download = filename;
      anchor.click();
    }
  };

  const persistDebounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const persistActiveVersion = (itemId: string, versionIndex: number) => {
    if (!classId || !assignmentId) return;
    const timers = persistDebounceTimers.current;
    const existing = timers.get(itemId);
    if (existing) clearTimeout(existing);
    timers.set(itemId, setTimeout(async () => {
      timers.delete(itemId);
      try {
        await fetch("/api/media", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId,
            assignmentId,
            studentId: COHORT_STUDENT_ID,
            contentItemId: itemId,
            mediaType: "image",
            versionIndex,
          }),
        });
      } catch { /* best-effort */ }
    }, 500));
  };

  const navigateImageVersion = (itemId: string, direction: "prev" | "next") => {
    const current = images[itemId];
    if (!current?.history?.length) return;
    const currentIndex = current.historyIndex ?? (current.history.length - 1);
    const newIndex = direction === "prev"
      ? Math.max(0, currentIndex - 1)
      : Math.min(current.history.length - 1, currentIndex + 1);
    if (newIndex === currentIndex) return;
    const newUrl = current.history[newIndex].url;
    setImages((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        url: newUrl,
        historyIndex: newIndex,
      },
    }));
    persistActiveVersion(itemId, newIndex);
  };

  const [refineError, setRefineError] = useState<string | null>(null);

  const generateAnnotatedImageDataUrl = async (): Promise<string | null> => {
    const img = refineImgRef.current;
    const imageUrl = images[refineTarget?.itemId ?? ""]?.url;
    if (!img || !imageUrl || !selectionRect || selectionRect.w < 5 || selectionRect.h < 5) return null;

    const response = await fetch(imageUrl.startsWith("data:") ? imageUrl : `/api/download?url=${encodeURIComponent(imageUrl)}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const scaleX = bitmap.width / img.clientWidth;
    const scaleY = bitmap.height / img.clientHeight;
    ctx.strokeStyle = "red";
    ctx.lineWidth = Math.max(4, Math.round(bitmap.width / 150));
    ctx.strokeRect(selectionRect.x * scaleX, selectionRect.y * scaleY, selectionRect.w * scaleX, selectionRect.h * scaleY);
    return canvas.toDataURL("image/png");
  };

  const handleRefine = async () => {
    if (!refineTarget || !refinePrompt.trim()) return;
    const item = content.find((c) => c.id === refineTarget.itemId);
    if (!item) return;

    const currentImageUrl = images[refineTarget.itemId]?.url;
    const annotatedImageUrl = await generateAnnotatedImageDataUrl();
    setRefineLoading(true);
    setRefineError(null);

    try {
      const res = await fetch("/api/engagement-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item,
          plan,
          answers: {},
          classId,
          assignmentId,
          studentId: COHORT_STUDENT_ID,
          refinementPrompt: refinePrompt.trim(),
          previousImageUrl: currentImageUrl,
          ...(annotatedImageUrl && { annotatedImageUrl }),
        }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { throw new Error(`Image request failed (${res.status}): ${text.slice(0, 120)}`); }
      if (!res.ok) throw new Error((data?.error as string) ?? "Failed to generate image.");
      setImages((prev) => {
        const current = prev[refineTarget.itemId];
        const existingHistory = current?.history ?? [];
        // Truncate after current index if user refined from a non-latest version
        const baseHistory = current?.historyIndex !== undefined
          ? existingHistory.slice(0, current.historyIndex + 1)
          : existingHistory;
        const newVersion: ImageVersion = {
          url: data.url as string,
          refinementPrompt: refinePrompt.trim(),
          createdAt: new Date().toISOString(),
        };
        const newHistory = [...baseHistory, newVersion];
        // Cap at MAX_IMAGE_VERSIONS — drop oldest entries
        const cappedHistory = newHistory.length > MAX_IMAGE_VERSIONS
          ? newHistory.slice(newHistory.length - MAX_IMAGE_VERSIONS)
          : newHistory;
        return {
          ...prev,
          [refineTarget.itemId]: {
            status: "ready",
            url: data.url as string,
            history: cappedHistory,
            historyIndex: cappedHistory.length - 1,
          },
        };
      });
      setRefinePrompt("");
      setSelectionRect(null);
    } catch (err) {
      // Keep the current image intact — just show the error in the modal
      setRefineError(err instanceof Error ? err.message : "Refine failed.");
    } finally {
      setRefineLoading(false);
    }
  };


  const selectedLessonData =
    lessons.find((lesson) => lesson.lesson_number === selectedLesson) ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12">
        <header className="flex flex-col gap-4">
          <nav className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Engage Agent</p>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-700">Teacher</span>
          </nav>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Class context</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">Teacher</p>
                  <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">Class ID</p>
                  <p className="text-sm font-semibold text-slate-800">{classId || "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">Assignment ID</p>
                  <p className="text-sm font-semibold text-slate-800">{assignmentId || "—"}</p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
              <Link href={classId.startsWith("ea-class-") ? `/teacher/classes?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&view=dashboard` : "/dashboard"} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
                Assignment Dashboard
              </Link>
              <Link href="/community" className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
                Community Gallery
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-6">
          {/* Step navigation */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Workflow steps</p>
                <h2 className="text-2xl font-semibold text-slate-900">Step-by-step flow</h2>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                {stepLabels.map((label, index) => {
                  const stepNumber = index + 1;
                  const isActive = currentStep === stepNumber;
                  const isComplete = currentStep > stepNumber;
                  return (
                    <button key={label} type="button" onClick={() => setCurrentStep(stepNumber)}
                      className={`flex flex-1 items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${isActive ? "border-[#BA0C2F] bg-[#BA0C2F] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                      <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${isActive ? "bg-white text-[#BA0C2F]" : isComplete ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600"}`}>{stepNumber}</span>
                      <span className="font-semibold">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>


          {/* Step 1: Assessment */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Step 1</p>
                <h2 className="text-2xl font-semibold text-slate-900">Assessment</h2>
                <p className="mt-1 text-sm text-slate-500">Select a lesson, then publish its quiz and survey to students.</p>
              </div>

              {selectedLessonData && (
                <div className="rounded-2xl border border-[#BA0C2F]/15 bg-[#BA0C2F]/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#BA0C2F]">Learning objective</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {selectedLessonData.learning_objective}
                  </p>
                </div>
              )}

              {/* Lesson picker */}
              <div className="grid gap-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Choose a lesson</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {lessons.map((lesson) => (
                    <button key={lesson.lesson_number} type="button" onClick={() => selectLesson(lesson.lesson_number)}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${selectedLesson === lesson.lesson_number ? "border-[#BA0C2F] bg-[#BA0C2F]/5 ring-2 ring-[#BA0C2F]" : "border-slate-200 hover:border-slate-300"}`}>
                      <p className="font-semibold text-slate-800">{lesson.lesson_title}</p>
                      <p className="mt-1 text-xs text-slate-500">{lesson.quiz_items.filter((q) => q.type === "multiple_choice").length} questions</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Assessment sub-tabs: Quiz / Survey (same pill pattern as StudentView tabs) */}
              {selectedLesson && (
                <div className="flex gap-2">
                  {([
                    { id: "quiz", label: "Quiz" },
                    { id: "survey", label: "Survey" },
                  ] as const).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setAssessmentTab(tab.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        assessmentTab === tab.id
                          ? "bg-[#BA0C2F] text-white"
                          : "border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Quiz preview */}
              {selectedLesson && quizItems.length > 0 && assessmentTab === "quiz" && (
                <div className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-slate-400">Quiz preview ({quizItems.filter((q) => q.type === "multiple_choice").length} questions + confidence checks)</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${quizStatus === "published" ? "bg-emerald-100 text-emerald-700" : quizStatus === "closed" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                      {quizStatus}
                    </span>
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    {quizItems.map((item) => (
                      <div key={item.item_id} className={`mb-3 ${item.type === "confidence_check" ? "ml-6 text-slate-500 italic" : ""}`}>
                        <p className="text-sm font-medium">{item.stem}</p>
                        <div className="mt-1 grid gap-1">
                          {Object.entries(item.options).map(([key, value]) => (
                            <p key={key} className="text-xs text-slate-500">{key}. {value}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {quizStatus === "draft" && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={publishQuiz}
                        disabled={publishingQuiz || !selectedLesson || !hasAssignmentContext}
                        className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        {publishingQuiz ? "Publishing..." : "Publish quiz to students"}
                      </button>
                      {!hasAssignmentContext && (
                        <p className="text-sm text-amber-700">
                          This preview is not linked to a class assignment yet. Open the Engage Agent from an assigned class in GENIUS to publish the quiz to students.
                        </p>
                      )}
                    </div>
                  )}
                  {quizStatus === "published" && (
                    <p className="text-sm font-semibold text-emerald-600">Quiz is live. Students can now answer.</p>
                  )}
                </div>
              )}

              {/* Survey (placeholder entry point — survey builder is tracked separately in UC-SV-01 #78) */}
              {selectedLesson && assessmentTab === "survey" && (
                <div className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-slate-400">Survey</p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">not created</span>
                  </div>
                  <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">No survey yet for this lesson</p>
                      <p className="mt-1 text-sm text-slate-500">
                        A survey lets you ask students short questions alongside the quiz — for example, their prior
                        experience or confidence — so the assessment captures more than the quiz alone.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled
                      title="Survey builder coming soon"
                      className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      Add survey
                    </button>
                    <p className="text-xs text-slate-400">The survey builder is in progress and will connect here.</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <button type="button" disabled className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-300">Previous step</button>
                <button type="button" onClick={() => setCurrentStep(2)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100">Next step</button>
              </div>
            </div>
          )}

          {/* Step 2: Strategy */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Step 2</p>
                <h2 className="text-2xl font-semibold text-slate-900">Engagement strategy recommendation</h2>
                <p className="text-sm text-slate-600">Based on student responses, generate strategies for the entire cohort.</p>
              </div>

              {/* Student answers summary */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-slate-400">Student responses</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {!classId.startsWith("ea-class-") && <button
                      type="button"
                      onClick={() => void autoAnswerTestStudents()}
                      disabled={
                        autoAnsweringTestStudents ||
                        quizStatus !== "published" ||
                        !hasAssignmentContext
                      }
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {autoAnsweringTestStudents
                        ? "Generating..."
                        : "Auto-answer 5 test students"}
                    </button>}
                    <button
                      type="button"
                      onClick={() => void loadStudentAnswers()}
                      disabled={loadingAnswers}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {loadingAnswers ? "Loading..." : "Refresh"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-semibold">{studentAnswers.length}</span> student{studentAnswers.length === 1 ? " has" : "s have"} answered so far.
                </p>
                {!classId.startsWith("ea-class-") && <p className="mt-1 text-xs text-slate-500">
                  Generates stable random answers for the five configured test students and overwrites their prior submissions for this assignment.
                </p>}
                {studentAnswers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {studentAnswers.map((sa) => (
                      <span key={sa.student_id} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200">
                        {sa.student_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Cohort analysis */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold uppercase text-slate-400">Cohort analysis</p>
                      <button
                        type="button"
                        onClick={() => setShowCohortHelp((prev) => !prev)}
                        aria-label="Explain cohort analysis"
                        aria-expanded={showCohortHelp}
                        title="What does cohort analysis do?"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
                      >
                        ?
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">Generate strategies for all students who have answered. Use reanalysis when you want to ignore cached recommendations and rerun every student.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void requestCohortAnalysis()}
                      disabled={loadingCohort || studentAnswers.length === 0}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {loadingCohort ? "Running..." : `Analyze ${studentAnswers.length} students`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestCohortAnalysis({ forceRefresh: true })}
                      disabled={loadingCohort || studentAnswers.length === 0}
                      className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {loadingCohort ? "Running..." : "Reanalyze All"}
                    </button>
                  </div>
                </div>

                {showCohortHelp && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                    Cohort analysis reviews each student’s submitted quiz answers, classifies the likely strategy for each student, and then aggregates those results into one cohort-wide master plan.
                  </div>
                )}

                {loadingCohort && (
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                      {cohortProgress.currentName || "Loading..."}
                    </div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                      <span>Do not refresh this page while cohort analysis is running.</span>
                      <span>{Math.round((cohortProgress.processed / Math.max(1, cohortProgress.total)) * 100)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-slate-700 transition-all" style={{ width: `${Math.round((cohortProgress.processed / Math.max(1, cohortProgress.total)) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {cohortResults.length > 0 && !loadingCohort && (
                  <div className="mt-4 grid gap-4">
                    <div className="grid gap-3">
                      <p className="text-xs font-semibold uppercase text-slate-400">Strategy distribution</p>
                      {strategies.map((strategy) => {
                        const count = cohortDistribution[strategy.id] ?? 0;
                        const percent = Math.round((count / cohortResults.length) * 100);
                        const isInfoOpen = openStrategyInfo.has(strategy.id);
                        return (
                          <div key={strategy.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-3 text-sm">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleStrategyInfo(strategy.id)}
                                    aria-label={`Explain ${strategy.label}`}
                                    aria-expanded={isInfoOpen}
                                    title={strategy.description}
                                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
                                  >
                                    i
                                  </button>
                                  <span className="font-semibold text-slate-800">{strategy.label}</span>
                                </div>
                                {isInfoOpen && (
                                  <p className="mt-2 text-xs leading-5 text-slate-500">{getStrategyDescription(strategy.id)}</p>
                                )}
                              </div>
                              <span className="shrink-0 text-xs font-semibold text-slate-500">{count} students ({percent}%)</span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full ${strategy.color}`} style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-slate-400">Student recommendations</p>
                        <button type="button" onClick={() => setShowStudentRecommendations((prev) => !prev)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100">
                          {showStudentRecommendations ? "Hide" : "Show all"}
                        </button>
                      </div>
                      {showStudentRecommendations && (
                        <div className="grid gap-2">
                          {cohortResults.map((result) => (
                            <div key={result.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold text-slate-800">{result.name}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{getStrategyLabel(result.plan.strategy)}</span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{result.plan.tldr}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Plan display (reuse existing plan UI) */}
              {plan && (
                <div className="mt-4 grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Master plan</p>
                    <p className="text-base font-semibold text-slate-900">{plan.name}</p>
                    <p className="text-sm font-medium text-slate-700">Strategy: {getStrategyLabel(plan.strategy)}</p>
                    <p className="text-sm text-slate-600">{plan.summary}</p>
                  </div>
                  <div className="grid gap-4">
                    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${plan.strategy ? `ring-2 ${strategies.find((strategy) => strategy.id === plan.strategy)?.ring ?? ''}` : ''}`}>
                      <p className="text-xs font-semibold uppercase text-slate-400">Recommended strategy</p>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleStrategyInfo(plan.strategy)}
                              aria-label={`Explain ${getStrategyLabel(plan.strategy)}`}
                              aria-expanded={openStrategyInfo.has(plan.strategy)}
                              title={getStrategyDescription(plan.strategy)}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
                            >
                              i
                            </button>
                            <p className="text-base font-semibold text-slate-900">{getStrategyLabel(plan.strategy)}</p>
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">Primary</span>
                          </div>
                          {openStrategyInfo.has(plan.strategy) && (
                            <p className="mt-2 text-xs leading-5 text-slate-500">{getStrategyDescription(plan.strategy)}</p>
                          )}
                          <p className="mt-2 text-sm text-slate-600">{plan.overallRecommendation}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Based on cohort analysis: {cohortDistribution[plan.strategy] ?? 0} of {cohortResults.length} student{cohortResults.length === 1 ? '' : 's'} aligned most closely with this strategy.
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedStrategies.includes(plan.strategy) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {selectedStrategies.includes(plan.strategy) ? 'Selected for content' : 'Not selected'}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase text-slate-400">Content generation strategies</p>
                      <p className="text-sm text-slate-600">The cohort recommendation is selected by default. Each selected strategy generates one student-facing material, so add alternates only if you want more than one item to review.</p>
                      <div className="flex flex-wrap gap-2">
                        {strategies.map((strategy) => {
                          const isSelected = selectedStrategies.includes(strategy.id);
                          const isRecommended = plan.strategy === strategy.id;
                          return (
                            <button
                              key={strategy.id}
                              type="button"
                              onClick={() => toggleStrategySelection(strategy.id)}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${isSelected ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                            >
                              {strategy.label}
                              {isRecommended ? ' · Recommended' : ''}
                              {isSelected ? ' · Selected' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Teacher annotation */}
                  <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-400">Teacher annotation</p>
                    <p className="text-sm font-medium text-slate-700">
                      Do you accept the recommended strategy: <span className="font-semibold text-slate-900">{getStrategyLabel(plan.strategy)}</span>?
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setAnnotationDecision("agree")}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${annotationDecision === "agree" ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600"}`}>
                        Accept
                      </button>
                      <button type="button" onClick={() => setAnnotationDecision("disagree")}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${annotationDecision === "disagree" ? "bg-rose-600 text-white" : "border border-slate-200 text-slate-600"}`}>
                        Disagree
                      </button>
                    </div>
                    {annotationDecision === "disagree" && (
                      <textarea className="min-h-[96px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none"
                        value={annotationReason} onChange={(e) => setAnnotationReason(e.target.value)}
                        placeholder="Explain your reasoning..." required />
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={submitAnnotation} disabled={annotationStatus === "saving"}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400">
                        {annotationStatus === "saving" ? "Saving..." : "Save annotation"}
                      </button>
                      {annotationStatus === "saved" && <span className="text-xs font-semibold text-emerald-600">Saved.</span>}
                      {annotationStatus === "error" && annotationError && <span className="text-xs font-semibold text-rose-600">{annotationError}</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Generate content button */}
              <button type="button" onClick={requestContent} disabled={!plan || loadingContent || !selectedStrategies.length}
                className="mt-2 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">
                {loadingContent ? "Generating..." : "Generate content"}
              </button>

              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setCurrentStep(1)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100">Previous step</button>
                <button type="button" onClick={() => setCurrentStep(3)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100">Next step</button>
              </div>
            </div>
          )}

          {/* Step 3: Content generation */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Step 3</p>
                <h2 className="text-2xl font-semibold text-slate-900">Engagement content</h2>
                <p className="text-sm text-slate-600">Generate one student-facing material per selected strategy, then choose which items to send to students for rating.</p>
              </div>

              {content.length === 0 && (
                <p className="text-sm text-slate-400">No content generated yet. Go back to Step 2 and generate content.</p>
              )}

              {content.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500">
                      {selectedForPublish.size} of {content.length} selected for students
                    </p>
                    <button type="button" onClick={publishSelectedContent} disabled={selectedForPublish.size === 0 || publishingContent}
                      className="rounded-xl bg-[#BA0C2F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300">
                      {publishingContent ? "Sending..." : "Send to students"}
                    </button>
                  </div>

                  <div className="grid gap-4">
                    {content.map((item) => {
                      const isPublished = publishedContentIds.has(item.id);
                      const isSelected = selectedForPublish.has(item.id);
                      return (
                        <div key={item.id} className={`flex flex-col gap-4 rounded-2xl border p-4 text-sm text-slate-700 sm:flex-row sm:items-stretch ${isPublished ? "border-emerald-200 bg-emerald-50/50" : "border-slate-100 bg-slate-50"}`}>
                          {/* Media thumbnails */}
                          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
                            <div className="flex w-32 shrink-0 flex-col gap-1.5 sm:w-36">
                              <div className="aspect-square w-full">
                                {images[item.id]?.status === "loading" && (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100">
                                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                    <p className="text-xs text-slate-400">Generating...</p>
                                  </div>
                                )}
                                {images[item.id]?.status === "ready" && images[item.id]?.url && (
                                  <button type="button" className="block h-full w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-white" onClick={() => setFocusImage({ url: images[item.id]?.url ?? "", title: item.title })}>
                                    <img className="h-full w-full object-cover" src={images[item.id]?.url} alt={item.title} />
                                  </button>
                                )}
                                {images[item.id]?.status === "error" && (
                                  <div className="flex h-full w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100">
                                    <p className="text-xs text-rose-500">{images[item.id]?.error}</p>
                                  </div>
                                )}
                                {(!images[item.id]?.status || images[item.id]?.status === "idle") && (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100">
                                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                    <p className="text-xs text-slate-400">Preparing...</p>
                                  </div>
                                )}
                              </div>
                              {(images[item.id]?.history?.length ?? 0) > 1 && (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button type="button" disabled={(images[item.id]?.historyIndex ?? 0) <= 0}
                                    onClick={() => navigateImageVersion(item.id, "prev")}
                                    className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
                                    &#8592;
                                  </button>
                                  <span className="text-[10px] text-slate-500">
                                    {(images[item.id]?.historyIndex ?? 0) + 1}/{images[item.id]?.history?.length ?? 0}
                                  </span>
                                  <button type="button" disabled={(images[item.id]?.historyIndex ?? 0) >= (images[item.id]?.history?.length ?? 1) - 1}
                                    onClick={() => navigateImageVersion(item.id, "next")}
                                    className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
                                    &#8594;
                                  </button>
                                </div>
                              )}
                              <div className="flex w-full gap-1.5">
                                <button type="button" disabled={images[item.id]?.status !== "ready"} onClick={() => downloadFile(images[item.id]?.url ?? "", `${item.title.replace(/\s+/g, "-").toLowerCase()}-image.webp`)}
                                  className="flex w-1/2 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
                                  Save
                                </button>
                                <button type="button" disabled={images[item.id]?.status !== "ready"} onClick={() => { setRefineTarget({ itemId: item.id, title: item.title }); setRefinePrompt(""); setRefineError(null); setSelectionRect(null); }}
                                  className="flex w-1/2 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
                                  Refine
                                </button>
                              </div>
                            </div>
                            <div className="flex w-32 shrink-0 flex-col gap-1.5 sm:w-36">
                              <div className="aspect-square w-full">
                                {!videos[item.id]?.status && images[item.id]?.status === "ready" && (
                                  <button type="button" onClick={() => requestVideo(item)} className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:bg-slate-100">
                                    <span className="text-2xl">&#9654;</span>
                                    <span className="text-xs font-semibold">Generate video</span>
                                  </button>
                                )}
                                {(videos[item.id]?.status === "loading" || videos[item.id]?.status === "polling") && (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100">
                                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                    <p className="text-xs text-slate-400">{videos[item.id]?.status === "polling" ? "Generating..." : "Starting..."}</p>
                                  </div>
                                )}
                                {videos[item.id]?.status === "ready" && videos[item.id]?.url && (
                                  <button type="button" className="block h-full w-full cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-black" onClick={() => setFocusVideo({ url: videos[item.id]?.url ?? "", title: item.title })}>
                                    <video className="h-full w-full object-cover" src={videos[item.id]?.url} muted playsInline loop autoPlay />
                                  </button>
                                )}
                                {videos[item.id]?.status === "error" && (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100">
                                    <p className="text-xs text-rose-500">{videos[item.id]?.error}</p>
                                    <button type="button" onClick={() => requestVideo(item)} className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">Retry</button>
                                  </div>
                                )}
                              </div>
                              <div className="flex w-full gap-1.5">
                                <button type="button" disabled={videos[item.id]?.status !== "ready"} onClick={() => downloadFile(videos[item.id]?.url ?? "", `${item.title.replace(/\s+/g, "-").toLowerCase()}-video.mp4`)}
                                  className="flex w-1/2 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
                                  Save
                                </button>
                                <button type="button" disabled={images[item.id]?.status !== "ready"} onClick={() => { setRefineTarget({ itemId: item.id, title: item.title }); setRefinePrompt(""); setRefineError(null); setSelectionRect(null); }}
                                  className="flex w-1/2 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
                                  Refine
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Text content + select checkbox */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase text-slate-400">Strategy: {getStrategyLabel(item.strategy)}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {getContentModeLabels(item).map((label) => (
                                    <span key={`${item.id}-${label}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                                <p className="mt-2 text-base font-semibold text-slate-900">{item.title}</p>
                              </div>
                              {isPublished ? (
                                <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Sent</span>
                              ) : (
                                <button type="button" onClick={() => toggleContentForPublish(item.id)}
                                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${isSelected ? "bg-[#BA0C2F] text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
                                  {isSelected ? "Selected" : "Select"}
                                </button>
                              )}
                            </div>
                            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{item.body}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setCurrentStep(2)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100">Previous step</button>
                <button type="button" disabled className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-300">Next step</button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          )}
        </section>

        {/* Lightbox modals */}
        {focusImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" onClick={() => setFocusImage(null)}>
            <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="absolute right-2 top-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow" onClick={() => setFocusImage(null)}>Close</button>
              <img className="max-h-[80vh] w-full rounded-2xl bg-white object-contain shadow-2xl" src={focusImage.url} alt={focusImage.title} />
              <p className="mt-3 text-center text-sm text-slate-100">{focusImage.title}</p>
            </div>
          </div>
        )}

        {focusVideo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" onClick={() => setFocusVideo(null)}>
            <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow" onClick={() => setFocusVideo(null)}>Close</button>
              <video className="max-h-[80vh] w-full rounded-2xl bg-black shadow-2xl" src={focusVideo.url} controls autoPlay playsInline />
              <p className="mt-3 text-center text-sm text-slate-100">{focusVideo.title}</p>
            </div>
          </div>
        )}

        {/* Refine image modal */}
        {refineTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" onClick={() => { if (!refineLoading) setRefineTarget(null); }}>
            <div className="relative flex w-full max-w-2xl flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Refine Image</h3>
                <button type="button" disabled={refineLoading} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300" onClick={() => setRefineTarget(null)}>Close</button>
              </div>
              <p className="text-sm text-slate-500">{refineTarget.title}</p>

              {/* Image preview with region selection */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                  {images[refineTarget.itemId]?.status === "ready" && images[refineTarget.itemId]?.url && (
                    <div
                      className="relative select-none"
                      style={{ cursor: refineLoading ? "default" : "crosshair" }}
                      onMouseDown={(e) => {
                        if (refineLoading) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                        setSelectionRect(null);
                      }}
                      onMouseMove={(e) => {
                        if (!dragStart) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                        const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
                        setSelectionRect({
                          x: Math.min(dragStart.x, curX),
                          y: Math.min(dragStart.y, curY),
                          w: Math.abs(curX - dragStart.x),
                          h: Math.abs(curY - dragStart.y),
                        });
                      }}
                      onMouseUp={() => {
                        setDragStart(null);
                        setSelectionRect((prev) => (prev && prev.w < 5 && prev.h < 5 ? null : prev));
                      }}
                      onMouseLeave={() => {
                        if (dragStart) setDragStart(null);
                      }}
                    >
                      <img
                        ref={refineImgRef}
                        className="block max-h-[40vh] rounded-xl"
                        src={images[refineTarget.itemId]?.url}
                        alt={refineTarget.title}
                        draggable={false}
                      />
                      {selectionRect && selectionRect.w > 0 && selectionRect.h > 0 && (
                        <svg className="pointer-events-none absolute inset-0 h-full w-full rounded-xl">
                          <defs>
                            <mask id="refine-selection-mask">
                              <rect width="100%" height="100%" fill="white" />
                              <rect x={selectionRect.x} y={selectionRect.y} width={selectionRect.w} height={selectionRect.h} fill="black" />
                            </mask>
                          </defs>
                          <rect width="100%" height="100%" fill="rgba(0,0,0,0.4)" mask="url(#refine-selection-mask)" />
                          <rect x={selectionRect.x} y={selectionRect.y} width={selectionRect.w} height={selectionRect.h} fill="none" stroke="#BA0C2F" strokeWidth="2" strokeDasharray="6 3" />
                        </svg>
                      )}
                    </div>
                  )}
                  {images[refineTarget.itemId]?.status === "loading" && (
                    <div className="flex flex-col items-center gap-2 py-16">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                      <p className="text-sm text-slate-400">Generating refined image...</p>
                    </div>
                  )}
                  {images[refineTarget.itemId]?.status === "error" && (
                    <p className="py-16 text-sm text-rose-500">{images[refineTarget.itemId]?.error}</p>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <p>{selectionRect ? "Selected region will be refined. VLM will interpret the location." : "Drag on the image to select a region, or refine the entire image."}</p>
                  {selectionRect && (
                    <button type="button" onClick={() => setSelectionRect(null)} className="font-semibold text-rose-500 hover:text-rose-700">
                      Clear selection
                    </button>
                  )}
                </div>
                {(images[refineTarget.itemId]?.history?.length ?? 0) > 1 && (
                  <div className="flex items-center justify-center gap-3">
                    <button type="button" disabled={refineLoading || (images[refineTarget.itemId]?.historyIndex ?? 0) <= 0}
                      onClick={() => navigateImageVersion(refineTarget.itemId, "prev")}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
                      &#8592; Prev
                    </button>
                    <span className="text-xs text-slate-500">
                      Version {(images[refineTarget.itemId]?.historyIndex ?? 0) + 1} of {images[refineTarget.itemId]?.history?.length ?? 0}
                    </span>
                    <button type="button" disabled={refineLoading || (images[refineTarget.itemId]?.historyIndex ?? 0) >= (images[refineTarget.itemId]?.history?.length ?? 1) - 1}
                      onClick={() => navigateImageVersion(refineTarget.itemId, "next")}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
                      Next &#8594;
                    </button>
                  </div>
                )}
                {images[refineTarget.itemId]?.history?.[images[refineTarget.itemId]?.historyIndex ?? 0]?.refinementPrompt && (
                  <p className="text-center text-xs italic text-slate-400 truncate">
                    Refined: &ldquo;{images[refineTarget.itemId]?.history?.[images[refineTarget.itemId]?.historyIndex ?? 0]?.refinementPrompt}&rdquo;
                  </p>
                )}
              </div>

              {/* Refinement input */}
              {refineError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{refineError}</div>
              )}
              <div className="relative">
                <textarea
                  value={refinePrompt}
                  onChange={(e) => { setRefinePrompt(e.target.value.slice(0, 500)); setRefineError(null); }}
                  placeholder="Describe how you'd like to modify this image..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-16 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
                <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{refinePrompt.length}/500</span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3">
                <button type="button" disabled={refineLoading} onClick={() => setRefineTarget(null)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
                  Cancel
                </button>
                <button type="button" disabled={refineLoading || !refinePrompt.trim()} onClick={handleRefine}
                  className="rounded-full bg-[#BA0C2F] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-400">
                  {refineLoading ? "Regenerating..." : "Regenerate"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <a ref={downloadRef} className="hidden" />
    </div>
  );
}
