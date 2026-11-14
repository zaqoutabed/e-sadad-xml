/**
 * Custom signer: keep the biller private key somewhere other than a file, for
 * example an HSM, a cloud KMS or a secret manager.
 *
 * A signer has two jobs:
 *   sign(text)              → base64 signature of `text` (encoded as UTF-16LE, RSA-SHA256)
 *   verify(text, signature) → true when E-SADAD's signature is valid
 * The library gives you `text` already canonicalised; you only do the crypto.
 */
import { createPrivateKey, sign as rsaSign } from 'node:crypto';
import { EsadadService, InMemoryStore, loadPublicKey, verifyData, type MessageSigner } from 'e-sadad-xml';

// Example 1: key loaded from an environment variable / secret manager -------------
const privateKey = createPrivateKey(process.env.BILLER_PRIVATE_KEY_PEM ?? '');
const esadadPublicKey = loadPublicKey({ data: process.env.ESADAD_CERT_PEM ?? '' });

export const envSigner: MessageSigner = {
  sign: (text) => rsaSign('sha256', Buffer.from(text, 'utf16le'), privateKey).toString('base64'),
  verify: (text, signature) => verifyData(text, signature, esadadPublicKey),
};

// Example 2: remote signing service (HSM / KMS). Both methods may be async. -------
declare function kmsSign(keyId: string, digestAlgorithm: 'SHA256', data: Buffer): Promise<Buffer>; // your KMS client

export const kmsSigner: MessageSigner = {
  async sign(text) {
    const signature = await kmsSign('biller-signing-key', 'SHA256', Buffer.from(text, 'utf16le')); // RSASSA-PKCS1-v1_5
    return signature.toString('base64');
  },
  verify: (text, signature) => verifyData(text, signature, esadadPublicKey),
};

// Use it: pass `signer` instead of `certificates`.
export const esadad = new EsadadService({
  biller: { code: 344 },
  services: [
    { serviceType: 'TELC_Recharge', paymentType: 'PrePaid', currency: 'ILS', bankCode: 8, iban: 'PS49PALS045431072990993100000' },
  ],
  signer: envSigner,
  adapter: { validatePrepaid: async () => ({ valid: true }), postPayment: async () => undefined },
  store: new InMemoryStore(),
});
