import type { TmuxPane } from "@/context-resolver";
import type { WeightedHint } from "@/context-resolver/hint-interpreter";

export type ScoringWeights = {
  hint: number;
  activePane: number;
  activeWindow: number;
  activeSession: number;
  defaultPane: number;
  commandCategories: Record<string, number>;
  layoutBonus: {
    sameWindow: number;
    sameSession: number;
  };
  feedback: {
    positive: number;
    negative: number;
    decayMinutes: number;
  };
};

export type ScoreStage =
  | "default"
  | "hint"
  | "activePane"
  | "activeWindow"
  | "activeSession"
  | "layoutSameWindow"
  | "layoutSameSession"
  | "commandCategory"
  | "feedback";

export type StageContributions = Record<ScoreStage, number>;

export type ScoredPane = {
  pane: TmuxPane;
  total: number;
  reasons: string[];
  stageContributions: StageContributions;
};

export type ScorePanesOptions = {
  panes: TmuxPane[];
  hints: WeightedHint[];
  weights: ScoringWeights;
  feedbackAdjustments: Record<string, number>;
};

export type ScorePanesResult = {
  scored: ScoredPane[];
};

export type MultiStageScorer = {
  scorePanes(options: ScorePanesOptions): ScorePanesResult;
};

const FALLBACK_RECENCY = -Infinity;

const STAGES: ScoreStage[] = [
  "default",
  "hint",
  "activePane",
  "activeWindow",
  "activeSession",
  "layoutSameWindow",
  "layoutSameSession",
  "commandCategory",
  "feedback",
];

const round = (value: number) => Math.round(value * 1e6) / 1e6;

const formatContribution = (value: number) => {
  if (Number.isInteger(value)) return value.toString();
  return (Math.round(value * 100) / 100).toString();
};

const paneMatchesToken = (pane: TmuxPane, token: string) => {
  const lowerToken = token.toLowerCase();
  const candidates: Array<string | undefined> = [
    pane.id,
    pane.title,
    pane.window,
    pane.session,
    pane.currentCommand,
  ];
  if (pane.tags) candidates.push(...pane.tags);
  return candidates.some((candidate) =>
    candidate ? candidate.toLowerCase().includes(lowerToken) : false,
  );
};

const createStageMap = () => {
  const contributions = {} as StageContributions;
  STAGES.forEach((stage) => {
    contributions[stage] = 0;
  });
  return contributions;
};

const computeHintContribution = (
  pane: TmuxPane,
  hints: WeightedHint[],
  weights: ScoringWeights,
  reasons: string[],
) => {
  let total = 0;
  for (const hint of hints) {
    if (!paneMatchesToken(pane, hint.token)) continue;
    const value = round(hint.weight * weights.hint);
    if (value <= 0) continue;
    total += value;
    reasons.push(
      `matched hint "${hint.token}" (+${formatContribution(value)})`,
    );
  }
  return round(total);
};

const computeCommandContribution = (
  pane: TmuxPane,
  weights: ScoringWeights,
  reasons: string[],
) => {
  const command = pane.currentCommand?.toLowerCase();
  if (!command) return 0;
  const weight = weights.commandCategories[command];
  if (!weight) return 0;
  reasons.push(
    `command category "${command}" (+${formatContribution(weight)})`,
  );
  return round(weight);
};

const computeLayoutContribution = (
  pane: TmuxPane,
  activeWindows: Set<string>,
  activeSessions: Set<string>,
  weights: ScoringWeights,
  reasons: string[],
) => {
  let windowContribution = 0;
  let sessionContribution = 0;
  if (activeWindows.has(pane.window)) {
    windowContribution = round(weights.layoutBonus.sameWindow);
    if (windowContribution > 0) {
      reasons.push(
        `same window as active (+${formatContribution(windowContribution)})`,
      );
    }
  }
  if (activeSessions.has(pane.session)) {
    sessionContribution = round(weights.layoutBonus.sameSession);
    if (sessionContribution > 0) {
      reasons.push(
        `same session as active (+${formatContribution(sessionContribution)})`,
      );
    }
  }
  return { windowContribution, sessionContribution };
};

