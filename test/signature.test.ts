import { X509Certificate, createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import {
  CertificateSigner,
  EsadadConfigError,
  canonicalMsgBody,
  loadPemPrivateKey,
  loadPfxPrivateKey,
  loadPublicKey,
  signData,
  signMessage,
  verifyData,
  verifyMessage,
} from '../src';
import { billerIdentity, esadadIdentity, esadadSide } from './helpers';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');

/**
 * Golden vectors produced by the E-SADAD Python reference implementation
 * (lxml c14n + remove_whitespace_between_tags).
 */
const GOLDEN = [
  {
    name: 'indented body, entities, attributes, Arabic text, empty element, comment',
    input:
      '<MFEP xmlns="">\n    <MsgHeader><GUID>a1</GUID></MsgHeader>\n    <MsgBody>\n        <BillingInfo>\n            <AcctInfo>\n                <BillingNo>0599123456</BillingNo>\n                <BillerCode>999</BillerCode>\n            </AcctInfo>\n            <DueAmt>20.00</DueAmt>\n            <ValidationCode>VC-1 &amp; "q" &gt; x</ValidationCode>\n            <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>\n            <Note attrB="2" attrA=\'1 &lt; "3"\'>شحن رصيد   مع مسافات</Note>\n            <Empty/>\n            <!-- comment -->\n        </BillingInfo>\n    </MsgBody>\n    <MsgFooter><Security><Signature></Signature></Security></MsgFooter>\n</MFEP>\n',
    expected:
      '<MsgBody><BillingInfo><AcctInfo><BillingNo>0599123456</BillingNo><BillerCode>999</BillerCode></AcctInfo><DueAmt>20.00</DueAmt><ValidationCode>VC-1 &amp; "q" &gt; x</ValidationCode><ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails><Note attrA="1 &lt; &quot;3&quot;" attrB="2">شحن رصيد   مع مسافات</Note><Empty></Empty><!-- comment --></BillingInfo></MsgBody>',
  },
  {
    name: 'CRLF line endings and CDATA',
    input:
      '<MFEP><MsgHeader><GUID>g-2</GUID></MsgHeader>\r\n<MsgBody>\r\n  <Transactions>\r\n    <TrxInf><JOEBPPSTrx>T1</JOEBPPSTrx><PaidAmt>5.5</PaidAmt><X><![CDATA[a<b & c]]></X></TrxInf>\r\n  </Transactions>\r\n</MsgBody><MsgFooter><Security><Signature/></Security></MsgFooter></MFEP>',
    expected:
      '<MsgBody><Transactions><TrxInf><JOEBPPSTrx>T1</JOEBPPSTrx><PaidAmt>5.5</PaidAmt><X>a&lt;b &amp; c</X></TrxInf></Transactions></MsgBody>',
  },
  {
    name: 'inherited namespaces',
    input:
      '<ns:MFEP xmlns:ns="urn:x" xmlns="urn:default"><MsgHeader><GUID>g3</GUID></MsgHeader><MsgBody xmlns:b="urn:b"><b:Item b:z="1" a="2">  text  </b:Item><Plain>x</Plain></MsgBody><MsgFooter><Security><Signature/></Security></MsgFooter></ns:MFEP>\n',
    expected:
      '<MsgBody xmlns="urn:default" xmlns:b="urn:b" xmlns:ns="urn:x"><b:Item a="2" b:z="1">  text  </b:Item><Plain>x</Plain></MsgBody>',
  },
];

describe('canonical MsgBody (compatible with the Python reference)', () => {
  for (const vector of GOLDEN) {
    it(vector.name, () => {
      expect(canonicalMsgBody(parse(vector.input))).toBe(vector.expected);
    });
  }
});

describe('signing', () => {
  const privateKey = loadPfxPrivateKey({ data: billerIdentity.pfx }, billerIdentity.password);
  const publicKey = loadPublicKey({ data: billerIdentity.certPem });

  it('canonicalMsgBody also accepts an XML string', () => {
    expect(canonicalMsgBody('<MFEP><MsgBody>\n  <A>1</A>\n</MsgBody></MFEP>')).toBe('<MsgBody><A>1</A></MsgBody>');
  });

  it('signs over UTF-16LE with RSA-SHA256 and verifies', () => {
    const data = '<MsgBody><A>نص</A></MsgBody>';
    const sig = signData(data, privateKey);
    expect(verifyData(data, sig, publicKey)).toBe(true);
    expect(verifyData(data + ' ', sig, publicKey)).toBe(false);
  });

  it('rejects garbage and empty signatures without throwing', () => {
    expect(verifyData('x', '', publicKey)).toBe(false);
    expect(verifyData('x', '!!!not-base64!!!', publicKey)).toBe(false);
    expect(verifyData('x', 'AAAA', publicKey)).toBe(false);
  });

  it('signMessage/verifyMessage round-trip, and detects tampering', async () => {
    const xml = '<MFEP><MsgHeader/><MsgBody>\n  <A>1</A>\n</MsgBody></MFEP>';
    const signed = await signMessage(xml, esadadSide);
    expect(signed).toContain('<MsgFooter><Security><Signature>');

    const esadadVerifier = new CertificateSigner({
      esadadCertificate: { data: esadadIdentity.certPem },
      billerPrivateKey: { data: billerIdentity.keyPem },
    });
    expect(await verifyMessage(signed, esadadVerifier)).toEqual({ valid: true });
    expect(await verifyMessage(signed.replace('<A>1</A>', '<A>2</A>'), esadadVerifier)).toEqual({
      valid: false,
      reason: 'invalid-signature',
    });
    expect(await verifyMessage(xml, esadadVerifier)).toEqual({ valid: false, reason: 'missing-signature' });
  });

  it('loads DER certificates, bare public keys and DER private keys', () => {
    const der = new X509Certificate(billerIdentity.certPem).raw;
    const fromDer = loadPublicKey({ data: der });
    const spkiPem = new X509Certificate(billerIdentity.certPem).publicKey.export({ type: 'spki', format: 'pem' });
    const fromSpki = loadPublicKey({ data: spkiPem });
    const pkcs8Der = createPrivateKey(billerIdentity.keyPem).export({ type: 'pkcs8', format: 'der' });
    const priv = loadPemPrivateKey({ data: pkcs8Der });
    const sig = signData('x', priv);
    expect(verifyData('x', sig, fromDer)).toBe(true);
    expect(verifyData('x', sig, fromSpki)).toBe(true);
    expect(() => loadPemPrivateKey({ data: 'garbage' })).toThrow(EsadadConfigError);
  });

  it('reports configuration problems clearly', () => {
    expect(() => loadPfxPrivateKey({ data: billerIdentity.pfx }, 'wrong')).toThrow(EsadadConfigError);
    expect(() => loadPublicKey({ data: 'not a certificate' })).toThrow(EsadadConfigError);
    expect(() => loadPublicKey({ path: '/does/not/exist.cer' })).toThrow(EsadadConfigError);
    expect(() => new CertificateSigner({ esadadCertificate: { data: esadadIdentity.certPem } })).toThrow(/billerPfx/);
  });
});
