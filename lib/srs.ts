export type Quality = "again" | "hard" | "easy";

export interface SRSUpdate {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: number;
}

type CardSRSFields = {
  easeFactor?: number | null;
  interval?: number | null;
  repetitions?: number | null;
  nextReviewAt?: number | null;
};

// Intervals in hours for the first reviews before exponential growth kicks in.
const INITIAL_INTERVALS_HRS = [5, 12, 24, 72];

export function computeNextReview(card: CardSRSFields, quality: Quality): SRSUpdate {
  const EF = card.easeFactor ?? 2.5;
  const reps = card.repetitions ?? 0;
  const interval = card.interval ?? 0; // stored in hours
  const q = quality === "easy" ? 5 : quality === "hard" ? 3 : 1;

  let newReps: number;
  let newIntervalHrs: number;

  if (q < 3) {
    newReps = 0;
    newIntervalHrs = INITIAL_INTERVALS_HRS[0];
  } else {
    newReps = reps + 1;
    if (newReps <= INITIAL_INTERVALS_HRS.length) {
      newIntervalHrs = INITIAL_INTERVALS_HRS[newReps - 1];
    } else {
      newIntervalHrs = Math.round(interval * EF);
    }
  }

  const newEF = Math.max(1.3, EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const nextReviewAt = Date.now() + newIntervalHrs * 3_600_000;

  return { easeFactor: newEF, interval: newIntervalHrs, repetitions: newReps, nextReviewAt };
}

export function isDue(card: CardSRSFields): boolean {
  return !card.nextReviewAt || card.nextReviewAt <= Date.now();
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
