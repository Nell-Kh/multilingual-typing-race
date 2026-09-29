import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  LANGUAGES,
  LANGUAGE_CODES,
  loadPracticeLanguage,
  savePracticeLanguage,
} from "../../i18n/languages";
import {
  ApiError,
  leaderboards,
  sessions,
  texts,
  type Language,
  type ScoredRun,
} from "../../lib/api";
import { dailyQuery, selectDailyText } from "../../lib/queries";
import { isLanguage } from "../../i18n/languages";
import { initialState, liveStats, reduce } from "../typing-engine/engine";
import { TypingBox } from "../typing-engine/TypingBox";
import { ResultsCard } from "./ResultsCard";
import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { StatStrip } from "../../ui/StatStrip";
import { useTitle } from "../../ui/useTitle";

type Difficulty = 1 | 2 | 3;

export default function PracticePage({ guest = false }: { guest?: boolean }) {
  const [params] = useSearchParams();
  // /practice?daily=1&lang=he — today's fixed text, scored on the daily board (ADR-019).
  // A guest never gets the daily: its board is for accounts (ADR-034).
  const isDaily = !guest && params.get("daily") === "1";
  useTitle(isDaily ? "Daily challenge" : guest ? "Try it" : "Practice");
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
    mutationFn: async (): Promise<ScoredRun> => {
      if (!text.data || engine.startedAt === null)
        throw new Error("nothing to submit");
      // startedAt is a monotonic clock; convert to wall-clock for the server.
      const startedAt = new Date(
        Date.now() - (performance.now() - engine.startedAt),
      );
      // A guest run is scored by the same server code and stored nowhere (ADR-034).
      if (guest)
        return sessions.guest(text.data.id, startedAt.toISOString(), engine.keystrokes);
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

  // Daily: once a run is scored, where the player stands on today's board.
  const dailyBoard = useQuery({
    queryKey: ["daily", "board", language, submit.submittedAt],
    queryFn: () => leaderboards.daily(language),
    enabled: isDaily && submit.isSuccess,
    retry: false,
  });

  /** Start the same text over: Esc, the Restart button, or Try again. */
  function restart() {
    submit.reset();
    dispatch({ type: "reset", target: text.data?.content ?? "" });
  }

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

  const seconds = stats.elapsedMs / 1000;

  return (
    <main className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">
          {isDaily ? "Daily challenge" : "Practice"}
        </h1>
        {guest && (
          <p
            data-testid="guest-banner"
            className="m-0 rounded-control border border-line bg-accent-soft px-3 py-2 text-sm text-ink"
          >
            Guest run — not saved.{" "}
            <Link className="font-medium text-accent underline" to="/register">
              Create an account
            </Link>{" "}
            to keep your stats.
          </p>
        )}
        {isDaily && (
          <p className="m-0 text-sm text-muted">
            One text per day, the same for everyone.{" "}
            <Link className="font-medium text-accent underline" to="/practice">
              Free practice
            </Link>
          </p>
        )}
      </header>

      {!isDaily && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            label="Language"
            value={language}
            onChange={pickLanguage}
            options={LANGUAGE_CODES.map((code) => ({
              value: code,
              label: LANGUAGES[code].label,
              lang: code,
            }))}
          />
          <Segmented
            label="Difficulty"
            value={difficulty}
            onChange={(d) => {
              setDifficulty(d);
              next();
            }}
            options={([1, 2, 3] as const).map((d) => ({ value: d, label: d }))}
          />
        </div>
      )}

      {text.isPending && <p className="m-0 text-muted">Loading text…</p>}
      {text.isError && (
        <p role="alert" className="m-0 text-err">
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
            onRestart={restart}
          />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <StatStrip
              label="live stats"
              stats={[
                { label: "Speed", value: stats.wpm, testId: "live-wpm" },
                { label: "Accuracy", value: `${stats.accuracy}%`, testId: "live-accuracy" },
                { label: "Errors", value: stats.errors, testId: "live-errors" },
                { label: "Time", value: `${seconds.toFixed(1)}s`, testId: "live-time" },
              ]}
            />
            <Button onClick={restart} title="Start this text over (Esc)">
              Restart
            </Button>
          </div>
          <p className="m-0 text-xs text-muted">
            {text.data.source} · {text.data.license}
          </p>
        </>
      )}

      {submit.isPending && <p className="m-0 text-muted">Scoring…</p>}
      {submit.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-err">
          <span>
            {submit.error instanceof ApiError
              ? submit.error.message
              : guest
                ? "Could not reach the server to score the run"
                : "Could not reach the server to save the session"}
          </span>
          <Button onClick={() => submit.mutate()}>Retry</Button>
        </div>
      )}
      {submit.data && (
        <ResultsCard
          result={submit.data}
          guest={guest}
          onNext={isDaily ? undefined : next}
          onRetry={restart}
          daily={
            isDaily
              ? {
                  href: `/leaderboard?daily=1&lang=${language}`,
                  me: dailyBoard.isSuccess ? dailyBoard.data.me : undefined,
                }
              : undefined
          }
        />
      )}
    </main>
  );
}
