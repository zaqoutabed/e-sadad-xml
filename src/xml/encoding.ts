import { TextDecoder } from 'node:util';

/** Thrown when a request declares a character set this runtime cannot decode. Maps to HTTP 415. */
export class UnsupportedCharsetError extends Error {
  readonly status = 415;

  constructor(charset: string) {
    super(`Unsupported charset "${charset}"`);
    this.name = 'UnsupportedCharsetError';
  }
}

/**
 * Detects UTF-8 / UTF-16 from the first bytes: a byte-order mark, or the
 * pattern of an XML document starting with `<` in UTF-16.
 */
function sniffEncoding(bytes: Buffer): string | undefined {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return 'utf-8';
  if (b0 === 0xff && b1 === 0xfe) return 'utf-16le';
  if (b0 === 0xfe && b1 === 0xff) return 'utf-16be';
  if (b0 === 0x3c && b1 === 0x00) return 'utf-16le';
  if (b0 === 0x00 && b1 === 0x3c) return 'utf-16be';
  return undefined;
}

/**
 * Decodes a raw XML request body to a string.
 *
 * Order of precedence: what the bytes themselves show (BOM or UTF-16 pattern),
 * then the `charset` from the Content-Type header, then UTF-8. E-SADAD's
 * sender may emit UTF-16 XML without saying so in the header, which is why
 * the bytes win.
 */
export function decodeXmlBody(body: Buffer, charset?: string): string {
  const encoding = sniffEncoding(body) ?? charset?.trim().toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(body); // also strips a leading BOM
  } catch {
    throw new UnsupportedCharsetError(encoding);
  }
}
