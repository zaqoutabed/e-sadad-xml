import type { XDocument, XElement, XNode } from './parser';
import { findFirst, parseXml } from './parser';
import { EsadadError } from '../errors';

/**
 * Inclusive Canonical XML 1.0 (with comments), the same output as
 * `lxml.etree.tostring(element, method='c14n')` in the E-SADAD reference code.
 */

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PI = 7;
const COMMENT = 8;
const XMLNS_URI = 'http://www.w3.org/2000/xmlns/';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

interface Attr {
  name: string;
  prefix?: string | null;
  localName?: string | null;
  namespaceURI?: string | null;
  value: string;
}

function attributesOf(el: XElement): Attr[] {
  const list: Attr[] = [];
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) list.push(attrs.item(i) as unknown as Attr);
  return list;
}

function isNsDecl(a: Attr): boolean {
  return a.name === 'xmlns' || a.name.startsWith('xmlns:') || a.namespaceURI === XMLNS_URI;
}

function nsPrefix(a: Attr): string {
  return a.name === 'xmlns' ? '' : a.name.slice('xmlns:'.length);
}

/** Namespace declarations in scope at `el` (the nearest declaration wins). */
function inScopeNamespaces(el: XElement): Map<string, string> {
  const chain: XElement[] = [];
  for (let n: XNode | null = el; n && n.nodeType === ELEMENT; n = n.parentNode) chain.push(n as XElement);
  const map = new Map<string, string>();
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const a of attributesOf(chain[i]!)) if (isNsDecl(a)) map.set(nsPrefix(a), a.value);
  }
  return map;
}

function serializeElement(el: XElement, rendered: Map<string, string>, isApex: boolean): string {
  const scope = isApex ? inScopeNamespaces(el) : new Map<string, string>();
  if (!isApex) for (const a of attributesOf(el)) if (isNsDecl(a)) scope.set(nsPrefix(a), a.value);

  const nextRendered = new Map(rendered);
  const nsOut: Array<[string, string]> = [];
  for (const [prefix, uri] of scope) {
    // The default namespace starts as "" (so a redundant xmlns="" is dropped); prefixes start undeclared.
    const current = rendered.get(prefix) ?? (prefix === '' ? '' : undefined);
    if (current === uri) continue;
    nsOut.push([prefix, uri]);
    nextRendered.set(prefix, uri);
  }
  nsOut.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const attrs = attributesOf(el)
    .filter((a) => !isNsDecl(a))
    .sort((a, b) => {
      const ua = a.namespaceURI ?? '';
      const ub = b.namespaceURI ?? '';
      if (ua !== ub) return ua < ub ? -1 : 1;
      const la = a.localName ?? a.name;
      const lb = b.localName ?? b.name;
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

  let out = `<${el.tagName}`;
  for (const [prefix, uri] of nsOut) out += prefix ? ` xmlns:${prefix}="${escapeAttr(uri)}"` : ` xmlns="${escapeAttr(uri)}"`;
  for (const a of attrs) out += ` ${a.name}="${escapeAttr(a.value)}"`;
  out += '>';
  for (let c = el.firstChild; c; c = c.nextSibling) out += serializeNode(c, nextRendered);
  return `${out}</${el.tagName}>`;
}

function serializeNode(node: XNode, rendered: Map<string, string>): string {
  switch (node.nodeType) {
    case ELEMENT:
      return serializeElement(node as XElement, rendered, false);
    case TEXT:
    case CDATA:
      return escapeText(node.nodeValue ?? '');
    case COMMENT:
      return `<!--${node.nodeValue ?? ''}-->`;
    case PI: {
      const pi = node as unknown as { target: string; data: string };
      return pi.data ? `<?${pi.target} ${pi.data}?>` : `<?${pi.target}?>`;
    }
    default:
      return '';
  }
}

/** Canonicalises one element and its subtree (inclusive C14N 1.0 with comments). */
export function canonicalize(element: XElement): string {
  return serializeElement(element, new Map(), true);
}

/**
 * Builds the exact string E-SADAD signs:
 * 1. canonicalise `<MsgBody>`,
 * 2. remove whitespace between tags inside it and trim its content.
 *
 * The signature is then computed over this string encoded as UTF-16LE.
 * Accepts an XML string or an already parsed document.
 */
export function canonicalMsgBody(doc: string | XDocument | XElement): string {
  const root = typeof doc === 'string' ? parseXml(doc) : doc;
  const body = findFirst(root as XNode, 'MsgBody');
  if (!body) throw new EsadadError('INVALID_REQUEST', 'MsgBody element not found');
  return compactMsgBody(canonicalize(body));
}

/** Same whitespace rule as the reference `remove_whitespace_between_tags`. */
export function compactMsgBody(c14n: string): string {
  const match = /(<MsgBody[^>]*>)([\s\S]*?)(<\/MsgBody>)/.exec(c14n);
  if (!match) return c14n;
  const inner = match[2]!;
  const cleaned = inner.replace(/>\s+</g, '><').trim();
  return c14n.slice(0, match.index) + match[1] + cleaned + match[3] + c14n.slice(match.index + match[0].length);
}
