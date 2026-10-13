import type { ReactNode } from "react";

import type { PullRequest } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { timeAgo } from "../inboxView.ts";

function stateChip(pr: PullRequest) {
  return pr.isDraft ? <span className="chip">Draft</span> : <span className="chip ready">Open</span>;
}

/** Where you are, what the PR is, and what you can do with it; the overview adds its section tabs below. */
export function PrHeader({ pr, actions, tabs }: { pr: PullRequest; actions: ReactNode; tabs?: ReactNode }) {
  const opened = pr.createdAt ? `opened ${timeAgo(pr.createdAt)}` : `updated ${timeAgo(pr.updatedAt)}`;
  return (
    <header className="pr-head">
      <div className="pr-crumbs">
        <a href="#/" className="back-link"><Icon name="arrowLeft" size={14} /> Inbox</a>
        <span aria-hidden="true">/</span>
        <span className="mono">{pr.owner} / {pr.repo} #{pr.number}</span>
      </div>
      <div className="pr-head-row">
        <div className="pr-head-title">
          <h1>{pr.title}</h1>
          <div className="pr-head-meta">
            {stateChip(pr)}
            <span>{pr.author} wants to merge into <span className="mono">{pr.baseRef}</span></span>
            <span>{opened}</span>
            <span className="mono"><span className="added-count">+{pr.additions}</span> <span className="deleted-count">−{pr.deletions}</span></span>
          </div>
        </div>
        <div className="pr-actions">{actions}</div>
      </div>
      {tabs}
    </header>
  );
}

export type PrTab = { label: string; count?: number; isCurrent: boolean; onPick: () => void };

export function PrTabs({ tabs }: { tabs: PrTab[] }) {
  return (
    <nav className="pr-tabs" aria-label="Review sections">
      {tabs.map((tab) => (
        <button key={tab.label} className={`pr-tab ${tab.isCurrent ? "is-current" : ""}`} aria-current={tab.isCurrent ? "page" : undefined} onClick={tab.onPick}>
          {tab.label}{tab.count === undefined ? null : <span className="pr-tab-count">{tab.count}</span>}
        </button>
      ))}
    </nav>
  );
}
