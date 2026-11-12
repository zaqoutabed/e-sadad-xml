import { XMLSerializer } from '@xmldom/xmldom';
import type { MessageSigner } from '../types';
import { canonicalMsgBody } from '../xml/c14n';
import { findFirst, parseXml, text, type XDocument, type XElement } from '../xml/parser';

export interface VerifyResult {
  valid: boolean;
  reason?: 'missing-signature' | 'invalid-signature';
}

/** Verifies the `MsgFooter/Security/Signature` of a full MFEP message. */
export async function verifyMessage(xml: string | Buffer | XDocument, signer: MessageSigner): Promise<VerifyResult> {
  const doc = typeof xml === 'string' || Buffer.isBuffer(xml) ? parseXml(xml) : xml;
  const signature = text(doc, 'MsgFooter', 'Signature') ?? text(doc, 'Signature');
  if (!signature) return { valid: false, reason: 'missing-signature' };
  const ok = await signer.verify(canonicalMsgBody(doc), signature);
  return ok ? { valid: true } : { valid: false, reason: 'invalid-signature' };
}

/**
 * Signs a full MFEP message: computes the signature of `MsgBody` and writes it
 * into `MsgFooter/Security/Signature`, creating those elements when missing.
 * Useful for signing hand-built messages or simulating E-SADAD in tests.
 */
export async function signMessage(xml: string | Buffer, signer: MessageSigner): Promise<string> {
  const doc = parseXml(xml);
  const signature = await signer.sign(canonicalMsgBody(doc));
  const root = doc.documentElement!;
  const child = (parent: XElement, name: string): XElement => {
    const existing = findFirst(parent, name);
    if (existing) return existing;
    const created = doc.createElement(name);
    parent.appendChild(created);
    return created;
  };
  const sigEl = child(child(child(root, 'MsgFooter'), 'Security'), 'Signature');
  while (sigEl.firstChild) sigEl.removeChild(sigEl.firstChild);
  sigEl.appendChild(doc.createTextNode(signature));
  return new XMLSerializer().serializeToString(doc);
}
