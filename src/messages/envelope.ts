import type { ResultCode } from '../constants';
import type { MessageHeader } from '../types';
import { el, leaf, type XmlNode } from '../xml/builder';
import { findFirst, text, type XDocument } from '../xml/parser';

export function resultNode(result: ResultCode): XmlNode {
  return el('Result', leaf('ErrorCode', result.code), leaf('ErrorDesc', result.desc), leaf('Severity', result.severity));
}

export interface EnvelopeOptions {
  timestamp: string;
  guid: string;
  senderCode: string;
  responseType: string;
  result: ResultCode;
  body: XmlNode;
  signature: string;
}

/** Builds `<MFEP><MsgHeader/><MsgBody/><MsgFooter/></MFEP>`. */
export function buildEnvelope(o: EnvelopeOptions): XmlNode {
  return el(
    'MFEP',
    el(
      'MsgHeader',
      leaf('TmStp', o.timestamp),
      leaf('GUID', o.guid),
      el('TrsInf', leaf('SdrCode', o.senderCode), leaf('ResTyp', o.responseType)),
      resultNode(o.result),
    ),
    o.body,
    el('MsgFooter', el('Security', leaf('Signature', o.signature))),
  );
}

export function parseHeader(doc: XDocument): MessageHeader {
  const header = findFirst(doc, 'MsgHeader');
  return {
    timestamp: text(header, 'TmStp'),
    guid: text(header, 'GUID'),
    senderCode: text(header, 'SdrCode'),
    receiverCode: text(header, 'RcvCode'),
    requestType: text(header, 'ReqTyp'),
  };
}
