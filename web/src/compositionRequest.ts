import type { PendingComposition } from "./model";
const delay = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 600);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
export async function compositionRequest(
  pending: PendingComposition,
  signal: AbortSignal,
) {
  const url = `/api/v1/compositions/${pending.id}`;
  let submitted = false;
  let failures = 0;
  for (;;) {
    signal.throwIfAborted();
    try {
      const r = await fetch(
        submitted ? url : "/api/v1/compositions",
        submitted
          ? { signal }
          : {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Composition-Job": pending.id,
              },
              body: pending.request,
              signal,
            },
      );
      const data = await r.json();
      if (r.status === 202) {
        submitted = true;
        failures = 0;
        await delay(signal);
        continue;
      }
      if (!r.ok)
        throw new Error(data.error?.message || "не удалось собрать композицию");
      return data;
    } catch (error) {
      if (signal.aborted) throw error;
      // Only transport failures retry. Resubmitting uses the same idempotency key.
      if (!(error instanceof TypeError) || ++failures > 20) throw error;
      await delay(signal);
    }
  }
}
