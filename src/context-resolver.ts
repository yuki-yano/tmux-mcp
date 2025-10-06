const FALLBACK_RECENCY = -Infinity;
const HINT_PRIORITY = 0;
const ACTIVE_PRIORITY = 1;
const ACTIVE_WINDOW_PRIORITY = 2;
const ACTIVE_SESSION_PRIORITY = 3;
const DEFAULT_PRIORITY = 4;

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
  tags?: string[];
};

export type DescribeContextResultPane = {
  id: string;
  title: string;
  session: string;
  window: string;
  command?: string;
};

export type DescribeContextResult = {
  primaryPane: DescribeContextResultPane;
  candidates: DescribeContextResultPane[];
};

export type ContextResolverOptions = {
  tmux: {
    listPanes: () => Promise<TmuxPane[]>;
  };
};

export type ContextResolver = {
  describe: (request: DescribeContextRequest) => Promise<DescribeContextResult>;
};

const normalizePane = (pane: TmuxPane): DescribeContextResultPane => ({
  id: pane.id,
  title: pane.title,
  session: pane.session,
  window: pane.window,
  command: pane.currentCommand,
});

const paneMatchesHint = (pane: TmuxPane, hint: string) => {
  const lowerHint = hint.toLowerCase();
  if (pane.id.toLowerCase() === lowerHint) return true;
  if (pane.title.toLowerCase().includes(lowerHint)) return true;
  if (pane.window.toLowerCase().includes(lowerHint)) return true;
  if (pane.session.toLowerCase().includes(lowerHint)) return true;
  if (pane.tags?.some((tag) => tag.toLowerCase().includes(lowerHint)))
    return true;
  if (pane.currentCommand?.toLowerCase().includes(lowerHint)) return true;
  return false;
};

const createPriority = (
  pane: TmuxPane,
  hint: string | undefined,
  activeSessions: Set<string>,
) => {
  const recencyScore = pane.lastUsed ?? FALLBACK_RECENCY;
  if (hint && paneMatchesHint(pane, hint)) {
    return {
      score: HINT_PRIORITY,
      recencyScore,
    };
  }

  const isInActiveSession =
    activeSessions.size === 0 || activeSessions.has(pane.session);

  if (pane.isActive && isInActiveSession) {
    return {
      score: ACTIVE_PRIORITY,
      recencyScore,
    };
  }
  if (pane.isActiveWindow) {
    return {
      score: ACTIVE_WINDOW_PRIORITY,
      recencyScore,
    };
  }
  if (pane.isActiveSession) {
    return {
      score: ACTIVE_SESSION_PRIORITY,
      recencyScore,
    };
  }
  return {
    score: DEFAULT_PRIORITY,
    recencyScore,
  };
};

const comparePriority = (
  a: { pane: TmuxPane; priority: ReturnType<typeof createPriority> },
  b: { pane: TmuxPane; priority: ReturnType<typeof createPriority> },
) => {
  if (a.priority.score !== b.priority.score) {
    return a.priority.score - b.priority.score;
  }
  if (a.priority.recencyScore !== b.priority.recencyScore) {
    return b.priority.recencyScore - a.priority.recencyScore;
  }
  return a.pane.id.localeCompare(b.pane.id);
};

const createNoPaneError = () =>
  new Error(
    "No tmux panes were detected. Run `tmux list-panes` to verify the state or specify a pane manually.",
  );

export const createContextResolver = (
  options: ContextResolverOptions,
): ContextResolver => {
  const describe = async (request: DescribeContextRequest) => {
    const panes = await options.tmux.listPanes();
    if (panes.length === 0) throw createNoPaneError();

    const activeSessions = new Set(
      panes.filter((pane) => pane.isActiveSession).map((pane) => pane.session),
    );

    const sorted = panes
      .map((pane) => ({
        pane,
        priority: createPriority(pane, request.paneHint, activeSessions),
      }))
      .sort(comparePriority)
      .map((entry) => normalizePane(entry.pane));

    const [primaryPane, ...rest] = sorted;
    if (!primaryPane) throw createNoPaneError();

    return {
      primaryPane,
      candidates: [primaryPane, ...rest],
    };
  };

  return { describe };
};

export const __internal = {
  paneMatchesHint,
  createPriority,
  comparePriority,
};
