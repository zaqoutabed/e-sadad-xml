/**
 * Small XML builder. Every value is escaped, so request data can never inject
 * markup into a response. Empty elements are written as `<a></a>` (canonical form).
 */

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text?: string;
}

export type XmlValue = string | number | boolean | null | undefined;
type ChildInput = XmlNode | null | undefined | false | ChildInput[];

/** Element containing a text value. `null`/`undefined` produce an empty element. */
export function leaf(name: string, value?: XmlValue): XmlNode {
  return { name, children: [], text: value === null || value === undefined ? '' : String(value) };
}

/** Optional text element: omitted when `value` is `null`, `undefined` or `''`. */
export function optLeaf(name: string, value: XmlValue): XmlNode | null {
  return value === null || value === undefined || value === '' ? null : leaf(name, value);
}

/** Element containing child elements. Falsy children are skipped and arrays are flattened. */
export function el(name: string, ...children: ChildInput[]): XmlNode {
  const flat: XmlNode[] = [];
  const push = (c: ChildInput) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c) flat.push(c);
  };
  children.forEach(push);
  return { name, children: flat };
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Serialises a node tree without whitespace between tags. */
export function toXml(node: XmlNode): string {
  if (node.children.length === 0) return `<${node.name}>${escapeText(node.text ?? '')}</${node.name}>`;
  return `<${node.name}>${node.children.map(toXml).join('')}</${node.name}>`;
}
