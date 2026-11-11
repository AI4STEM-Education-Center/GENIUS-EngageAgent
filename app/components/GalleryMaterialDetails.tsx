import { GALLERY_TAG_LABELS, type GalleryMaterial } from "@/lib/material-gallery";

type Props = Pick<GalleryMaterial, "creatorName" | "teacherCount" | "promptTags"> & { showTags?: boolean };
export default function GalleryMaterialDetails({ creatorName, teacherCount, promptTags, showTags = false }: Props) {
  return <div className="mt-2 text-sm text-mute">
    <p>{creatorName ? `By ${creatorName}` : "Author not recorded"}
      {teacherCount !== undefined && <span title="Teachers who saved an editable copy. Each teacher is counted once; previews do not count."> · {teacherCount} {teacherCount === 1 ? "teacher has" : "teachers have"} saved a copy</span>}</p>
    {showTags && promptTags && <details className="mt-3 rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-semibold text-ink">Teaching tags</summary>
      <p className="mt-2 text-xs">Tags describe this shared version. Class context includes only summaries the author chose to share.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(promptTags).map(([key, value]) => <div key={key} className="min-w-0">
        <dt className="text-xs font-semibold">{GALLERY_TAG_LABELS[key] || key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-2">{value}</dd>
      </div>)}</dl>
    </details>}
  </div>;
}
