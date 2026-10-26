const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { MAX_ATTACHMENT_BYTES, extractSupportedAttachments } = require("./mail-service.cjs");

describe("email attachment filtering", () => {
  it("keeps supported PDF and image attachments and ignores other file types", () => {
    const result = extractSupportedAttachments({
      type: "multipart/mixed",
      childNodes: [
        {
          type: "application/pdf",
          part: "2",
          size: 1200,
          disposition: "attachment",
          dispositionParameters: { filename: "invoice.pdf" },
        },
        {
          type: "image/png",
          part: "3",
          size: 800,
          disposition: "attachment",
          dispositionParameters: { filename: "scan.png" },
        },
        {
          type: "application/zip",
          part: "4",
          size: 900,
          disposition: "attachment",
          dispositionParameters: { filename: "archive.zip" },
        },
      ],
    });

    assert.deepEqual(result.map(({ name, mimeType }) => ({ name, mimeType })), [
      { name: "invoice.pdf", mimeType: "application/pdf" },
      { name: "scan.png", mimeType: "image/png" },
    ]);
  });

  it("skips oversized files and sanitizes attachment names", () => {
    const result = extractSupportedAttachments({
      type: "multipart/mixed",
      childNodes: [
        {
          type: "application/pdf",
          part: "1",
          size: MAX_ATTACHMENT_BYTES + 1,
          disposition: "attachment",
          dispositionParameters: { filename: "too-large.pdf" },
        },
        {
          type: "application/pdf",
          part: "2",
          size: 10,
          disposition: "attachment",
          dispositionParameters: { filename: "../private:report?.pdf" },
        },
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].name.includes("/"), false);
    assert.equal(result[0].name.includes("?"), false);
    assert.equal(result[0].mimeType, "application/pdf");
  });
});