const computeFeedbackContribution = (
  pane: TmuxPane,
  adjustments: Record<string, number>,
  weights: ScoringWeights,
  reasons: string[],
) => {
  const adjustment = adjustments[pane.id];
  if (!adjustment) return 0;
  const positive = adjustment > 0;
  const multiplier = positive
    ? weights.feedback.positive
    : weights.feedback.negative;
  const value = round(multiplier * adjustment);
  if (value === 0) return 0;
  reasons.push(
    `${positive ? "positive" : "negative"} feedback (${formatContribution(value)})`,
  );
  return value;
};

export const createMultiStageScorer = (): MultiStageScorer => {
  const scorePanes = ({
    panes,
    hints,
    weights,
    feedbackAdjustments,
  }: ScorePanesOptions): ScorePanesResult => {
    const activeWindows = new Set(
      panes.filter((pane) => pane.isActiveWindow).map((pane) => pane.window),
    );
    const activeSessions = new Set(
      panes.filter((pane) => pane.isActiveSession).map((pane) => pane.session),
    );

    const scored = panes.map((pane) => {
      const stageContributions = createStageMap();
      const reasons: string[] = [];

      stageContributions.default = round(weights.defaultPane);
      if (stageContributions.default > 0) {
        reasons.push(
          `baseline score (+${formatContribution(stageContributions.default)})`,
        );
      }

      const hintContribution = computeHintContribution(
        pane,
        hints,
        weights,
        reasons,
      );
      if (hintContribution > 0) stageContributions.hint = hintContribution;

      if (pane.isActive) {
        stageContributions.activePane = round(weights.activePane);
        if (stageContributions.activePane > 0) {
          reasons.push(
            `pane is active (+${formatContribution(stageContributions.activePane)})`,
          );
        }
      }
      if (pane.isActiveWindow) {
        stageContributions.activeWindow = round(weights.activeWindow);
        if (stageContributions.activeWindow > 0) {
          reasons.push(
            `window is active (+${formatContribution(
              stageContributions.activeWindow,
            )})`,
          );
        }
      }
      if (pane.isActiveSession) {
        stageContributions.activeSession = round(weights.activeSession);
        if (stageContributions.activeSession > 0) {
          reasons.push(
            `session is active (+${formatContribution(
              stageContributions.activeSession,
            )})`,
          );
        }
      }

      const { windowContribution, sessionContribution } =
        computeLayoutContribution(
          pane,
          activeWindows,
          activeSessions,
          weights,
          reasons,
        );
      if (windowContribution > 0)
        stageContributions.layoutSameWindow = windowContribution;
      if (sessionContribution > 0)
        stageContributions.layoutSameSession = sessionContribution;

      const commandContribution = computeCommandContribution(
        pane,
        weights,
        reasons,
      );
      if (commandContribution > 0)
        stageContributions.commandCategory = commandContribution;

      const feedbackContribution = computeFeedbackContribution(
        pane,
        feedbackAdjustments,
        weights,
        reasons,
      );
      if (feedbackContribution !== 0)
        stageContributions.feedback = feedbackContribution;

      const total = STAGES.reduce(
        (sum, stage) => sum + stageContributions[stage],
        0,
      );

      return {
        pane,
        total: round(total),
        stageContributions,
        reasons,
      } satisfies ScoredPane;
    });

    scored.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const aRecency = a.pane.lastUsed ?? FALLBACK_RECENCY;
      const bRecency = b.pane.lastUsed ?? FALLBACK_RECENCY;
      if (bRecency !== aRecency) return bRecency - aRecency;
      return a.pane.id.localeCompare(b.pane.id);
    });

    return { scored };
  };

  return { scorePanes };
};
