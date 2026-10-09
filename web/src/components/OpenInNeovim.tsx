import { useState } from "react";

import { api, type PrRoute } from "../api.ts";
import { Icon } from "./Icon.tsx";

// - file: one file's diff; unset opens the whole PR.
type OpenProps = { route: PrRoute; file?: string; className?: string; label?: string };

// - In Docker the app answers with a review-coach:// link for this computer to open.
function followLink(result: { link?: string }) {
  if (result.link) window.location.href = result.link;
}

/** Opens the diff in Neovim (diffview) in a new terminal window. */
export function OpenInNeovim({ route, file, className = "btn btn-ghost btn-small btn-quiet", label = "Neovim" }: OpenProps) {
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setError(null);
    api.openInEditor(route, file).then(followLink, (openError: Error) => setError(openError.message));
  };
  return (
    <>
      <button className={className} onClick={open} title={file ? `Open ${file} in Neovim` : "Open the whole PR in Neovim"}>
        <Icon name="code" size={15} /> {label}
      </button>
      {error ? <span className="composer-error">{error}</span> : null}
    </>
  );
}
