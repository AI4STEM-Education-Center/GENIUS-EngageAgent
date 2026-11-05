/**
 * Class profile (#173): what the teacher tells EngageAgent about a class.
 * One profile per class, shared by every lesson in it. It is used only to
 * tailor materials and is never shown to or about students.
 *
 * Answers are stored as the stable ids below; the labels are for display.
 */

export const SCHOOL_LOCALES = [
  { id: "city", label: "City", description: "A principal city inside an urbanized area" },
  { id: "suburb", label: "Suburb", description: "Inside an urbanized area, outside a principal city" },
  { id: "town", label: "Town", description: "A smaller urban cluster outside urbanized areas" },
  { id: "rural", label: "Rural", description: "Outside urbanized areas and urban clusters" },
] as const;

export const STUDENT_GROUPS = [
  { id: "american_indian_alaska_native", label: "American Indian or Alaska Native" },
  { id: "asian", label: "Asian" },
  { id: "black_african_american", label: "Black or African American" },
  { id: "hispanic_latino", label: "Hispanic or Latino" },
  { id: "middle_eastern_north_african", label: "Middle Eastern or North African" },
  { id: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Pacific Islander" },
  { id: "white", label: "White" },
] as const;

export const GROUP_ALTERNATIVES = [
  { id: "not_sure", label: "Not sure" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const CLASS_TYPES = [
  { id: "general", label: "General education" },
  { id: "honors", label: "Honors" },
  { id: "ap_ib", label: "Advanced Placement (AP) or IB" },
  { id: "gifted", label: "Gifted and talented" },
  { id: "co_taught", label: "Co-taught" },
  { id: "special_education", label: "Special education (self-contained)" },
] as const;

export const MAX_STUDENT_GROUPS = 3;

export type SchoolLocale = (typeof SCHOOL_LOCALES)[number]["id"];
export type StudentGroup = (typeof STUDENT_GROUPS)[number]["id"];
export type GroupAlternative = (typeof GROUP_ALTERNATIVES)[number]["id"];
export type ClassType = (typeof CLASS_TYPES)[number]["id"];

export type ClassProfileAnswers = {
  locale: SchoolLocale | null;
  /** Most represented first, at most three. Empty when groupAlternative is set. */
  groups: StudentGroup[];
  groupAlternative: GroupAlternative | null;
  classType: ClassType | null;
  englishLearners: boolean;
  iepOr504: boolean;
};

export type ClassProfile = ClassProfileAnswers & {
  class_id: string;
  /** "skipped" only appears on older records, from the "Skip for now" popup: nothing is set. */
  status: "saved" | "skipped";
  updated_by?: string;
  updated_at: string;
};

export const EMPTY_CLASS_PROFILE: ClassProfileAnswers = {
  locale: null,
  groups: [],
  groupAlternative: null,
  classType: null,
  englishLearners: false,
  iepOr504: false,
};

/** True once the teacher has answered anything; a blank form isn't worth saving as a profile. */
export function hasClassProfileAnswers(answers: ClassProfileAnswers) {
  return Boolean(
    answers.locale || answers.groups.length || answers.groupAlternative || answers.classType
    || answers.englishLearners || answers.iepOr504,
  );
}

/** The record to store for answers that have already been checked. */
export function savedClassProfile(answers: ClassProfileAnswers, classId: string, updatedBy?: string): ClassProfile {
  return { ...answers, class_id: classId, status: "saved", updated_by: updatedBy, updated_at: new Date().toISOString() };
}

const ids = (list: readonly { id: string }[]) => new Set<string>(list.map((item) => item.id));
const LOCALE_IDS = ids(SCHOOL_LOCALES);
const GROUP_IDS = ids(STUDENT_GROUPS);
const ALTERNATIVE_IDS = ids(GROUP_ALTERNATIVES);
const CLASS_TYPE_IDS = ids(CLASS_TYPES);

const optionalId = <T extends string>(value: unknown, allowed: Set<string>): T | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && allowed.has(value) ? (value as T) : undefined;
};

/**
 * Checks answers sent by the client. Every question is optional, as in the
 * prototype, but any answer given must be one of the listed options.
 */
export function parseClassProfileAnswers(
  input: unknown,
): { answers: ClassProfileAnswers } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "profile must be an object." };
  }
  const raw = input as Record<string, unknown>;

  const locale = optionalId<SchoolLocale>(raw.locale, LOCALE_IDS);
  if (locale === undefined) return { error: "locale is not a valid option." };

  const groupAlternative = optionalId<GroupAlternative>(raw.groupAlternative, ALTERNATIVE_IDS);
  if (groupAlternative === undefined) return { error: "groupAlternative is not a valid option." };

  const classType = optionalId<ClassType>(raw.classType, CLASS_TYPE_IDS);
  if (classType === undefined) return { error: "classType is not a valid option." };

  const groups = raw.groups ?? [];
  if (!Array.isArray(groups) || groups.some((group) => typeof group !== "string" || !GROUP_IDS.has(group))) {
    return { error: "groups must only contain listed options." };
  }
  if (new Set(groups).size !== groups.length) return { error: "groups must not repeat." };
  if (groups.length > MAX_STUDENT_GROUPS) return { error: `Choose up to ${MAX_STUDENT_GROUPS} groups.` };
  if (groupAlternative && groups.length) {
    return { error: "groups must be empty when Not sure or Prefer not to say is chosen." };
  }

  for (const key of ["englishLearners", "iepOr504"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") return { error: `${key} must be true or false.` };
  }

  return {
    answers: {
      locale,
      groups: groups as StudentGroup[],
      groupAlternative,
      classType,
      englishLearners: raw.englishLearners === true,
      iepOr504: raw.iepOr504 === true,
    },
  };
}

