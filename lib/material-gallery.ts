import type { SlideDeck, SlideDraft, SlideStrategy } from "./slides/model";
import type { ContentItem } from "./types";

export type GalleryScope = { classId: string; assignmentId: string };
export type GalleryFocus = { misconceptions: string[]; coreIdeas: number[] };
export type GalleryProvenance = { templateId: string; revision: number; title: string; mode: "use" | "adapt" };
export type GalleryMetadata = {
  title: string;
  description?: string;
  gradeBand?: string;
  experienceContext?: string;
  quizPattern?: string;
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
};
export type GalleryFilters = { lessonNumber?: number; strategy?: string; format?: "slides" | "video"; search?: string; cursor?: string; limit?: number; mine?: boolean };
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
