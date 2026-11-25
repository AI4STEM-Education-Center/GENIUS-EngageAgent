import type { SlideDeck, SlideDraft, SlideStrategy } from "./slides/model";
import type { MaterialAdaptation, MaterialTeachingContext } from "./material-teaching-context";
import type { ContentItem } from "./types";

export const GALLERY_TAG_LABELS: Record<string, string> = {
  IMAGE_SIZE: "Image size", IMAGE_QUALITY: "Image quality", ASPECT_RATIO: "Aspect ratio", RESOLUTION: "Resolution", MEDIA_ENCODING: "Media encoding",
  MODEL: "Generation model", INPUT_CAPTURED_AT: "Inputs captured", FOCUS_ITEMS: "Selected focus", GRADE_LEVEL: "Grade level", SUBJECT: "Subject", TOPIC: "Topic", LEARNING_OBJECTIVE: "Learning objective",
  TARGET_CONCEPT: "Target concept", CURRENT_UNDERSTANDING: "Prior understanding / quiz pattern",
  MISCONCEPTION_OR_GAP: "Misconception or gap", KNOWLEDGE_GAP: "Knowledge gap", TARGET_UNDERSTANDING: "Target understanding",
  SELECTED_STRATEGY: "Strategy", LEARNER_CONTEXT: "Teaching context", CLASS_PROFILE: "Class profile",
  EXPERIENCE_CONTEXT: "Experience context", PREFERRED_MEDIA_TYPE: "Material type", VISUAL_STYLE: "Visual style",
  KEYWORDS: "Keywords", DURATION: "Duration", ANALOGY_METHOD: "Analogy method", TEXT_MODES: "Text modes",
};

export type GalleryScope = { classId: string; assignmentId: string };
export type GalleryFocus = { misconceptions: string[]; coreIdeas: number[] };
export type GalleryProvenance = { private?: true; templateId: string; revision: number; title: string; mode: "use" | "adapt" };
export type GalleryMetadata = {
  topic?: string;
  title: string;
  description?: string;
  gradeBand?: string;
  experienceContext?: string;
  quizPattern?: string;
  /** Teacher-reviewed, shareable summaries; never populated from raw class data. */
  teachingContext?: string;
  classProfile?: string;
  keywords?: string[];
  focus?: GalleryFocus;
  /** The teacher reviewed all text, notes and images for sharing with other teachers. */
  sharingConfirmed: true;
};
export type GalleryFeedback = { status: "unavailable" } | {
  status: "available"; observedAt?: string; firstPublicationAt?: string; lastFeedbackAt?: string; ratingCount: number; averageRating: number | null; highRatingPercent: number | null;
  activityCount: number; publishedTeacherCount?: number; questionCount: number; questionAuthorCount: number; attributableActivities: number;
  analyzedQuestionCount: number; questionTypes: Record<string, number>; scienceQuestionPercent: number | null;
};

export type GalleryMaterial = {
  id: string;
  revision: number;
  title: string;
  description: string;
  gradeBand: string;
  experienceContext: string;
  experienceKey?: string;
  quizPattern: string;
  lessonNumber: number;
  strategy: string;
  format: "slides" | "video";
  focus?: GalleryFocus;
  createdAt: string;
  isOwner: boolean;
  slideCount?: number;
  previewImage?: string;
  previewSlide?: Pick<SlideDraft["slides"][number], "stage" | "title" | "body" | "task">;
  derivedFrom?: Pick<GalleryProvenance, "templateId" | "revision" | "title">;
  /** Teacher who shared this Gallery version. */
  creatorName?: string;
  /** First recorded author in this version's public Gallery lineage. */
  originalCreatorName?: string;
  /** Distinct teachers who completed a private-copy save, not previews/opens. */
  teacherCount?: number;
  generation?: import("./generation-record").GenerationRecord;
  mediaGenerations?: import("./generation-record").MaterialGenerationPart[];
  metadataOrigin?: "captured" | "teacher_confirmed" | "legacy";
  metadataRevision?: number;
  metadataReviewedAt?: string;
  metadataReviewedBy?: string;
  promptTags?: Record<string, string>;
  /** Original curriculum identity, independent of editable public topic labels. */
  lessonIdentity?: { topic: string; learningObjective: string };
  matchReasons?: string[];
  matchTags?: { label: string; value: string; matched: boolean }[];
  feedback?: GalleryFeedback;
};
export type GalleryFilters = { lessonNumber?: number; strategy?: string; format?: "slides" | "video"; search?: string; cursor?: string; limit?: number; mine?: boolean;
  recommendedOnly?: boolean; gradeBand?: string; recommendLesson?: number; recommendStrategy?: string; recommendFocus?: string;
  recommendFormat?: "slides" | "video"; recommendContextRef?: string; recommendGrade?: string; recommendQuiz?: string; recommendExperience?: string };
export type GalleryFacets = { lessons: number[]; strategies: string[]; grades?: string[] };
export type GallerySlideSource = { material: GalleryMaterial; draft: SlideDraft; strategy: SlideStrategy; lessonNumber: number; visualIds: string[] };
export type GalleryPreviewSource = {
  material: GalleryMaterial; strategy: string; lessonNumber: number;
  draft?: SlideDraft; visualIds?: string[]; item?: ContentItem; media?: { video: string; image?: string };
};
export type GalleryCopy = (
  | { format: "slides"; deck: SlideDeck & { gallerySource: GalleryProvenance }; source: GalleryProvenance }
  | { format: "video"; item: ContentItem & { gallerySource: GalleryProvenance }; media: { video: string; image?: string }; source: GalleryProvenance }) & { mediaGenerations?: import("./generation-record").MaterialGenerationPart[]; adaptation?: MaterialAdaptation; teachingContext?: MaterialTeachingContext };

export type SavedGalleryCopySummary = {
  copyId: string; revision: number; savedAt: string; title: string;
  format: "slides" | "video"; lessonNumber: number; strategy: string; source: GalleryProvenance;
  focus?: GalleryFocus; gradeBand?: string; experienceContext?: string; quizPattern?: string;
  generation?: import("./generation-record").GenerationRecord;
  previewSlide?: GalleryMaterial["previewSlide"]; previewImage?: string; slideCount?: number;
};
export type SavedGalleryCopy = { copy: GalleryCopy; revision: number; savedAt: string };
