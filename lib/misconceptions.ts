/**
 * One list of every misconception used in the lessons, with an ID that is
 * unique across lessons.
 *
 * The lesson files use short codes that only mean something inside one
 * lesson ("a" in Lesson 1 is not "a" in Lesson 3), and two lessons repeat
 * the same misconception under different codes. `MisconceptionId` gives each
 * distinct misconception one stable ID, and `LESSON_MISCONCEPTIONS` maps each
 * lesson's codes to it.
 *
 * The IDs are stored with quiz matches, so never renumber or reuse one. Add
 * new misconceptions at the end with the next number.
 */
export enum MisconceptionId {
  NoVisibleDamageMeansWeakForce = "MC01",
  HeavierAlwaysCausesMoreDamage = "MC02",
  ForceNeededForConstantSpeed = "MC03",
  BalancedForcesMeanAtRest = "MC04",
  ChangeInMotionMeansChangeInForce = "MC05",
  EnergyLostInInelasticCollision = "MC06",
  MomentumAndEnergyAreTheSame = "MC07",
  BendingMeansPermanentDamage = "MC08",
  SameForceSameDeformation = "MC09",
  ElasticLimitIsAForce = "MC10",
  ThickerIsHarderToBreak = "MC11",
  BreakingPointIsHowMuchItBends = "MC12",
  SmallForceCausesNoDeformation = "MC13",
  HeavierObjectExertsLargerForce = "MC14",
  FasterObjectExertsLargerForce = "MC15",
  ActivePusherExertsMoreForce = "MC16",
  StationaryObjectsExertNoForce = "MC17",
  MoreMassiveObjectHasLargerPeakForce = "MC18",
  MoreKineticEnergyMeansLargerForceApplied = "MC19",
  MoreKineticEnergyGivesLargerPeakForce = "MC20",
  BiggerOrFasterPlayerExertsMoreForce = "MC21",
  KineticEnergyDependsOnMassOnly = "MC22",
  DoubleSpeedDoublesKineticEnergy = "MC23",
  KineticEnergyIsMomentum = "MC24",
  EnergyIsUsedUpByMoving = "MC25",
  ForceDeterminesSpeed = "MC26",
  MotionImpliesForce = "MC27",
  ElasticEnergyIndependentOfDeformation = "MC28",
  ElasticEnergyReversedWithStretch = "MC29",
  EnergyUsedUpNotTransformed = "MC30",
  EnergyConservedIfItStaysInSystem = "MC31",
}

export const MISCONCEPTION_TEXT: Record<MisconceptionId, string> = {
  [MisconceptionId.NoVisibleDamageMeansWeakForce]:
    "If nothing looks damaged after the collision, the force must have been weak.",
  [MisconceptionId.HeavierAlwaysCausesMoreDamage]:
    "Heavier objects always cause more damage. (not thinking about other factors)",
  [MisconceptionId.ForceNeededForConstantSpeed]:
    "A force is needed to keep something moving at constant speed.",
  [MisconceptionId.BalancedForcesMeanAtRest]:
    "Balanced forces mean the object must be at rest.",
  [MisconceptionId.ChangeInMotionMeansChangeInForce]:
    "If motion changes, there is a change in force.",
  [MisconceptionId.EnergyLostInInelasticCollision]:
    "Energy is lost/disappears in an inelastic ('sticky') collision.",
  [MisconceptionId.MomentumAndEnergyAreTheSame]:
    "Momentum and energy are the same (or both are always conserved).",
  [MisconceptionId.BendingMeansPermanentDamage]:
    "If it bends, it must be damaged (permanent). If it 'looks normal,' no deformation happened.",
  [MisconceptionId.SameForceSameDeformation]:
    "Same force always means the same deformation regardless of area.",
  [MisconceptionId.ElasticLimitIsAForce]:
    "Elastic limit is an amount of force (or a visible bend), not a material threshold.",
  [MisconceptionId.ThickerIsHarderToBreak]:
    "The thicker the object is, the more challenging it is to be broken.",
  [MisconceptionId.BreakingPointIsHowMuchItBends]:
    "Breaking point is how much something bends.",
  [MisconceptionId.SmallForceCausesNoDeformation]:
    "If force applied is not enough, for some objects, they won't deform.",
  [MisconceptionId.HeavierObjectExertsLargerForce]:
    "Heavier object exerts the larger force in a collision.",
  [MisconceptionId.FasterObjectExertsLargerForce]:
    "Faster object exerts the larger force.",
  [MisconceptionId.ActivePusherExertsMoreForce]:
    "The 'active' pusher produces more force than the 'passive' object.",
  [MisconceptionId.StationaryObjectsExertNoForce]:
    "Stationary objects cannot exert forces.",
  [MisconceptionId.MoreMassiveObjectHasLargerPeakForce]:
    "At the moment of impact, the more massive object exerts the larger peak force.",
  [MisconceptionId.MoreKineticEnergyMeansLargerForceApplied]:
    "Increasing KE of an object indicates a larger force applied to the object.",
  [MisconceptionId.MoreKineticEnergyGivesLargerPeakForce]:
    "During a collision, an object with more KE applies a larger peak force than that it receives.",
  [MisconceptionId.BiggerOrFasterPlayerExertsMoreForce]:
    "Students may think that in a collision between two players, the bigger or faster player exerts a greater force on the smaller or slower player, rather than both players experiencing equal forces.",
  [MisconceptionId.KineticEnergyDependsOnMassOnly]:
    "Kinetic energy depends on mass only.",
  [MisconceptionId.DoubleSpeedDoublesKineticEnergy]:
    "Double of speed doubles kinetic energy.",
  [MisconceptionId.KineticEnergyIsMomentum]: "Kinetic energy is momentum.",
  [MisconceptionId.EnergyIsUsedUpByMoving]:
    "An object has energy within it that is used up as the object moves.",
  [MisconceptionId.ForceDeterminesSpeed]:
    "Force determines speed, not acceleration (constant force, constant speed).",
  [MisconceptionId.MotionImpliesForce]:
    "Motion implies force (object in motion has a forward force).",
  [MisconceptionId.ElasticEnergyIndependentOfDeformation]:
    "Elastic PE does not depend on amount of deformation.",
  [MisconceptionId.ElasticEnergyReversedWithStretch]:
    "Reversed dependence with stretch (e.g., a rubber band stretched farther has less elastic energy).",
  [MisconceptionId.EnergyUsedUpNotTransformed]:
    "Energy 'used up' or 'lost,' not transformed to thermal/sound/internal energy during contact.",
  [MisconceptionId.EnergyConservedIfItStaysInSystem]:
    "If stays in system, energy will be conserved.",
};

