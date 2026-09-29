import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import {
  OversizedInlineFileAttachmentError,
  createChatComposerAttachment,
  serializeChatComposerAttachment,
} from "./chatAttachments.js";

test("a phone file without a host path uploads its bytes", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "notes.zip", {
    type: "application/zip",
  });
  const serialized = await serializeChatComposerAttachment(createChatComposerAttachment(file));
  assert.equal(serialized.kind, "file");
  assert.equal("localPath" in serialized ? serialized.localPath : undefined, undefined);
  assert.equal("dataBase64" in serialized ? serialized.dataBase64 : undefined, "AQIDBA==");
});

test("a phone file over the upload limit fails before it is dropped", async () => {
  const file = new File([new Uint8Array([1])], "huge.bin", { type: "application/octet-stream" });
  Object.defineProperty(file, "size", { value: PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1 });
  await assert.rejects(
    () => serializeChatComposerAttachment(createChatComposerAttachment(file)),
    (error: unknown) => error instanceof OversizedInlineFileAttachmentError,
  );
});
