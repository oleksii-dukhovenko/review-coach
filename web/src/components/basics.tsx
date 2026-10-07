import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Walkthrough } from "../api.ts";

type Proof = Walkthrough["tour"][number]["questions"][number]["proof"];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function ProofBadge({ proof }: { proof: Proof }) {
  const location = `${proof.file}:${proof.line}`;
  const label = proof.status === "proven" ? `Proven at ${location}` : "Guess, not verified";
  return (
    <span className={`chip ${proof.status}`} title={proof.note || location}>
      {label}
    </span>
  );
}

function patchLineClass(line: string): string {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "";
}

export function PatchBlock({ patch }: { patch: string }) {
  return (
    <pre className="code-block">
      {patch.split("\n").map((line, lineIndex) => (
        <div key={lineIndex} className={`patch-line ${patchLineClass(line)}`}>{line || " "}</div>
      ))}
    </pre>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  return <button onClick={() => void navigator.clipboard.writeText(text)}>{label}</button>;
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  return message ? <div className="banner error">{message}</div> : null;
}
