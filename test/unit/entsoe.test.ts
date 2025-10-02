import { __testables } from '../../src/entsoe';

const { parseEntsoeXml } = __testables;

describe('ENTSO-E parser', () => {
  it('rejects acknowledgement documents with meaningful error message', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Acknowledgement_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-1:acknowledgementdocument:7:0">
  <mRID>bad7ffa5-1a1b-4</mRID>
  <createdDateTime>2025-10-02T20:14:35Z</createdDateTime>
  <sender_MarketParticipant.mRID codingScheme="A01">10X1001A1001A450</sender_MarketParticipant.mRID>
  <sender_MarketParticipant.marketRole.type>A32</sender_MarketParticipant.marketRole.type>
  <receiver_MarketParticipant.mRID codingScheme="A01">10X1001A1001A450</receiver_MarketParticipant.mRID>
  <receiver_MarketParticipant.marketRole.type>A39</receiver_MarketParticipant.marketRole.type>
  <received_MarketDocument.createdDateTime>2025-10-02T20:14:35Z</received_MarketDocument.createdDateTime>
  <Reason>
    <code>999</code>
    <text>No matching data found for Data item ENERGY_PRICES and interval 2025-10-01T22:00:00.000Z/2025-10-02T22:00:00.000Z</text>
  </Reason>
</Acknowledgement_MarketDocument>`;

    expect(() => parseEntsoeXml(xml)).toThrowError(/No matching data found/);
  });
});
