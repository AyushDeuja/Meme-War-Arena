import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSettlement } from "./settlement.mjs";

test("a transient RPC read failure retries without resubmitting the intent", async () => {
  let reads = 0;
  let signatureQueries = 0;
  const result = await reconcileSettlement({
    intentSignature: "er-intent",
    getBaseSignature: async (signature) => {
      signatureQueries += 1;
      assert.equal(signature, "er-intent");
      return "base-commit";
    },
    readBase: async () => {
      reads += 1;
      if (reads === 1) throw new Error("temporary RPC failure");
      return { status: 3 };
    },
    matches: (state) => state.status === 3,
    intervalMs: 1,
  });
  assert.equal(result.baseSignature, "base-commit");
  assert.equal(reads, 2);
  assert.equal(signatureQueries, 1);
});

test("an unobserved settlement reports the existing signature as pending", async () => {
  await assert.rejects(reconcileSettlement({
    intentSignature: "er-intent",
    getBaseSignature: async () => { throw new Error("RPC unavailable"); },
    readBase: async () => { throw new Error("RPC unavailable"); },
    matches: () => false,
    timeoutMs: 10,
    intervalMs: 1,
  }), /Settlement still pending for er-intent/);
});
