import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/store";
import {
  LANGUAGES,
  LANGUAGE_CODES,
  loadPracticeLanguage,
  savePracticeLanguage,
} from "../../i18n/languages";
import {
  ApiError,
  sessions,
  texts,
  type Language,
  type SessionResult,
} from "../../lib/api";
import { dailyQuery, selectDailyText } from "../../lib/queries";
import { isLanguage } from "../../i18n/languages";
import { initialState, liveStats, reduce } from "../typing-engine/engine";
import { TypingBox } from "../typing-engine/TypingBox";
import { ResultsCard } from "./ResultsCard";

type Difficulty = 1 | 2 | 3;

export default function PracticePage() {
  const user = useAuth((s) => s.user);
  const [params] = useSearchParams();
  // /practice?daily=1&lang=he — today's fixed text, scored on the daily board (ADR-019).
  const isDaily = params.get("daily") === "1";
  const dailyLang = params.get("lang");
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [language, setLanguage] = useState<Language>(() =>
    isDaily && isLanguage(dailyLang) ? dailyLang : loadPracticeLanguage(),
  );
  const [attempt, setAttempt] = useState(0); // bump to fetch a new text

  // Two queries, one of them switched off: the daily challenge and a random text are
  // different resources with different cache keys, and the daily one is defined once
  // in lib/queries.ts because the home page reads the same key (ADR-021).
  const dailyText = useQuery({
    ...dailyQuery(language),
    select: selectDailyText,
    enabled: isDaily,
  });
  const randomText = useQuery({
    queryKey: ["texts", "random", language, difficulty, attempt],
    queryFn: () => texts.random(language, difficulty),
    enabled: !isDaily,
    staleTime: Infinity,
    retry: false,
  });
  const text = isDaily ? dailyText : randomText;

  const [engine, dispatch] = useReducer(reduce, initialState(""));
  useEffect(() => {
    if (text.data) dispatch({ type: "reset", target: text.data.content });
  }, [text.data]);

  const submit = useMutation({
    mutationFn: async (): Promise<SessionResult> => {
      if (!text.data || engine.startedAt === null)
        throw new Error("nothing to submit");
      // startedAt is a monotonic clock; convert to wall-clock for the server.
      const startedAt = new Date(
        Date.now() - (performance.now() - engine.startedAt),
      );
      return sessions.submit(
        text.data.id,
        startedAt.toISOString(),
        engine.keystrokes,
        isDaily ? "daily" : "practice",
      );
    },
  });

  useEffect(() => {
    if (engine.finished && submit.isIdle) submit.mutate();
  }, [engine.finished, submit]);

  // Tick once a second for the live timer while typing.
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (engine.startedAt === null || engine.finished) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [engine.startedAt, engine.finished]);
  const stats = liveStats(engine, now);

  function next() {
    submit.reset();
    // Free practice fetches a different text, and the effect above resets the engine.
    // The daily text is fixed for the day, so there is no new fetch: reset it here.
    if (isDaily) dispatch({ type: "reset", target: text.data?.content ?? "" });
    else setAttempt((n) => n + 1);
  }

  function pickLanguage(next: Language) {
    savePracticeLanguage(next);
    setLanguage(next);
    setAttempt((n) => n + 1);
    submit.reset();
  }

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isDaily ? "Daily challenge" : "Practice"}
        </h1>
        <nav className="flex items-center gap-4 text-sm">
          <span>{user?.display_name}</span>
          <Link className="underline" to="/">
            Home
          </Link>
        </nav>
      </header>

      {isDaily && (
        <p className="text-sm text-gray-500">
          One text per day, the same for everyone.{" "}
          <Link className="underline" to="/practice">
            Free practice
          </Link>
        </p>
      )}

      {!isDaily && (
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Language"
        >
          <span className="text-sm">Language</span>
          {LANGUAGE_CODES.map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              onClick={() => pickLanguage(code)}
              className={`rounded border px-3 py-1 ${code === language ? "bg-blue-600 text-white" : ""}`}
              aria-pressed={code === language}
            >
              {LANGUAGES[code].label}
            </button>
          ))}
        </div>
      )}

      {!isDaily && (
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Difficulty"
        >
          <span className="text-sm">Difficulty</span>
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDifficulty(d);
                next();
              }}
              className={`rounded border px-3 py-1 ${d === difficulty ? "bg-blue-600 text-white" : ""}`}
              aria-pressed={d === difficulty}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {text.isPending && <p>Loading text…</p>}
      {text.isError && (
        <p role="alert" className="text-red-600">
          {text.error instanceof ApiError
            ? text.error.message
            : "Could not load a text"}
        </p>
      )}

      {text.data && (
        <>
          <TypingBox
            state={engine}
            language={text.data.language}
            onInput={(value, at) => dispatch({ type: "input", value, at })}
          />
          <dl className="flex gap-8 font-mono text-sm" aria-label="live stats">
            <div>
              <dt className="text-gray-500">time</dt>
              <dd data-testid="live-time">
                {(stats.elapsedMs / 1000).toFixed(1)}s
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">wpm</dt>
              <dd data-testid="live-wpm">{stats.wpm}</dd>
            </div>
            <div>
              <dt className="text-gray-500">accuracy</dt>
              <dd data-testid="live-accuracy">{stats.accuracy}%</dd>
            </div>
            <div>
              <dt className="text-gray-500">errors</dt>
              <dd data-testid="live-errors">{stats.errors}</dd>
            </div>
          </dl>
          <p className="text-xs text-gray-500">
            {text.data.source} · {text.data.license}
          </p>
        </>
      )}

      {submit.isPending && <p>Scoring…</p>}
      {submit.isError && (
        <div role="alert" className="flex items-center gap-4 text-red-600">
          <span>
            {submit.error instanceof ApiError
              ? submit.error.message
              : "Could not reach the server to save the session"}
          </span>
          <button
            type="button"
            onClick={() => submit.mutate()}
            className="rounded border border-current px-3 py-1 text-sm"
          >
            Retry
          </button>
        </div>
      )}
      {submit.data && !isDaily && (
        <ResultsCard result={submit.data} onNext={next} />
      )}
      {submit.data && isDaily && (
        <>
          <ResultsCard result={submit.data} onNext={next} />
          <p className="text-sm">
            <Link
              className="underline"
              to={`/leaderboard?daily=1&lang=${language}`}
            >
              See today&apos;s leaderboard
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
