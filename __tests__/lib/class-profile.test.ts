import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasClassProfileAnswers,
  savedClassProfile,
  EMPTY_CLASS_PROFILE,
  describeClassProfile,
  classProfileGenerationSummary,
  parseClassProfileAnswers,
  toggleGroupAlternative,
  toggleStudentGroup,
  type ClassProfile,
  type ClassProfileAnswers,
} from "@/lib/class-profile";

const full = {
  locale: "suburb",
  groups: ["hispanic_latino", "white"],
  groupAlternative: null,
  classType: "honors",
  englishLearners: true,
  iepOr504: false,
};

it("adds only stated instructional context and omits unset, skipped and demographic-only profiles", () => {
  expect(classProfileGenerationSummary(null)).toBe("");
  const profile = savedClassProfile({ ...EMPTY_CLASS_PROFILE, groups: ["asian"] }, "private-class", "private-author");
  expect(classProfileGenerationSummary(profile)).toBe("");
  expect(classProfileGenerationSummary({ ...profile, status: "skipped", locale: "rural" })).toBe("");
  const summary = classProfileGenerationSummary({ ...profile, locale: "rural", englishLearners: true });
  expect(summary).toContain("School setting: Rural");
  expect(summary).toContain("vocabulary scaffolds");
  expect(summary).toContain("not to infer individual ability");
  expect(summary).not.toMatch(/asian|private-class|private-author|Class type|accommodations/);
});

describe("parseClassProfileAnswers", () => {
  it("accepts a full profile and keeps the group order", () => {
    expect(parseClassProfileAnswers(full)).toEqual({ answers: full });
  });

  it("accepts an empty profile, since every question is optional", () => {
    expect(parseClassProfileAnswers({})).toEqual({ answers: EMPTY_CLASS_PROFILE });
  });

  it.each([
    [{ locale: "village" }, "locale is not a valid option."],
    [{ classType: "remedial" }, "classType is not a valid option."],
    [{ groupAlternative: "unknown" }, "groupAlternative is not a valid option."],
    [{ groups: ["martian"] }, "groups must only contain listed options."],
    [{ groups: "asian" }, "groups must only contain listed options."],
    [{ groups: ["asian", "asian"] }, "groups must not repeat."],
    [{ groups: ["asian", "white", "hispanic_latino", "black_african_american"] }, "Choose up to 3 groups."],
    [{ groups: ["asian"], groupAlternative: "not_sure" }, "groups must be empty when Not sure or Prefer not to say is chosen."],
    [{ englishLearners: "yes" }, "englishLearners must be true or false."],
  ])("rejects %j", (input, error) => {
    expect(parseClassProfileAnswers(input)).toEqual({ error });
  });

  it("rejects a missing or non-object profile", () => {
    for (const input of [undefined, null, "x", []]) {
      expect(parseClassProfileAnswers(input)).toEqual({ error: "profile must be an object." });
    }
  });
});

describe("selecting groups", () => {
  it("ranks groups in the order they are picked and refuses a fourth", () => {
    let answers = EMPTY_CLASS_PROFILE;
    for (const group of ["white", "asian", "hispanic_latino"] as const) {
      answers = toggleStudentGroup(answers, group).answers;
    }
    expect(answers.groups).toEqual(["white", "asian", "hispanic_latino"]);

    const fourth = toggleStudentGroup(answers, "black_african_american");
    expect(fourth.full).toBe(true);
    expect(fourth.answers.groups).toEqual(["white", "asian", "hispanic_latino"]);
  });

  it("removes a selected group and moves the rest up", () => {
    const answers = { ...EMPTY_CLASS_PROFILE, groups: ["white", "asian", "hispanic_latino"] as ClassProfile["groups"] };
    expect(toggleStudentGroup(answers, "white").answers.groups).toEqual(["asian", "hispanic_latino"]);
  });

  it("makes Not sure / Prefer not to say and groups exclude each other", () => {
    const withGroups = { ...EMPTY_CLASS_PROFILE, groups: ["asian"] as ClassProfile["groups"] };
    const unsure = toggleGroupAlternative(withGroups, "not_sure");
    expect(unsure).toMatchObject({ groupAlternative: "not_sure", groups: [] });
    expect(toggleGroupAlternative(unsure, "not_sure").groupAlternative).toBeNull();
    expect(toggleGroupAlternative(unsure, "prefer_not_to_say").groupAlternative).toBe("prefer_not_to_say");
    expect(toggleStudentGroup(unsure, "white").answers).toMatchObject({ groupAlternative: null, groups: ["white"] });
  });
});

describe("class profile storage (local store)", () => {
  let dir = "";
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("saves one profile per class and replaces it on the next save", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "engage-class-profile-"));
    vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
    vi.stubEnv("DYNAMODB_TABLE", "");
    vi.resetModules();
    const { getClassProfile, upsertClassProfile } = await import("@/lib/nosql");

    expect(await getClassProfile("class-1")).toBeNull();
    const first: ClassProfile = { ...EMPTY_CLASS_PROFILE, class_id: "class-1", status: "skipped", updated_at: "2026-11-02T00:00:00.000Z" };
    await upsertClassProfile(first);
    const second = { ...full, class_id: "class-1", status: "saved", updated_by: "t1", updated_at: "2026-11-02T01:00:00.000Z" } as ClassProfile;
    await upsertClassProfile(second);

    expect(await getClassProfile("class-1")).toEqual(second);
    expect(await getClassProfile("class-2")).toBeNull();
  });
});

describe("describeClassProfile", () => {
  it("reads 'Not set' for anything skipped or left blank", () => {
    expect(describeClassProfile(null)).toEqual({
      location: "Not set",
      groups: "Not set",
      classType: "Not set",
      supports: "No supports noted",
    });
  });

  it("uses the display labels, with groups in ranked order", () => {
    expect(describeClassProfile(full as ClassProfile)).toEqual({
      location: "Suburb",
      groups: "Hispanic or Latino, White",
      classType: "Honors",
      supports: "English learners",
    });
    expect(describeClassProfile({ ...EMPTY_CLASS_PROFILE, groupAlternative: "prefer_not_to_say", iepOr504: true }).groups).toBe("Prefer not to say");
  });
});

it("describes a stored profile with missing answers without crashing", () => {
  const partial = { status: "saved" } as unknown as Parameters<typeof describeClassProfile>[0];
  expect(describeClassProfile(partial)).toEqual({ location: "Not set", groups: "Not set", classType: "Not set", supports: "No supports noted" });
});

describe("hasClassProfileAnswers", () => {
  it("is false for a blank form", () => {
    expect(hasClassProfileAnswers(EMPTY_CLASS_PROFILE)).toBe(false);
  });

  it.each([
    [{ locale: "rural" }],
    [{ groups: ["white"] }],
    [{ groupAlternative: "not_sure" }],
    [{ classType: "honors" }],
    [{ englishLearners: true }],
    [{ iepOr504: true }],
  ])("is true with any one answer: %j", (answer) => {
    expect(hasClassProfileAnswers({ ...EMPTY_CLASS_PROFILE, ...answer } as ClassProfileAnswers)).toBe(true);
  });
});

it("savedClassProfile builds the record for a class", () => {
  expect(savedClassProfile(EMPTY_CLASS_PROFILE, "c1", "t1")).toEqual({
    ...EMPTY_CLASS_PROFILE, class_id: "c1", status: "saved", updated_by: "t1", updated_at: expect.any(String),
  });
});
