import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { socket } from "../socket";
import { askDevAssistantRequest, applyDevAssistantFixRequest } from "../api/devAssistant";
import type { DevAssistantResult, DevAssistantStep } from "../types";

// The request itself is a normal blocking POST (the backend runs the whole
// graph before responding) - the socket listener is purely for the LIVE
// "agents lighting up" visual while that request is in flight, not the
// data-fetching mechanism itself. Steps accumulate per-agent (a "running"
// step then its matching "done" step overwrite the same slot) rather than
// as a growing list, since the UI shows one box per agent, not a log.
export function useDevAssistant() {
  const [steps, setSteps] = useState<Record<string, DevAssistantStep>>({});
  const [result, setResult] = useState<DevAssistantResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const listenerRef = useRef<((step: DevAssistantStep) => void) | null>(null);

  const ask = useCallback(async (question: string) => {
    setError(null);
    setResult(null);
    setSteps({});
    setIsPending(true);

    const handleStep = (step: DevAssistantStep) => {
      setSteps((prev) => ({ ...prev, [step.agent]: step }));
    };
    listenerRef.current = handleStep;
    socket.on("devAssistant:step", handleStep);

    try {
      const data = await askDevAssistantRequest(question);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The Dev Assistant request failed.");
    } finally {
      setIsPending(false);
      if (listenerRef.current) socket.off("devAssistant:step", listenerRef.current);
    }
  }, []);

  return { ask, steps, result, error, isPending };
}

// Separate from the mutation above on purpose - applying a fix is a
// distinct, explicit, human-triggered action (never chained automatically
// after `ask`), so it gets its own pending/error state rather than
// overloading the investigation's.
export function useApplyDevAssistantFix() {
  return useMutation({ mutationFn: applyDevAssistantFixRequest });
}
