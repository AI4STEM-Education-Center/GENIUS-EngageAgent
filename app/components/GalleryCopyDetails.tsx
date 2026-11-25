import type { GalleryCopy, GalleryMaterial } from "@/lib/material-gallery";
import MaterialGenerationHistory from "./MaterialGenerationHistory";
import GalleryMaterialDetails from "./GalleryMaterialDetails";

export default function GalleryCopyDetails({ copy, revision, savedAt, dirty, owner, source, scope }: {
  copy: GalleryCopy; revision: number; savedAt?: string; dirty: boolean; owner: string; source: Partial<GalleryMaterial> | null; scope?: import("@/lib/material-gallery").GalleryScope;
}) {
  const material = copy.format === "slides" ? copy.deck : copy.item;
  const settings = material.teachingContext;
  const generation = material.generation;
  const sourceCredit = source?.derivedFrom
    ? (source.originalCreatorName ? `Original author: ${source.originalCreatorName}` : "Original author not recorded")
    : source?.creatorName || "Author not recorded";
  return <div className="grid gap-3 lg:grid-cols-2">
    <details className="min-w-0 rounded-lg border border-line bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">Your current copy · {dirty ? "Unsaved changes" : `Version ${revision}`}</summary>
      <p className="mt-3 text-sm text-mute">Edited by {owner || "you"}{savedAt ? ` · Saved ${new Date(savedAt).toLocaleString()}` : " · Not saved yet"}</p>
      <GalleryMaterialDetails privateMaterial format={copy.format} lessonNumber={material.lessonNumber} strategy={material.strategy}
        focus={material.focus ? { misconceptions: material.focus.misconceptions || [], coreIdeas: material.focus.coreIdeas || [] } : undefined}
        gradeBand={settings?.gradeBand} experienceContext={settings?.experienceContext} quizPattern={settings?.quizPattern}
        generation={generation} promptTags={generation?.tags} />
      {scope && <MaterialGenerationHistory scope={scope} copyId={copy.format === "slides" ? copy.deck.id : copy.item.id.replace(/^gallery-copy-/, "")} revision={revision} />}
      {generation && <p className="mt-2 text-xs text-mute">{generation.id === source?.generation?.id && !copy.source.private ? "AI input record inherited from the source material." : "AI input record belongs to this copy."} Manual edits are tracked by the saved version.</p>}
      <p className="mt-3 text-xs text-mute">Feedback on a Gallery source is not an independent rating of this private copy.</p>
    </details>
    {!copy.source.private && <details className="min-w-0 rounded-lg border border-line bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">Source material · {sourceCredit}</summary>
      <p className="mt-3 text-sm font-medium">{copy.source.title}</p>
      <p className="mt-1 text-xs text-mute">Source version {copy.source.revision} · {copy.source.mode === "adapt" ? "Adapted for your class" : "Copied for reuse"}. Source tags describe the original shared material. Usage and feedback below combine its linked classroom copies, including edited versions.</p>
      {source ? <GalleryMaterialDetails {...source} scope={scope} /> : <p className="mt-3 text-sm text-mute">Source details are temporarily unavailable. Your copy can still be edited.</p>}
    </details>}
  </div>;
}