/** Each lesson's own misconception codes, mapped to the shared IDs. */
export const LESSON_MISCONCEPTIONS: Record<number, Record<string, MisconceptionId>> = {
  1: {
    a: MisconceptionId.NoVisibleDamageMeansWeakForce,
    b: MisconceptionId.HeavierAlwaysCausesMoreDamage,
  },
  2: {
    "1-a": MisconceptionId.ForceNeededForConstantSpeed,
    "1-b": MisconceptionId.BalancedForcesMeanAtRest,
    "2-a": MisconceptionId.ChangeInMotionMeansChangeInForce,
    "3-a": MisconceptionId.EnergyLostInInelasticCollision,
    "3-b": MisconceptionId.MomentumAndEnergyAreTheSame,
  },
  3: {
    a: MisconceptionId.BendingMeansPermanentDamage,
    b: MisconceptionId.SameForceSameDeformation,
  },
  4: {
    "1-a": MisconceptionId.BendingMeansPermanentDamage,
    "1-b": MisconceptionId.SameForceSameDeformation,
    "2-a": MisconceptionId.ElasticLimitIsAForce,
    "3-a": MisconceptionId.ThickerIsHarderToBreak,
    "3-b": MisconceptionId.BreakingPointIsHowMuchItBends,
    "4-a": MisconceptionId.SmallForceCausesNoDeformation,
  },
  5: {
    "1-a": MisconceptionId.HeavierObjectExertsLargerForce,
    "1-b": MisconceptionId.FasterObjectExertsLargerForce,
    "1-c": MisconceptionId.ActivePusherExertsMoreForce,
    "1-d": MisconceptionId.StationaryObjectsExertNoForce,
    "2-a": MisconceptionId.MoreMassiveObjectHasLargerPeakForce,
    "3-a": MisconceptionId.MoreKineticEnergyMeansLargerForceApplied,
    "4-a": MisconceptionId.MoreKineticEnergyGivesLargerPeakForce,
  },
  6: {
    "1": MisconceptionId.BiggerOrFasterPlayerExertsMoreForce,
  },
  7: {
    a: MisconceptionId.KineticEnergyDependsOnMassOnly,
    b: MisconceptionId.DoubleSpeedDoublesKineticEnergy,
    c: MisconceptionId.KineticEnergyIsMomentum,
    d: MisconceptionId.EnergyIsUsedUpByMoving,
  },
  8: {
    "1&2-a": MisconceptionId.ForceDeterminesSpeed,
    "1&2-b": MisconceptionId.MotionImpliesForce,
    "3-a": MisconceptionId.ElasticEnergyIndependentOfDeformation,
    "3-b": MisconceptionId.ElasticEnergyReversedWithStretch,
    "4-a": MisconceptionId.EnergyUsedUpNotTransformed,
    "4-b": MisconceptionId.EnergyConservedIfItStaysInSystem,
  },
};

const ALL_IDS = new Set<string>(Object.values(MisconceptionId));

export function isMisconceptionId(value: string): value is MisconceptionId {
  return ALL_IDS.has(value);
}

/** Every misconception in ID order, for pickers and searches. */
export function listMisconceptions(): { id: MisconceptionId; text: string }[] {
  return Object.values(MisconceptionId).map((id) => ({
    id,
    text: MISCONCEPTION_TEXT[id],
  }));
}

/**
 * Turns a lesson's code field into shared IDs. Quiz items sometimes list more
 * than one code in a field ("1-a, 2-a"), so the value is split on commas.
 * Codes the lesson doesn't define are skipped.
 */
export function toMisconceptionIds(
  lessonNumber: number,
  codes: string | undefined,
): MisconceptionId[] {
  const lessonCodes = LESSON_MISCONCEPTIONS[lessonNumber] ?? {};
  const ids: MisconceptionId[] = [];
  for (const code of (codes ?? "").split(",")) {
    const id = lessonCodes[code.trim()];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
