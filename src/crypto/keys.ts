import { readFileSync } from 'node:fs';
import { X509Certificate, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import forge from 'node-forge';
import type { FileOrData } from '../types';
import { EsadadConfigError } from '../errors';

function readSource(source: FileOrData, label: string): Buffer {
  try {
    if ('path' in source) return readFileSync(source.path);
    return Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data, 'utf8');
  } catch (err) {
    throw new EsadadConfigError(`Cannot read ${label}: ${(err as Error).message}`);
  }
}

/**
 * Loads a public key from an X.509 certificate (PEM or DER `.cer`/`.crt`)
 * or from a PEM/DER public key.
 */
export function loadPublicKey(source: FileOrData): KeyObject {
  const data = readSource(source, 'E-SADAD certificate');
  try {
    return new X509Certificate(data).publicKey;
  } catch {
    // Not a certificate: try a bare public key.
  }
  try {
    const isPem = data.toString('utf8').includes('-----BEGIN');
    return isPem ? createPublicKey(data) : createPublicKey({ key: data, format: 'der', type: 'spki' });
  } catch (err) {
    throw new EsadadConfigError(`Invalid E-SADAD certificate/public key: ${(err as Error).message}`);
  }
}

/** Loads the RSA private key from a PKCS#12 (`.pfx`/`.p12`) file. */
export function loadPfxPrivateKey(source: FileOrData, password: string): KeyObject {
  const data = readSource(source, 'biller PFX');
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(data.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (err) {
    throw new EsadadConfigError(`Cannot open biller PFX (wrong password or unsupported format): ${(err as Error).message}`);
  }
  const bagTypes = [forge.pki.oids.pkcs8ShroudedKeyBag!, forge.pki.oids.keyBag!];
  for (const bagType of bagTypes) {
    const bags = p12.getBags({ bagType })[bagType] ?? [];
    for (const bag of bags) {
      if (bag.key) {
        const pem = forge.pki.privateKeyToPem(bag.key as forge.pki.rsa.PrivateKey);
        return createPrivateKey(pem);
      }
    }
  }
  throw new EsadadConfigError('Biller PFX does not contain an RSA private key');
}

/** Loads a PEM (PKCS#1 or PKCS#8) or DER (PKCS#8) private key. */
export function loadPemPrivateKey(source: FileOrData, passphrase?: string): KeyObject {
  const data = readSource(source, 'biller private key');
  try {
    const isPem = data.toString('utf8').includes('-----BEGIN');
    return isPem
      ? createPrivateKey({ key: data, passphrase })
      : createPrivateKey({ key: data, format: 'der', type: 'pkcs8', passphrase });
  } catch (err) {
    throw new EsadadConfigError(`Invalid biller private key: ${(err as Error).message}`);
  }
}
