/** Byte caps use UTF-8, rather than JavaScript string length. */
export const TOOL_LIMITS = Object.freeze({
  schemaBytes: 16 * 1024,
  properties: 32,
  enumValues: 50,
  enumStringLength: 64,
  toolDescriptionLength: 500,
  propertyDescriptionLength: 200,
  toolsPerPack: 32,
  announcementTools: 64,
  announcementBytes: 256 * 1024,
  sessionPackTools: 24,
  resultTextBytes: 64 * 1024,
  resultStructuredBytes: 64 * 1024,
});
