import { createRequire } from "node:module";
import path from "node:path";
import nlp from "compromise";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import kuromoji from "kuromoji";

export type HintInterpreterInput = {
  paneHint?: string;
  paneHints?: Array<{ value: string; weight?: number }>;
};

export type WeightedHintSource = "exact" | "composite" | "nl";

export type WeightedHint = {
  token: string;
  weight: number;
  source: WeightedHintSource;
};

export type HintInterpreterResult = {
  weightedHints: WeightedHint[];
  rawTokens: string[];
  issues: string[];
};

export type HintInterpreter = {
  interpret(input: HintInterpreterInput): Promise<HintInterpreterResult>;
};

const EXACT_WEIGHT = 1;
const NATURAL_LANGUAGE_WEIGHT = 1;
const DEFAULT_COMPOSITE_WEIGHT = 1;

const ENGLISH_STOP_WORDS = new Set(
  [
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "be",
    "is",
    "are",
    "was",
    "were",
    "me",
    "my",
    "please",
    "show",
    "give",
    "want",
    "need",
    "this",
    "that",
    "from",
    "into",
    "by",
    "about",
    "at",
    "it",
  ].map((word) => word.toLowerCase()),
);

const JAPANESE_STOP_WORDS = new Set([
  "の",
  "が",
  "を",
  "に",
  "は",
  "へ",
  "と",
  "で",
  "です",
  "ます",
  "ください",
  "下さい",
  "欲しい",
  "ほしい",
  "したい",
  "したく",
  "見たい",
  "みたい",
  "たい",
  "しましょう",
  "し",
  "して",
  "て",
  "よう",
  "ません",
  "から",
  "まで",
]);

const require = createRequire(import.meta.url);
const kuromojiDictionaryPath = path.join(
  path.dirname(require.resolve("kuromoji/package.json")),
  "dict",
);

const tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> = new Promise(
  (resolve, reject) => {
    kuromoji
      .builder({ dicPath: kuromojiDictionaryPath })
      .build((error: unknown | null, tokenizer?: Tokenizer<IpadicFeatures>) => {
        if (error || !tokenizer) {
          reject(error ?? new Error("Failed to initialize kuromoji tokenizer"));
          return;
        }
        resolve(tokenizer);
      });
  },
);

const hasJapaneseCharacters = (value: string) =>
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ");

const sanitizeExact = (value: string) =>
  normalizeWhitespace(value.normalize("NFKC")).trim().toLowerCase();

const sanitizeComposite = (value: string) =>
  normalizeWhitespace(value.normalize("NFKC")).trim().toLowerCase();

const sanitizeToken = (value: string) => value.normalize("NFKC").toLowerCase();

const isStopWord = (token: string) =>
  ENGLISH_STOP_WORDS.has(token) || JAPANESE_STOP_WORDS.has(token);

const dedupeInOrder = <T>(values: T[]) => {
  const result: T[] = [];
  for (const value of values) {
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
};

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locale?: string | string[],
    options?: Intl.SegmenterOptions,
  ) => {
    segment(input: string): Iterable<Intl.SegmentData>;
  };
};

const segmentWithIntl = (value: string) => {
  const intlCandidate = Intl as IntlWithSegmenter;
  if (
    typeof Intl === "undefined" ||
    typeof intlCandidate.Segmenter !== "function"
  ) {
    return null;
  }
  const locale = hasJapaneseCharacters(value) ? "ja" : "en";
  try {
    const SegmenterCtor = intlCandidate.Segmenter;
    if (!SegmenterCtor) return null;
    const segmenter = new SegmenterCtor(locale, {
      granularity: "word",
    });
    const tokens: string[] = [];
    for (const segment of segmenter.segment(
      value,
    ) as Iterable<Intl.SegmentData>) {
      if (segment.isWordLike) tokens.push(segment.segment);
    }
    return tokens;
  } catch {
    return null;
  }
};

