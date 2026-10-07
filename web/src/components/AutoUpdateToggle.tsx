import { useState } from "react";

import { api, type PrRoute } from "../api.ts";

const HINT = "New commits or comments update this PR's review on each GitHub check, redoing only what changed. Uses Claude.";

/** Per-PR switch for updating without a click. */
// - isCompact hides the words and keeps the tooltip, for busy rows.
export function AutoUpdateToggle({ route, isOn, isCompact = false }: { route: PrRoute; isOn: boolean; isCompact?: boolean }) {
  const [isChecked, setIsChecked] = useState(isOn);
  const change = (wantsOn: boolean) => {
    setIsChecked(wantsOn);
    api.setAutoUpdate(route, wantsOn).then((saved) => setIsChecked(saved.isOn), () => setIsChecked(!wantsOn));
  };
  return (
    <label className="switch" title={`Auto-update: ${HINT}`}>
      <input type="checkbox" role="switch" aria-label="Auto-update" checked={isChecked} onChange={(event) => change(event.target.checked)} />
      {isCompact ? null : "Auto-update"}
    </label>
  );
}
