/** Stable public activity identity. Never contains a class/student/check-in ID.
 * Conservative aliases handle common wording changes without merging merely
 * related activities (pressing a mattress is not jumping on a trampoline).
 * Unknown descriptions retain their complete normalized wording.
 */
const forms: Record<string, string> = {
  pressing: "press", presses: "press", pressed: "press",
  pushing: "push", pushes: "push", pushed: "push",
  pulling: "pull", pulls: "pull", pulled: "pull",
  bouncing: "bounce", bounces: "bounce", bounced: "bounce",
  dropping: "drop", drops: "drop", dropped: "drop",
  watching: "watch", watches: "watch", watched: "watch",
  jumping: "jump", jumps: "jump", jumped: "jump",
  kicking: "kick", kicks: "kick", kicked: "kick",
  stretching: "stretch", stretches: "stretch", stretched: "stretch",
  squeezing: "squeeze", squeezes: "squeeze", squeezed: "squeeze",
  balls: "ball", springs: "spring", mattresses: "mattress", pillows: "pillow",
  carts: "cart", cars: "car", bands: "band", trampolines: "trampoline",
};
export function experienceIdentity(label?: string): string {
  const value = label?.normalize("NFKC").trim().toLocaleLowerCase() || "";
  if (!value || /^(not (supplied|provided|recorded|shared)|unknown|none)$/u.test(value)) return "";
  const words = value.replace(/[’']/gu, "").match(/[\p{L}\p{N}]+/gu) || [];
  const normalized = words.filter(word => !["a", "an", "the"].includes(word)).map(word => forms[word] || word).join("-");
  return normalized ? `activity:v1:${normalized}` : "";
}
export function sameExperience(a?: string, b?: string): boolean {
  const key = experienceIdentity(a);
  return Boolean(key && key === experienceIdentity(b));
}
