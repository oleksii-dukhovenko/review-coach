import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { PrRoute } from "./api.ts";
import { InboxPage } from "./pages/InboxPage.tsx";
import { PrPage } from "./pages/PrPage.tsx";
import "./styles.css";

function routeFromHash(hash: string): PrRoute | undefined {
  const match = hash.match(/^#\/pr\/([^/]+)\/([^/]+)\/(\d+)/);
  return match ? { owner: match[1], repo: match[2], number: Number(match[3]) } : undefined;
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
  const route = useHashRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route?.owner, route?.repo, route?.number]);
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">Review Coach</a>
      </header>
      <main className="content">{route ? <PrPage key={`${route.owner}/${route.repo}/${route.number}`} route={route} /> : <InboxPage />}</main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
