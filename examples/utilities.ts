/**
 * The helper functions you can use on their own.
 */
import {
  CertificateSigner,
  CurrencyDecimals,
  DefaultResultCodes,
  MessageTypes,
  canonicalMsgBody,
  currencyDecimals,
  formatAmount,
  formatTimestamp,
  isAmountInRange,
  normalizeMobileNumber,
  parseAmount,
  signMessage,
  toInternationalMobile,
  verifyMessage,
} from 'e-sadad-xml';

// Mobile numbers ------------------------------------------------------------------
normalizeMobileNumber('0599123456'); //    '0599123456'
normalizeMobileNumber('+970 599-123-456'); // '0599123456'
normalizeMobileNumber('972599123456'); //  '0599123456'
normalizeMobileNumber('12345'); //         ''  (invalid)
toInternationalMobile('0599123456'); //    '970599123456'
toInternationalMobile('0599123456', '972'); // '972599123456'

// Amounts -------------------------------------------------------------------------
formatAmount(10, 'JOD'); //    '10.000'  (JOD has 3 decimals)
formatAmount(5.5, 'ILS'); //   '5.50'
formatAmount('7', 'USD'); //   '7.00'
currencyDecimals('JOD'); //    3
CurrencyDecimals.ILS; //       2
parseAmount('20.50'); //       20.5
parseAmount('0x10'); //        undefined (only plain decimals are accepted)
isAmountInRange(50, 1, 100); // true

// Timestamps (TmStp format) ---------------------------------------------------------
formatTimestamp(new Date(2026, 10, 12, 9, 5, 0)); // '2026-11-12T09:05:00'

// Constants -----------------------------------------------------------------------
MessageTypes.PREPAID_VALIDATION_RESPONSE; // 'BILRPREPADVALRS'
DefaultResultCodes.INVALID_BILLING_NUMBER; // { code: 408, desc: 'Invalid Billing Number', severity: 'Error' }

// Signing and verifying whole messages ------------------------------------------------
async function signatures() {
  const signer = new CertificateSigner({
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' }, // used by verify()
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' }, // used by sign()
  });

  const xml = '<MFEP><MsgHeader><GUID>1</GUID></MsgHeader><MsgBody><A>1</A></MsgBody></MFEP>';
  const signed = await signMessage(xml, signer); // adds MsgFooter/Security/Signature
  console.log(signed);

  // Verifying needs the *other* side's certificate: this checks a message signed by E-SADAD.
  const { valid, reason } = await verifyMessage(signed, signer);
  console.log(valid, reason); // false 'invalid-signature' here: we signed it ourselves, not E-SADAD

  // The exact text that gets signed (useful when debugging "Invalid Signature"):
  console.log(canonicalMsgBody(xml)); // '<MsgBody><A>1</A></MsgBody>'
}

void signatures();
