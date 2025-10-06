export type FeedbackRating = "match" | "mismatch";

export type FeedbackRecord = {
  paneId: string;
  rating: FeedbackRating;
  hintSignature?: string;
  timestamp: number;
};

export type FeedbackManagerOptions = {
  ttlMs: number;
  maxEntries: number;
};

export type FeedbackManager = {
  register(record: FeedbackRecord): void;
  getAdjustments(now: number): Record<string, number>;
};

const clampToRange = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const createFeedbackManager = (
  options: FeedbackManagerOptions,
): FeedbackManager => {
  const ttlMs = Math.max(1, options.ttlMs);
  let records: FeedbackRecord[] = [];

  const prune = (now: number) => {
    const cutoff = now - ttlMs;
    records = records.filter((record) => record.timestamp >= cutoff);
    if (records.length > options.maxEntries) {
      records.sort((a, b) => a.timestamp - b.timestamp);
      records = records.slice(records.length - options.maxEntries);
    }
  };

  const register = (record: FeedbackRecord) => {
    if (!record.paneId) return;
    if (!Number.isFinite(record.timestamp)) return;
    if (record.rating !== "match" && record.rating !== "mismatch") return;
    records.push(record);
  };

  const getAdjustments = (now: number) => {
    prune(now);
    const adjustments: Record<string, number> = {};
    for (const record of records) {
      const age = Math.max(0, now - record.timestamp);
      if (age >= ttlMs) continue;
      const decay = 1 - age / ttlMs;
      const contribution =
        (record.rating === "match" ? 1 : -1) * clampToRange(decay, 0, 1);
      if (contribution === 0) continue;
      adjustments[record.paneId] =
        (adjustments[record.paneId] ?? 0) + contribution;
    }
    return adjustments;
  };

  return { register, getAdjustments };
};
