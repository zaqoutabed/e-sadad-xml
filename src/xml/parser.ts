import { DOMParser } from '@xmldom/xmldom';
import type { Document as XDocument, Element as XElement, Node as XNode } from '@xmldom/xmldom';
import { EsadadError } from '../errors';

export type { XDocument, XElement, XNode };

const ELEMENT_NODE = 1;

/**
 * Parses an XML string into a DOM document.
 *
 * DOCTYPE declarations are rejected (no entity expansion, no XXE), and parser
 * errors are raised as `EsadadError('INVALID_REQUEST')`.
 */
export function parseXml(xml: string | Buffer): XDocument {
  const source = (Buffer.isBuffer(xml) ? xml.toString('utf8') : xml).replace(/^﻿/, '').trim();
  if (!source) throw new EsadadError('INVALID_REQUEST', 'Empty XML body');
  if (/<!DOCTYPE/i.test(source)) throw new EsadadError('INVALID_REQUEST', 'DOCTYPE is not allowed');

  let doc: XDocument;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(source, 'text/xml');
  } catch (err) {
    throw new EsadadError('INVALID_REQUEST', `Malformed XML: ${(err as Error).message}`);
  }
  if (!doc.documentElement) throw new EsadadError('INVALID_REQUEST', 'Malformed XML: missing root element');
  return doc;
}

function localNameOf(node: XNode): string {
  const n = node as XElement;
  return n.localName ?? n.nodeName;
}

/** First descendant element (depth-first, document order) with this local name, ignoring namespaces. */
export function findFirst(root: XNode | null | undefined, name: string): XElement | undefined {
  if (!root) return undefined;
  const stack: XNode[] = [];
  for (let c = root.lastChild; c; c = c.previousSibling) stack.push(c);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === ELEMENT_NODE) {
      if (localNameOf(node) === name) return node as XElement;
      for (let c = node.lastChild; c; c = c.previousSibling) stack.push(c);
    }
  }
  return undefined;
}

/** Every descendant element with this local name, in document order. */
export function findAll(root: XNode | null | undefined, name: string): XElement[] {
  const out: XElement[] = [];
  const walk = (node: XNode) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === ELEMENT_NODE) {
        if (localNameOf(c) === name) out.push(c as XElement);
        walk(c);
      }
    }
  };
  if (root) walk(root);
  return out;
}

/**
 * Follows a path of element names, for example `text(doc, 'MsgHeader', 'GUID')`.
 * Each step matches any descendant, so intermediate wrappers may be skipped.
 * Returns the trimmed text, or `undefined` when the element is missing or empty.
 */
export function text(root: XNode | null | undefined, ...path: string[]): string | undefined {
  let node: XNode | undefined = root ?? undefined;
  for (const step of path) {
    node = findFirst(node, step);
    if (!node) return undefined;
  }
  const value = node?.textContent?.trim();
  return value ? value : undefined;
}
