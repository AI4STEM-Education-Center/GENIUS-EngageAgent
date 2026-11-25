import MaterialGenerationHistory from "./MaterialGenerationHistory";
import { GALLERY_TAG_LABELS, type GalleryMaterial } from "@/lib/material-gallery";
import { getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import { toMisconceptionIds } from "@/lib/misconceptions";

type Props = Partial<GalleryMaterial> & { showTags?: boolean; compact?: boolean; privateMaterial?: boolean; scope?: import("@/lib/material-gallery").GalleryScope };
const meaningful = (value?: string) => value && !/^(Not shared|Not supplied|Not selected|Unknown)/iu.test(value) ? value : undefined;
const short = (value: string) => value.length > 44 ? `${value.slice(0, 41)}…` : value;
export default function GalleryMaterialDetails(material: Props) {
  const { creatorName, originalCreatorName, derivedFrom, teacherCount, promptTags = {}, feedback, showTags = true, compact = false, matchTags, privateMaterial = false } = material;
  const focus = meaningful(promptTags.FOCUS_ITEMS) || (material.focus ? [
    ...material.focus.misconceptions.map(code => toMisconceptionIds(material.lessonNumber || 0, code).join(" + ") || `Target ${code}`),
    ...material.focus.coreIdeas.map(index => `Core idea ${index + 1}`),
  ].join(" · ") : "");
  // The prototype's seven matching dimensions stay explicit and compact.
  // The full generation parameters remain available without long prompt text
  // overwhelming the cards. Unknown inputs are never inferred from results.
  const tags = [
    ["Lesson", material.lessonNumber ? String(material.lessonNumber) : undefined],
    ["Strategy", material.strategy ? getEngagementStrategyLabel(material.strategy) : meaningful(promptTags.SELECTED_STRATEGY)],
    ["Focus", focus || "Not recorded"],
    ["Grade", material.gradeBand || meaningful(promptTags.GRADE_LEVEL) || "Not provided"],
    ["Prior quiz", material.quizPattern || meaningful(promptTags.CURRENT_UNDERSTANDING) || "Not recorded"],
    ["Experience", material.experienceContext || meaningful(promptTags.EXPERIENCE_CONTEXT) || "Not provided"],
    ["Format", material.format === "slides" ? "Slide deck" : material.format === "video" ? "Animated video" : meaningful(promptTags.PREFERRED_MEDIA_TYPE)],
    ["Subject", meaningful(promptTags.SUBJECT)],
    ["Topic", promptTags.TOPIC === `Lesson ${material.lessonNumber}` ? undefined : meaningful(promptTags.TOPIC)],
    ["Method", meaningful(promptTags.ANALOGY_METHOD)],
    ["Duration", meaningful(promptTags.DURATION)],
    ["Text modes", meaningful(promptTags.TEXT_MODES)],
    ...((promptTags.KEYWORDS || "").split(",").map(value => value.trim()).filter(Boolean).map(value => ["Keyword", value])),
  ].filter((entry): entry is [string, string] => !!entry[1]);
  const result = feedback?.status === "available" ? feedback : undefined;
  return <div className="mt-2 text-sm text-mute">
    {!privateMaterial && <p>{derivedFrom
      ? <><span>{originalCreatorName ? `Original author: ${originalCreatorName}` : "Original author not recorded"}</span>{" · "}<span>{creatorName ? `This version shared by ${creatorName}` : "Sharing teacher not recorded"}</span></>
      : creatorName ? `By ${creatorName}` : "Author not recorded"}
      {teacherCount !== undefined && <span title="Teachers who saved an editable copy. Each teacher is counted once; previews do not count."> · {teacherCount} {teacherCount === 1 ? "teacher has" : "teachers have"} saved a copy</span>}</p>}
    {result?.publishedTeacherCount !== undefined && <p className="mt-1 text-xs text-mute" title="Distinct teachers with a currently published classroom copy. Saving or previewing alone does not count.">{result.publishedTeacherCount} {result.publishedTeacherCount === 1 ? "teacher using" : "teachers using"} with students</p>}
    {matchTags && <p className="mt-2 text-xs font-semibold text-ok">{matchTags.filter(tag => tag.matched).length} of 7 match</p>}
    <ul aria-label="Material tags" className="mt-3 flex flex-wrap gap-1.5">
      {tags.slice(0, 7).map(([label, value], i) => <li key={`${label}-${i}`} title={`${label}: ${value}`}
        className={`max-w-full truncate rounded-md px-2 py-1 text-xs ${matchTags?.find(tag => tag.label === label)?.matched ? "bg-ok-light text-ok" : label === "Strategy" || label === "Focus" ? "bg-info-light text-info" : "bg-line-2 text-ink-2"}`}>
        {matchTags?.find(tag => tag.label === label)?.matched && <span aria-label="Matches current task">✓ </span>}<span className="font-normal opacity-75">{label}:</span> <span className="font-semibold">{short(value)}</span>
      </li>)}
    </ul>
    {!privateMaterial && <div aria-label="Student feedback" className="mt-3 flex flex-wrap gap-1.5 text-xs">
      {feedback?.status === "unavailable" ? <span className="rounded-md bg-line-2 px-2 py-1">Student feedback unavailable</span> : <>
        <span className="rounded-md bg-ok-light px-2 py-1 font-semibold">{result?.ratingCount ? `★ ${result.averageRating?.toFixed(1)}/5 · ${result.ratingCount} ${result.ratingCount === 1 ? "rating" : "ratings"}` : "★ No student ratings yet"}</span>
        {!!result?.ratingCount && <span className="rounded-md bg-ok-light px-2 py-1">4–5★: {result.highRatingPercent}%</span>}
        {!!result?.questionCount && <span className="rounded-md bg-ai-light px-2 py-1">Questions: {result.questionCount} · {result.questionAuthorCount} {result.questionAuthorCount === 1 ? "learner" : "learners"}</span>}
        {result?.scienceQuestionPercent != null && <span className="rounded-md bg-ai-light px-2 py-1">Science questions: {result.scienceQuestionPercent}%</span>}
      </>}
    </div>}
    {showTags && !compact && <details className="mt-3 rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-semibold text-ink">Teaching tags</summary>
      {tags.length > 7 && <ul className="mt-2 flex flex-wrap gap-1.5">{tags.slice(7).map(([label, value], i) => <li key={i} className="rounded-md bg-canvas px-2 py-1 text-xs">{label}: {value}</li>)}</ul>}
      <p className="mt-2 text-xs">{privateMaterial ? "Settings for your current copy. The captured AI inputs below describe the last AI operation; later manual edits do not change that record." : "Teacher-reviewed tags for this shared version. Class context contains only author-reviewed summaries."}</p>
      {material.scope && material.id && <MaterialGenerationHistory scope={material.scope} id={material.id} revision={material.metadataRevision} />}
      {material.metadataReviewedAt && <p className="mt-2 text-xs">Suitability tags confirmed by {material.metadataReviewedBy || "the sharing teacher"} on {new Date(material.metadataReviewedAt).toLocaleString()}. This does not recreate missing original generation inputs.</p>}
      {material.generation ? <details className="mt-3"><summary className="cursor-pointer font-medium">Recorded generation inputs</summary><p className="mt-2 text-xs">Captured {new Date(material.generation.capturedAt).toLocaleString()} · {material.generation.model} · {material.generation.operation.replaceAll("-", " ")}. Private classroom inputs stay private. Sharing tags may describe a later teacher edit.</p><dl className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(material.generation.tags).map(([key, value]) => <div key={key}><dt className="font-medium">{GALLERY_TAG_LABELS[key] || key}</dt><dd className="break-words">{value}</dd></div>)}</dl></details>
        : <p className="mt-2 text-xs">Original generation inputs were not recorded. {material.metadataOrigin === "teacher_confirmed" ? "Tags were confirmed by the teacher." : "Some legacy details may be missing."}</p>}
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(promptTags).map(([key, value]) => <div key={key} className="min-w-0">
        <dt className="text-xs font-semibold">{GALLERY_TAG_LABELS[key] || key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-2">{value}</dd>
      </div>)}</dl>
      {!privateMaterial && <div className="mt-4 border-t border-line pt-3 text-xs leading-relaxed">
        <h5 className="font-semibold text-ink">Student performance & feedback</h5>
        {result ? <>
          {result.observedAt && <p className="mt-2">As of {new Date(result.observedAt).toLocaleString()}. Current publications only{result.firstPublicationAt ? `, since ${new Date(result.firstPublicationAt).toLocaleDateString()}` : ""}; feedback from replaced versions is excluded.</p>}
          <p className="mt-2">{result.activityCount} linked learning {result.activityCount === 1 ? "activity" : "activities"}. Engagement ratings use a 1–5 scale, one latest response per learner, including edited classroom copies.</p>
          <p className="mt-2">{result.attributableActivities ? `${result.questionCount} ${result.questionCount === 1 ? "question" : "questions"} from ${result.questionAuthorCount} ${result.questionAuthorCount === 1 ? "learner" : "learners"} in ${result.attributableActivities} attributed ${result.attributableActivities === 1 ? "activity" : "activities"}.` : "Question performance: no attributable data yet."} Questions are attributed to the material version selected by the learner. Older responses without a material link are counted only for single-material activities.</p>
          {result.analyzedQuestionCount > 0 && <p className="mt-2">AI-tagged questions ({result.analyzedQuestionCount}): investigable {result.questionTypes.Investigable || 0}, explanation-seeking {result.questionTypes["Explanation-seeking"] || 0}, clarifying {result.questionTypes.Clarifying || 0}, off-topic {result.questionTypes["Off-topic"] || 0}. Science questions combine investigable and explanation-seeking questions.</p>}
        </> : <p className="mt-2">{feedback?.status === "unavailable" ? "Feedback could not load. Try reopening this material." : "No linked student feedback yet."}</p>}
        <p className="mt-2">Learning gain: not measured. Prior-quiz tags describe the starting class context; ratings and question types do not measure mastery.</p>
      </div>}
    </details>}
  </div>;
}
