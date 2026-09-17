import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth } from "../features/auth/store";
import { LANGUAGES, loadPracticeLanguage } from "../i18n/languages";
import { daily } from "../lib/api";

export default function HomePage() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const language = loadPracticeLanguage();
  const today = useQuery({
    queryKey: ["daily", language],
    queryFn: () => daily.get(language),
  });

  return (
    <main className="flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Multilingual Typing Race</h1>
      <p>
        Signed in as{" "}
        <strong data-testid="display-name">{user?.display_name}</strong>
      </p>
      <div className="flex gap-4">
        <Link
          to="/practice"
          className="rounded bg-blue-600 px-6 py-3 text-lg text-white"
        >
          Practice
        </Link>
        <Link to="/race" className="rounded border px-6 py-3 text-lg">
          Race
        </Link>
      </div>
      {today.data && (
        <section
          className="w-full max-w-xl rounded-lg border p-4"
          aria-label="daily challenge"
          data-testid="daily-card"
        >
          <h2 className="mb-1 font-semibold">
            Daily challenge ·{" "}
            <span lang={language}>{LANGUAGES[language].label}</span>
          </h2>
          <p
            className="mb-3 truncate text-sm text-gray-500"
            lang={language}
            dir={LANGUAGES[language].dir}
          >
            {today.data.text.content}
          </p>
          <Link
            to={`/practice?daily=1&lang=${language}`}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
          >
            Type today&apos;s text
          </Link>
        </section>
      )}
      <nav className="flex gap-4 text-sm">
        <Link className="underline" to="/stats">
          Your stats
        </Link>
        <Link className="underline" to="/leaderboard">
          Leaderboard
        </Link>
      </nav>
      <button
        className="rounded border px-4 py-2"
        onClick={() => void logout()}
      >
        Log out
      </button>
    </main>
  );
}
