import { sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { CertificatesConfig, MessageSigner } from '../types';
import { EsadadConfigError } from '../errors';
import { loadPemPrivateKey, loadPfxPrivateKey, loadPublicKey } from './keys';

/**
 * E-SADAD signature scheme: RSA PKCS#1 v1.5 + SHA-256 over the canonical
 * `MsgBody` string encoded as UTF-16LE, base64-encoded.
 */
export function signData(data: string, privateKey: KeyObject): string {
  return cryptoSign('sha256', Buffer.from(data, 'utf16le'), privateKey).toString('base64');
}

export function verifyData(data: string, signatureBase64: string, publicKey: KeyObject): boolean {
  const signature = signatureBase64.replace(/\s+/g, '');
  if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  try {
    return cryptoVerify('sha256', Buffer.from(data, 'utf16le'), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** `MessageSigner` backed by the biller private key and the E-SADAD public certificate. */
export class CertificateSigner implements MessageSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(certificates: CertificatesConfig) {
    if (!certificates?.esadadCertificate) throw new EsadadConfigError('certificates.esadadCertificate is required');
    this.publicKey = loadPublicKey(certificates.esadadCertificate);
    if (certificates.billerPfx) {
      this.privateKey = loadPfxPrivateKey(certificates.billerPfx, certificates.billerPfx.password);
    } else if (certificates.billerPrivateKey) {
      this.privateKey = loadPemPrivateKey(certificates.billerPrivateKey, certificates.billerPrivateKey.passphrase);
    } else {
      throw new EsadadConfigError('Provide certificates.billerPfx or certificates.billerPrivateKey');
    }
  }

  sign(canonicalMsgBody: string): string {
    return signData(canonicalMsgBody, this.privateKey);
  }

  verify(canonicalMsgBody: string, signatureBase64: string): boolean {
    return verifyData(canonicalMsgBody, signatureBase64, this.publicKey);
  }
}
