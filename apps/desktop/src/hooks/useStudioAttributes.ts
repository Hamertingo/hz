import { useLayoutEffect } from "react";

import { applyStudioAttributes, useStudio } from "@/lib/studio";

/// Keeps `<html data-density data-faces>` in step with the Preferences page, so
/// the stylesheet can answer to them. Mounted once, in `App`.
export function useStudioAttributes() {
  const [studio] = useStudio();
  useLayoutEffect(() => {
    applyStudioAttributes(studio);
  }, [studio]);
}
