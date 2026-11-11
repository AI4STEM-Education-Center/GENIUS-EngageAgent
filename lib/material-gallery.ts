import type { SlideDeck, SlideDraft, SlideStrategy } from "./slides/model";
import type { ContentItem } from "./types";

export const GALLERY_TAG_LABELS: Record<string, string> = {
  GRADE_LEVEL: "Grade level", SUBJECT: "Subject", TOPIC: "Topic", LEARNING_OBJECTIVE: "Learning objective",
  TARGET_CONCEPT: "Target concept", CURRENT_UNDERSTANDING: "Prior understanding / quiz pattern",
  MISCONCEPTION_OR_GAP: "Misconception or gap", KNOWLEDGE_GAP: "Knowledge gap", TARGET_UNDERSTANDING: "Target understanding",
  SELECTED_STRATEGY: "Strategy", LEARNER_CONTEXT: "Teaching context", CLASS_PROFILE: "Class profile",
  EXPERIENCE_CONTEXT: "Experience context", PREFERRED_MEDIA_TYPE: "Material type", VISUAL_STYLE: "Visual style",
  DURATION: "Duration", ANALOGY_METHOD: "Analogy method", TEXT_MODES: "Text modes",
};

export type GalleryScope = { classId: string; assignmentId: string };
export type GalleryFocus = { misconceptions: string[]; coreIdeas: number[] };
export type GalleryProvenance = { templateId: string; revision: number; title: string; mode: "use" | "adapt" };
export type GalleryMetadata = {
  title: string;
  description?: string;
  gradeBand?: string;
  experienceContext?: string;
  quizPattern?: string;
  /** Teacher-reviewed, shareable summaries; never populated from raw class data. */
  teachingContext?: string;
  classProfile?: string;
  focus?: GalleryFocus;
  /** The teacher reviewed all text, notes and images for sharing with other teachers. */
  sharingConfirmed: true;
};
export type GalleryMaterial = {
  id: string;
  revision: number;
  title: string;
  description: string;
  gradeBand: string;
  experienceContext: string;
  quizPattern: string;
  lessonNumber: number;
  strategy: string;
  format: "slides" | "video";
  focus?: GalleryFocus;
  createdAt: string;
  isOwner: boolean;
  slideCount?: number;
  derivedFrom?: Pick<GalleryProvenance, "templateId" | "revision" | "title">;
  creatorName?: string;
  /** Distinct teachers who completed a private-copy save, not previews/opens. */
  teacherCount?: number;
  promptTags?: Record<string, string>;
  matchReasons?: string[];
};
export type GalleryFilters = { lessonNumber?: number; strategy?: string; format?: "slides" | "video"; search?: string; cursor?: string; limit?: number; mine?: boolean;
  recommendLesson?: number; recommendStrategy?: string; recommendFocus?: string };
export type GalleryFacets = { lessons: number[]; strategies: string[] };
export type GallerySlideSource = { material: GalleryMaterial; draft: SlideDraft; strategy: SlideStrategy; lessonNumber: number; visualIds: string[] };
export type GalleryPreviewSource = {
  material: GalleryMaterial; strategy: string; lessonNumber: number;
  draft?: SlideDraft; visualIds?: string[]; item?: ContentItem; media?: { video: string; image?: string };
};
export type GalleryCopy =
  | { format: "slides"; deck: SlideDeck & { gallerySource: GalleryProvenance }; source: GalleryProvenance }
  | { format: "video"; item: ContentItem & { gallerySource: GalleryProvenance }; media: { video: string; image?: string }; source: GalleryProvenance };

export type SavedGalleryCopySummary = {
  copyId: string; revision: number; savedAt: string; title: string;
  format: "slides" | "video"; lessonNumber: number; strategy: string; source: GalleryProvenance;
};
export type SavedGalleryCopy = { copy: GalleryCopy; revision: number; savedAt: string };
