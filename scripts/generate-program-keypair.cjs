const fs = require('node:fs');
const crypto = require('node:crypto');

const jwk = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
const publicKey = Buffer.from(jwk.x, 'base64url');
const secretKey = Buffer.concat([Buffer.from(jwk.d, 'base64url'), publicKey]);
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let number = BigInt(`0x${publicKey.toString('hex')}`);
let address = '';
while (number > 0n) {
  address = alphabet[Number(number % 58n)] + address;
  number /= 58n;
}
for (const byte of publicKey) {
  if (byte !== 0) break;
  address = `1${address}`;
}
fs.mkdirSync('target/deploy', { recursive: true });
fs.writeFileSync('target/deploy/meme_wars-keypair.json', JSON.stringify([...secretKey]));
console.log(address);
