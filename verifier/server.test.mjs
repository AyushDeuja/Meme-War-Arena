import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as anchor from "@coral-xyz/anchor";
import { createVerifierServer } from "./server.mjs";

const { web3 } = anchor.default ?? anchor;

test("verifier API bounds input, origin, and wallet request rate", async () => {
  const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
  const server = createVerifierServer({
    idl, verifier: web3.Keypair.generate(), erUrl: "http://127.0.0.1:7799",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/auth/nonce`;
    const body = JSON.stringify({
      match: web3.Keypair.generate().publicKey.toBase58(),
      wallet: web3.Keypair.generate().publicKey.toBase58(),
    });
    const wrongOrigin = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json", origin: "https://untrusted.example",
    }, body });
    assert.equal(wrongOrigin.status, 400);
    const extraField = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json",
    }, body: body.replace(/}$/, ',"score":100}') });
    assert.equal(extraField.status, 400);
    for (let index = 0; index < 12; index += 1) {
      const response = await fetch(url, { method: "POST", headers: {
        "content-type": "application/json",
      }, body });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json",
    }, body });
    assert.equal(limited.status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
