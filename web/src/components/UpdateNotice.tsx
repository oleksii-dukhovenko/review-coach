import { useEffect, useRef, useState } from "react";

import { api, type VersionInfo } from "../api.ts";
import { Icon } from "./Icon.tsx";
import { Working } from "./Working.tsx";

const CHECK_EVERY_MS = 10 * 60_000;
const WHILE_UPDATING_MS = 2_000;
const INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/oleksii-dukhovenko/review-coach/master/install.sh | bash";

const PHASE_TEXT: Partial<Record<VersionInfo["phase"], string>> = {
  downloading: "Downloading the update",
  installing: "Installing packages",
  building: "Building",
  restarting: "Restarting",
};

function isUpdating(info: VersionInfo | null): boolean {
  return info !== null && PHASE_TEXT[info.phase] !== undefined;
}

/** Polls the app's version; once an update restarts the server on a new commit, reloads the page. */
export function useVersion() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [isWaitingForRestart, setIsWaitingForRestart] = useState(false);
  const startedOn = useRef<string | null>(null);
  const load = (shouldCheck = false) =>
    api.version(shouldCheck).then((next) => {
      const isNewBuild = startedOn.current !== null && next.current?.sha !== startedOn.current;
      if (isNewBuild) window.location.reload();
      setInfo(next);
    }, () => {
      // - The server is down while it restarts; keep asking.
      if (startedOn.current) setIsWaitingForRestart(true);
    });
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), isUpdating(info) || isWaitingForRestart ? WHILE_UPDATING_MS : CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [isUpdating(info), isWaitingForRestart]);
  const update = () => {
    startedOn.current = info?.current?.sha ?? null;
    void api.update().then(setInfo);
  };
  return { info, isWaitingForRestart, update, check: () => load(true) };
}

function CommitList({ info }: { info: VersionInfo }) {
  const more = (info.behindBy ?? 0) - info.newCommits.length;
  return (
    <ul className="update-commits">
      {info.newCommits.map((commit) => <li key={commit.sha}>{commit.title}</li>)}
      {more > 0 ? <li className="muted">and {more} more</li> : null}
    </ul>
  );
}

function InstallHint({ text }: { text: string }) {
  return (
    <>
      <p className="small">{text}</p>
      <code className="install-command">{INSTALL_COMMAND}</code>
      <button className="btn btn-secondary btn-small" onClick={() => void navigator.clipboard.writeText(INSTALL_COMMAND)}>Copy command</button>
    </>
  );
}

function UpdateBody({ info, onUpdate }: { info: VersionInfo; onUpdate: () => void }) {
  const count = info.behindBy ?? 0;
  return (
    <div className="menu update-panel">
      <div className="update-title">{count === 1 ? "1 new change" : `${count} new changes`} on {info.current?.branch}</div>
      <CommitList info={info} />
      {info.phase === "failed" ? <p className="small update-error">The update failed: {info.updateError}</p> : null}
      {info.phase === "needs-install" ? <InstallHint text="This update changes the tools inside the app's container, so the button cannot install it. Run the install command once:" /> : null}
      {info.phase !== "needs-install" && info.canUpdate ? (
        <>
          <button className="btn btn-primary btn-small" onClick={onUpdate}>{info.phase === "failed" ? "Try again" : "Update now"}</button>
          <p className="small muted">Takes about a minute. Your reviews and settings stay; the page reloads by itself.</p>
        </>
      ) : null}
      {info.phase !== "needs-install" && !info.canUpdate ? <InstallHint text="This copy is not running in Docker, so it cannot restart itself. Pull and restart it, or run the install command:" /> : null}
    </div>
  );
}

export type VersionState = ReturnType<typeof useVersion>;

/** The top bar's update button: shows when GitHub has newer commits, and runs the update. */
export function UpdateNotice({ version }: { version: VersionState }) {
  const { info, isWaitingForRestart, update } = version;
  if (isWaitingForRestart || isUpdating(info)) {
    return <span className="update-pill is-working"><Working size={13}>{isWaitingForRestart ? "Restarting" : PHASE_TEXT[info!.phase]}…</Working></span>;
  }
  if (!info || !info.behindBy) return null;
  const label = info.phase === "failed" ? "Update failed" : "Update available";
  return (
    <details className="row-menu update-menu">
      <summary className={`update-pill ${info.phase === "failed" ? "is-failed" : ""}`}><Icon name="arrowUp" size={14} /> {label}</summary>
      <UpdateBody info={info} onUpdate={update} />
    </details>
  );
}

/** One quiet line: which commit this is, and whether it is current. */
export function VersionLine({ version }: { version: VersionState }) {
  const { info, check } = version;
  const [isChecking, setIsChecking] = useState(false);
  if (!info?.current) return null;
  const status = info.behindBy ? `${info.behindBy} behind` : info.behindBy === 0 ? "up to date" : "not checked";
  const recheck = () => {
    setIsChecking(true);
    void check().finally(() => setIsChecking(false));
  };
  return (
    <div className="version-line small muted" title={info.checkError ?? `Checked ${info.checkedAt ? new Date(info.checkedAt).toLocaleString() : "never"}`}>
      Version <span className="mono">{info.current.sha.slice(0, 7)}</span> · {status} ·{" "}
      <button className="link-button" disabled={isChecking} onClick={recheck}>{isChecking ? "Checking..." : "Check"}</button>
    </div>
  );
}
