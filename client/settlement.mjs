/** Reconcile an already-submitted ER intent by signature and independent base reads. */
export async function reconcileSettlement({
  intentSignature, getBaseSignature, readBase, matches,
  timeoutMs = 45_000, intervalMs = 250,
}) {
  if (!intentSignature) throw new Error("Settlement intent signature is required");
  const deadline = Date.now() + timeoutMs;
  let baseSignature;
  let lastError;
  while (Date.now() < deadline) {
    if (!baseSignature) {
      try {
        baseSignature = await getBaseSignature(intentSignature);
      } catch (error) {
        lastError = error;
      }
    }
    try {
      const state = await readBase();
      if (matches(state)) return { intentSignature, baseSignature, state };
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Settlement still pending for ${intentSignature}: ${lastError?.message ?? "base state not observed"}`);
}
