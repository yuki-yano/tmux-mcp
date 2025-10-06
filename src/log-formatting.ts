export type LogFilters = {
  timeRange?: {
    from?: string;
    to?: string;
  };
  keywords?: string[];
  levels?: string[];
};

export type ApplyLogFormattingInput = {
  lines: string[];
  filters?: LogFilters;
  maskPatterns?: string[];
  summary?: boolean;
};

export type ApplyLogFormattingResult = {
  lines: string[];
  summary?: {
    totalLines: number;
    errorCount: number;
    firstErrorLine?: string;
  };
};

type ParsedLine = {
  text: string;
  timestamp?: Date;
  level?: string;
};

const parseLine = (line: string): ParsedLine => {
  const match = line.match(
    /^\[(?<timestamp>[^\]]+)\]\s+(?:\[(?<level>[^\]]+)\]\s+)?(?<message>.*)$/,
  );
  if (!match || !match.groups) return { text: line };
  const { timestamp, level, message } = match.groups;
  const parsedTimestamp = timestamp ? new Date(timestamp) : undefined;
  const normalizedLevel = level ? level.toUpperCase() : undefined;
  return {
    text: normalizedLevel
      ? `[${timestamp}] [${normalizedLevel}] ${message}`
      : line,
    timestamp:
      parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
        ? parsedTimestamp
        : undefined,
    level: normalizedLevel,
  };
};

const withinRange = (date: Date | undefined, from?: string, to?: string) => {
  if (!date) return true;
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime()) && date < fromDate) return false;
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime()) && date > toDate) return false;
  }
  return true;
};

const matchesKeywords = (text: string, keywords?: string[]) => {
  if (!keywords || keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
};

const matchesLevel = (level: string | undefined, levels?: string[]) => {
  if (!levels || levels.length === 0) return true;
  if (!level) return false;
  return levels.some(
    (candidate) => candidate.toUpperCase() === level.toUpperCase(),
  );
};

const maskLine = (line: string, patterns?: string[]) => {
  if (!patterns || patterns.length === 0) return line;
  return patterns.reduce((acc, pattern) => {
    if (pattern === "") return acc;
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    return acc.replace(regex, "***");
  }, line);
};

const calculateSummary = (lines: string[]) => {
  if (lines.length === 0) {
    return {
      totalLines: 0,
      errorCount: 0,
    } as const;
  }
  let errorCount = 0;
  let firstErrorLine: string | undefined;
  for (const line of lines) {
    if (line.includes("[ERROR]") || line.includes("[WARN]")) {
      errorCount += 1;
      if (!firstErrorLine) firstErrorLine = line;
    }
  }
  return {
    totalLines: lines.length,
    errorCount,
    firstErrorLine,
  } as const;
};

export const applyLogFormatting = (
  input: ApplyLogFormattingInput,
): ApplyLogFormattingResult => {
  const maskedLines = input.lines
    .map(parseLine)
    .filter((line) => {
      if (
        !withinRange(
          line.timestamp,
          input.filters?.timeRange?.from,
          input.filters?.timeRange?.to,
        )
      ) {
        return false;
      }
      if (!matchesLevel(line.level, input.filters?.levels)) return false;
      if (!matchesKeywords(line.text, input.filters?.keywords)) return false;
      return true;
    })
    .map((line) => maskLine(line.text, input.maskPatterns));

  if (!input.summary) {
    return { lines: maskedLines };
  }

  return {
    lines: maskedLines,
    summary: calculateSummary(maskedLines),
  };
};

export const __internal = {
  parseLine,
  withinRange,
  matchesKeywords,
  matchesLevel,
  maskLine,
  calculateSummary,
};
