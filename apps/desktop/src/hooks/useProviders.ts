import { useCallback, useEffect, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import { rememberProviderNames } from "@/lib/providerNames";
import { tracked } from "@/lib/slow";
import type { Provider, ProviderPreset } from "@/types/events";

/// What the agent has configured, read when **Settings** opens.
///
/// **Keyed on the dialog, not on the visit.** The screen that draws this is built
/// when the reader arrives at it, and a read that started there left it blank for
/// as long as the CLI takes to answer — for a reader who opened settings to
/// *look* at their providers, which is the ordinary reason. So the read lives with
/// the surface that outlives the visit, the bargain `useAppSettings` and
/// `useTranscriptionSettings` already make.
///
/// Two commands, and neither is cached: the provider list changes when the reader
/// logs into something, and the presets are the build's own table.
export function useProviders(open: boolean, onChanged?: () => void) {
  const [listed, setListed] = useState<Provider[] | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const providers = await tracked(
        "Reading this machine's providers",
        invoke<Provider[]>("list_providers"),
      );
      // The picker only ever has a provider's *id*, and this is the one reading
      // that pairs it with a name — see `lib/providerNames.ts`.
      rememberProviderNames(providers);
      setListed(providers);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void read();
    // The presets come from the backend for the same reason the provider list
    // does: the URL and the dialect are facts about the agent's own gateway
    // wiring, and it is the side that talks to it.
    void invoke<ProviderPreset[]>("list_provider_presets")
      .then(setPresets)
      .catch(() => {});
  }, [open, read]);

  /// Every mutation answers with the list as it stands after, so the screen
  /// never has to guess what the CLI did — and the model list is stale the
  /// moment a provider changes, which is what `onChanged` tells the composer.
  const apply = useCallback(
    (providers: Provider[]) => {
      setListed(providers);
      onChanged?.();
    },
    [onChanged],
  );

  return { listed, presets, error, apply };
}
