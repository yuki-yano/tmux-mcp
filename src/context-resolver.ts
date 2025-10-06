import type { FeedbackManager } from "@/context-resolver/feedback-manager";
import { createFeedbackManager } from "@/context-resolver/feedback-manager";
import type {
  HintInterpreter,
  HintInterpreterResult,
} from "@/context-resolver/hint-interpreter";
import { createHintInterpreter } from "@/context-resolver/hint-interpreter";
import type {
  MultiStageScorer,
  ScoredPane,
  ScoringWeights,
  StageContributions,
} from "@/context-resolver/multi-stage-scorer";
import { createMultiStageScorer } from "@/context-resolver/multi-stage-scorer";

export type TmuxPane = {
  id: string;
  title: string;
  session: string;
  window: string;
  currentCommand?: string;
  isActive?: boolean;
  isActiveWindow?: boolean;
  isActiveSession?: boolean;
  lastUsed?: number;
  tags?: string[];
};

export type DescribeContextRequest = {
  paneHint?: string;
  paneHints?: Array<{ value: string; weight?: number }>;
  tags?: string[];
  debug?: boolean;
  feedback?: {
    paneId: string;
    rating: "match" | "mismatch";
    hintContext?: string;
  };
};

export type DescribeContextResultPane = {
  id: string;
  title: string;
  session: string;
  window: string;
  command?: string;
  score: number;
  reasons: string[];
};

export type DescribeContextDebug = {
  hints: HintInterpreterResult;
  stages: Array<{
    paneId: string;
    total: number;
    stageContributions: StageContributions;
  }>;
  feedback: {
    adjustments: Record<string, number>;
  };
};

export type DescribeContextResult = {
  sessionPanes: DescribeContextResultPane[];
  debug?: DescribeContextDebug;
};

export type ContextResolverOptions = {
  tmux: {
    listPanes: () => Promise<TmuxPane[]>;
    getCurrentSession?: () => Promise<string | undefined>;
  };
  weights?: ScoringWeights;
  hintInterpreter?: HintInterpreter;
  scorer?: MultiStageScorer;
  feedbackManager?: FeedbackManager;
  feedbackMaxEntries?: number;
  feedbackAdjustments?: () => Record<string, number>;
  now?: () => number;
};

export type ContextResolver = {
  describe: (request: DescribeContextRequest) => Promise<DescribeContextResult>;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  hint: 4,
  activePane: 3,
  activeWindow: 2,
  activeSession: 1,
  defaultPane: 0.5,
  commandCategories: {
    vim: 2,
    tail: 1,
    ssh: 1,
  },
  layoutBonus: {
    sameWindow: 1.5,
    sameSession: 0.75,
  },
  feedback: {
    positive: 1,
    negative: 1,
    decayMinutes: 30,
  },
};

const createNoPaneError = () =>
  new Error(
    "No tmux panes were detected. Run `tmux list-panes` to verify the state or specify a pane manually.",
  );

const toResultPane = (entry: ScoredPane): DescribeContextResultPane => ({
  id: entry.pane.id,
  title: entry.pane.title,
  session: entry.pane.session,
  window: entry.pane.window,
  command: entry.pane.currentCommand,
  score: entry.total,
  reasons: entry.reasons,
});

export const createContextResolver = (
  options: ContextResolverOptions,
): ContextResolver => {
  const baseWeights = options.weights ?? DEFAULT_SCORING_WEIGHTS;
  const hintInterpreter = options.hintInterpreter ?? createHintInterpreter();
  const scorer = options.scorer ?? createMultiStageScorer();
  const now = options.now ?? Date.now;
  const feedbackManager =
    options.feedbackManager ??
    createFeedbackManager({
      ttlMs: baseWeights.feedback.decayMinutes * 60_000,
      maxEntries: options.feedbackMaxEntries ?? 200,
    });

  const describe = async (
    request: DescribeContextRequest,
  ): Promise<DescribeContextResult> => {
    const panes = await options.tmux.listPanes();
    if (panes.length === 0) throw createNoPaneError();

    const agentSession = options.tmux.getCurrentSession
      ? await options.tmux.getCurrentSession()
      : undefined;
    const activeSessionIds = new Set(
      panes.filter((pane) => pane.isActiveSession).map((pane) => pane.session),
    );
    let scopedPanes = panes;
    if (agentSession) {
      scopedPanes = panes.filter((pane) => pane.session === agentSession);
    } else if (activeSessionIds.size > 0) {
      scopedPanes = panes.filter((pane) => activeSessionIds.has(pane.session));
    }
    if (scopedPanes.length === 0) throw createNoPaneError();

    const interpretedHints = await hintInterpreter.interpret({
      paneHint: request.paneHint,
      paneHints: request.paneHints,
    });

    const timestamp = now();

    if (request.feedback) {
      feedbackManager.register({
        paneId: request.feedback.paneId,
        rating: request.feedback.rating,
        hintSignature: request.feedback.hintContext,
        timestamp,
      });
    }

    const externalAdjustments = options.feedbackAdjustments?.() ?? {};
    const managerAdjustments = feedbackManager.getAdjustments(timestamp);
    const feedbackAdjustments: Record<string, number> = {
      ...externalAdjustments,
    };
    for (const [paneId, value] of Object.entries(managerAdjustments)) {
      feedbackAdjustments[paneId] = (feedbackAdjustments[paneId] ?? 0) + value;
    }

    const { scored } = scorer.scorePanes({
      panes: scopedPanes,
      hints: interpretedHints.weightedHints,
      weights: baseWeights,
      feedbackAdjustments,
    });

    if (scored.length === 0) throw createNoPaneError();

    const sessionPanes = scored.map(toResultPane);
    if (sessionPanes.length === 0) throw createNoPaneError();

    const result: DescribeContextResult = {
      sessionPanes,
    };

    if (request.debug) {
      result.debug = {
        hints: interpretedHints,
        stages: scored.map((entry) => ({
          paneId: entry.pane.id,
          total: entry.total,
          stageContributions: entry.stageContributions,
        })),
        feedback: {
          adjustments: feedbackAdjustments,
        },
      };
    }

    return result;
  };

  return { describe };
};

export type { ScoringWeights, StageContributions };
export type {
  HintInterpreterResult,
  WeightedHint,
} from "@/context-resolver/hint-interpreter";