/**
 * Selecting a group in the form: a selected group is removed (the rest move
 * up), a new one is added at the end, and a fourth is refused. Picking a
 * group also clears "Not sure" / "Prefer not to say".
 */
export function toggleStudentGroup(
  answers: ClassProfileAnswers,
  group: StudentGroup,
): { answers: ClassProfileAnswers; full: boolean } {
  if (answers.groups.includes(group)) {
    return { answers: { ...answers, groups: answers.groups.filter((g) => g !== group) }, full: false };
  }
  if (answers.groups.length >= MAX_STUDENT_GROUPS) return { answers, full: true };
  return { answers: { ...answers, groups: [...answers.groups, group], groupAlternative: null }, full: false };
}

/** Choosing "Not sure" / "Prefer not to say" clears the groups; choosing it again unselects it. */
export function toggleGroupAlternative(
  answers: ClassProfileAnswers,
  alternative: GroupAlternative,
): ClassProfileAnswers {
  if (answers.groupAlternative === alternative) return { ...answers, groupAlternative: null };
  return { ...answers, groupAlternative: alternative, groups: [] };
}

const labelOf = (list: readonly { id: string; label: string }[], id: string | null) =>
  list.find((item) => item.id === id)?.label ?? null;

/**
 * Readable summary for places that show the profile (e.g. Step 3's context
 * panel). Anything the teacher skipped or left blank reads "Not set".
 */
export function describeClassProfile(profile: ClassProfileAnswers | null) {
  const answers = profile ?? EMPTY_CLASS_PROFILE;
  const supports = [
    answers.englishLearners && "English learners",
    answers.iepOr504 && "IEPs or Section 504 plans",
  ].filter(Boolean);
  return {
    location: labelOf(SCHOOL_LOCALES, answers.locale) ?? "Not set",
    groups:
      labelOf(GROUP_ALTERNATIVES, answers.groupAlternative) ??
      ((answers.groups ?? []).map((id) => labelOf(STUDENT_GROUPS, id)).join(", ") || "Not set"),
    classType: labelOf(CLASS_TYPES, answers.classType) ?? "Not set",
    supports: supports.length ? supports.join(", ") : "No supports noted",
  };
}