const fallbackSegment = (value: string) =>
  value
    .split(/[^\p{L}\p{N}%#]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const isMinorKanaToken = (token: string) =>
  /^[\p{Script=Hiragana}]{1}$/u.test(token);

const tokenizeJapanese = async (value: string) => {
  try {
    const tokenizer = await tokenizerPromise;
    return tokenizer
      .tokenize(value)
      .map((token: IpadicFeatures) =>
        token.basic_form === "*" ? token.surface_form : token.basic_form,
      );
  } catch {
    return fallbackSegment(value);
  }
};

const tokenizeNonJapanese = (value: string) => {
  const intlTokens = segmentWithIntl(value) ?? [];
  if (intlTokens.length > 0) return intlTokens;
  return fallbackSegment(value);
};

const extractEnglishTokens = (value: string) => {
  try {
    const doc = nlp(value)
      .normalize({
        whitespace: true,
        case: true,
        punctuation: true,
        contractions: true,
      })
      .compute("root");
    const prioritized = [
      ...doc.match("#Noun").out("array"),
      ...doc.match("#Verb").out("array"),
      ...doc.match("#Adjective").out("array"),
      ...doc.match("#Value").out("array"),
    ];
    const fallback = doc.terms().out("array");
    const flattened = [...prioritized, ...fallback].flatMap((term) =>
      term
        .split(/[^A-Za-z0-9%#]+/)
        .filter((segment: string) => segment.length > 0),
    );
    if (flattened.length > 0) return flattened;
  } catch {
    // fallback below
  }
  return value
    .split(/[^\p{L}\p{N}%#]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
};

const extractNaturalLanguageTokens = async (value: string) => {
  let candidates: string[] = [];
  if (hasJapaneseCharacters(value)) {
    candidates = await tokenizeJapanese(value);
  } else {
    const englishCandidates = extractEnglishTokens(value);
    const otherCandidates = tokenizeNonJapanese(value);
    candidates = [...englishCandidates, ...otherCandidates];
  }
  const normalized = candidates
    .map((token) => sanitizeToken(token))
    .map((token) => token.replace(/^[^\p{L}\p{N}%#]+|[^\p{L}\p{N}%#]+$/gu, ""))
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !isStopWord(token))
    .filter((token) => !isMinorKanaToken(token));
  return dedupeInOrder(normalized);
};

const sumWeights = (hints: Array<{ weight: number }>) =>
  hints.reduce((total, hint) => total + hint.weight, 0);

const normalizeWeights = (hints: WeightedHint[]) => {
  const total = sumWeights(hints);
  if (total <= 0) return [] as WeightedHint[];
  return hints.map((hint) => ({
    ...hint,
    weight: Math.round((hint.weight / total) * 1e6) / 1e6,
  }));
};

export const createHintInterpreter = (): HintInterpreter => {
  const interpret = async (
    input: HintInterpreterInput,
  ): Promise<HintInterpreterResult> => {
    const issues: string[] = [];
    const pending: WeightedHint[] = [];
    const rawTokens: string[] = [];

    const addHint = (
      token: string,
      weight: number,
      source: WeightedHintSource,
    ) => {
      if (!token || weight <= 0) return;
      const existing = pending.find(
        (hint) => hint.token === token && hint.source === source,
      );
      if (existing) {
        existing.weight += weight;
      } else {
        pending.push({ token, weight, source });
      }
      if (!rawTokens.includes(token)) rawTokens.push(token);
    };

    const { paneHint, paneHints } = input;

    if (Array.isArray(paneHints)) {
      paneHints.forEach((entry, index) => {
        const normalizedValue = entry?.value ?? "";
        const sanitizedValue = sanitizeComposite(normalizedValue);
        if (!sanitizedValue) {
          issues.push(`paneHints[${index}] was empty after trimming`);
          return;
        }
        const weight =
          typeof entry.weight === "number" && entry.weight > 0
            ? entry.weight
            : DEFAULT_COMPOSITE_WEIGHT;
        addHint(sanitizedValue, weight, "composite");
      });
    }

    if (paneHint !== undefined) {
      const trimmed = normalizeWhitespace(paneHint.normalize("NFKC")).trim();
      if (!trimmed) {
        issues.push("paneHint was empty after trimming");
      } else {
        const exactToken = sanitizeExact(trimmed);
        addHint(exactToken, EXACT_WEIGHT, "exact");
        const tokens = await extractNaturalLanguageTokens(trimmed);
        if (tokens.length > 0) {
          const perTokenWeight = NATURAL_LANGUAGE_WEIGHT / tokens.length;
          for (const token of tokens) {
            addHint(token, perTokenWeight, "nl");
          }
        } else {
          issues.push("paneHint produced no keywords");
        }
      }
    }

    const normalizedHints = normalizeWeights(pending);

    return {
      weightedHints: normalizedHints,
      rawTokens,
      issues,
    };
  };

  return { interpret };
};
