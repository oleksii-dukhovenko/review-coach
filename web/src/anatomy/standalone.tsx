import { useState } from "react";
import { createRoot } from "react-dom/client";

import type { Scene, ScenePart } from "../../../server/sceneSchema.ts";
import { StoryPicture } from "./StoryPicture.tsx";
import "../tokens.css";

type ThemeChoice = "light" | "dark" | "system";

type PageData = { scene: Scene; theme: ThemeChoice };

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function pageData(): PageData {
  return JSON.parse(document.getElementById("anatomy-data")!.textContent!) as PageData;
}

function applyTheme(choice: ThemeChoice) {
  const followsDarkSystem = choice === "system" && darkQuery.matches;
  const isDark = choice === "dark" || followsDarkSystem;
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}

function isStepNumber(asked: number): boolean {
  const isInRange = asked >= 1 && asked <= 3;
  return Number.isInteger(asked) && isInRange;
}

/** `?step=2` shows step 2 and holds it still. */
function pinnedStep(): number | undefined {
  const asked = Number(new URLSearchParams(window.location.search).get("step"));
  return isStepNumber(asked) ? asked - 1 : undefined;
}

function whereOf(part: ScenePart): string {
  return `${part.label}: ${part.file}:${part.startLine}-${part.endLine}`;
}

function StandalonePage({ scene }: { scene: Scene }) {
  const [where, setWhere] = useState<string | null>(null);
  return (
    <main className="anatomy-page">
      <StoryPicture scene={scene} withTldr pinnedStep={pinnedStep()} onOpenPart={(part) => setWhere(whereOf(part))} />
      {where ? <p className="story-where">{where}</p> : null}
    </main>
  );
}

const data = pageData();
applyTheme(data.theme);
darkQuery.addEventListener("change", () => applyTheme(data.theme));
createRoot(document.getElementById("root")!).render(<StandalonePage scene={data.scene} />);
