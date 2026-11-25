import type { GalleryCopy, GalleryMaterial } from "@/lib/material-gallery";
import MaterialGenerationHistory from "./MaterialGenerationHistory";
import GalleryMaterialDetails from "./GalleryMaterialDetails";

export default function GalleryCopyDetails({ copy, revision, savedAt, dirty, owner, source, scope }: {
  copy: GalleryCopy; revision: number; savedAt?: string; dirty: boolean; owner: string; source: Partial<GalleryMaterial> | null; scope?: import("@/lib/material-gallery").GalleryScope;
}) {
  const copyId = copy.format === "slides" ? copy.deck.id : copy.item.id.replace(/^gallery-copy-/, "");
  const material = copy.format === "slides" ? copy.deck : copy.item;
  const settings = material.teachingContext;
  const generation = material.generation;
  const sourceCredit = source?.derivedFrom && source.creatorName ? `Shared by ${source.creatorName}` : source?.creatorName;
  const inherited = generation && source?.generation?.id === generation.id && !copy.source.private;
  return <div className="grid gap-3 lg:grid-cols-2">
    <details className="min-w-0 rounded-lg border border-line bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">Your current copy · {dirty ? "Unsaved changes" : revision > 0 ? `Version ${revision}` : "Not saved yet"}</summary>
      <p className="mt-3 text-sm text-mute">Private copy owned by {owner || "you"}{savedAt ? ` · Saved ${new Date(savedAt).toLocaleString()}` : ""}</p>
      <GalleryMaterialDetails privateMaterial format={copy.format} lessonNumber={material.lessonNumber} strategy={material.strategy}
        focus={material.focus ? { misconceptions: material.focus.misconceptions || [], coreIdeas: material.focus.coreIdeas || [] } : undefined}
        gradeBand={settings?.gradeBand} experienceContext={settings?.experienceContext} quizPattern={settings?.quizPattern}
        generation={generation} />
      {scope && <MaterialGenerationHistory scope={scope} copyId={copyId} revision={revision} />}
      {inherited && <p className="mt-2 text-xs text-mute">AI input record inherited from the source material.</p>}
      <p className="mt-3 text-xs text-mute">Feedback on a Gallery source is not an independent rating of this private copy.</p>
    </details>
    {!copy.source.private && <details className="min-w-0 rounded-lg border border-line bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">Source material{sourceCredit && ` · ${sourceCredit}`}</summary>
      <p className="mt-3 text-sm font-medium">{copy.source.title}</p>
      <p className="mt-1 text-xs text-mute">Source version {copy.source.revision} · {copy.source.mode === "adapt" ? "Adapted for your class" : "Copied for reuse"}. Source tags describe this shared version. Usage and feedback below combine its linked classroom copies, including edited versions.</p>
      {source ? <GalleryMaterialDetails {...source} sourceCopyId={copyId} scope={scope} /> : <p className="mt-3 text-sm text-mute">Source details are temporarily unavailable. Your copy can still be edited.</p>}
    </details>}
  </div>;
}
