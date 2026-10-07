import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { PrRoute } from "./api.ts";
import type { EssayView } from "./essay/session.ts";
import { InboxPage } from "./pages/InboxPage.tsx";
import { PrPage } from "./pages/PrPage.tsx";
import { useScrollHistory } from "./scrollHistory.ts";
import "./broadsheet.css";
import "./styles.css";

// - A tab left open across a rebuild asks for old chunks; reload once.
window.addEventListener("vite:preloadError", () => window.location.reload());

function routeFromHash(hash: string): PrRoute | undefined {
  const match = hash.match(/^#\/pr\/([^/]+)\/([^/]+)\/(\d+)/);
  return match ? { owner: match[1], repo: match[2], number: Number(match[3]) } : undefined;
}

/** The part after the PR: the lede, a step (1-based in the address), Finish, or all files. */
export function viewFromHash(hash: string): EssayView {
  const rest = hash.replace(/^#\/pr\/[^/]+\/[^/]+\/\d+/, "");
  const step = rest.match(/^\/step\/(\d+)/);
  if (step) return { kind: "step", index: Number(step[1]) - 1 };
  if (rest.startsWith("/finish")) return { kind: "finish" };
  if (rest.startsWith("/files") || rest.startsWith("/skim")) return { kind: "files" };
  return { kind: "lede" };
}

export function hashFor(route: PrRoute, view: EssayView): string {
  const base = `#/pr/${route.owner}/${route.repo}/${route.number}`;
  if (view.kind === "step") return `${base}/step/${view.index + 1}`;
  if (view.kind === "finish" || view.kind === "files") return `${base}/${view.kind}`;
  return base;
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);
  return hash;
}

function useHashRoute(): PrRoute | undefined {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);
  return routeFromHash(hash);
}

/** Shows a pointer over code while Ctrl or Cmd is held. */
function useModifierClass() {
  useEffect(() => {
    const updateClass = (event: KeyboardEvent | MouseEvent) =>
      document.body.classList.toggle("peek-key-held", event.ctrlKey || event.metaKey);
    const clearClass = () => document.body.classList.remove("peek-key-held");
    window.addEventListener("keydown", updateClass);
    window.addEventListener("keyup", updateClass);
    window.addEventListener("blur", clearClass);
    return () => {
      window.removeEventListener("keydown", updateClass);
      window.removeEventListener("keyup", updateClass);
      window.removeEventListener("blur", clearClass);
    };
  }, []);
}

function App() {
  useModifierClass();
  useScrollHistory();
  const route = useHashRoute();
  const hash = useHash();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route?.owner, route?.repo, route?.number]);
  return (
    <div className="app">
      {route ? null : (
        <header className="topbar">
          <div className="topbar-inner">
            <a href="#/" className="brand">Review Coach</a>
            <a href="#/" className="topbar-link">Inbox</a>
          </div>
        </header>
      )}
      <main className={route ? "content is-pr" : "content"}>
        {route ? <PrPage key={`${route.owner}/${route.repo}/${route.number}`} route={route} view={viewFromHash(hash)}
          goTo={(view) => { window.location.hash = hashFor(route, view); }} /> : <InboxPage />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
