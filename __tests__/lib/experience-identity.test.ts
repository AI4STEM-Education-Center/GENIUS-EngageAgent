import { expect, it } from "vitest";
import { experienceIdentity, sameExperience } from "@/lib/experience-identity";
import { galleryMatches } from "@/lib/material-gallery-tags";
import type { GalleryMaterial } from "@/lib/material-gallery";
it.each([
  ["Press a spring mattress", "Pressing a spring mattress"],
  ["Watching a ball bounce", "watched the ball bounce"],
  ["Bounce a rubber ball", "Bouncing rubber balls"],
  ["Press the spring-mattress", "pressing a spring mattress"],
])("matches the same reported activity across labels: %s", (a, b) => {
  expect(experienceIdentity(a)).toBe(experienceIdentity(b));
  const item = { lessonNumber: 3, strategy: "analogy", experienceContext: a } as GalleryMaterial;
  expect(galleryMatches(item, 3, "analogy", undefined, { EXPERIENCE_CONTEXT: b }).tags.find(t => t.label === "Experience")?.matched).toBe(true);
});
it.each([
  ["Press a spring mattress", "Jump on a trampoline"],
  ["Bounce a rubber ball", "Drop a rubber ball"],
  ["Press a spring mattress", "Do not press a spring mattress"],
  ["Not supplied", "Not supplied"], ["", ""],
])("does not invent a match between different or absent experiences: %s", (a, b) => expect(sameExperience(a, b)).toBe(false));
