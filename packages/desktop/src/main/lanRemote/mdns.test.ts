import assert from "node:assert/strict";
import test from "node:test";
import {
  announcementAnswersQuery,
  buildLanRemoteAnnouncement,
  buildLanRemoteQueryResponse,
} from "./mdns.js";

const announcement = {
  instanceName: "studio",
  hostname: "studio",
  port: 47321,
  addresses: ["192.168.1.20"],
  deviceId: "device-1",
  fingerprint: "ab".repeat(32),
};

test("announcement carries the service name, port, and fingerprint but not a password", () => {
  const packet = buildLanRemoteAnnouncement(announcement);
  const text = packet.toString("utf8");
  assert.equal(text.includes("_zcode"), true);
  assert.equal(text.includes(announcement.fingerprint), true);
  assert.equal(text.includes("password"), false);
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(announcement.port);
  assert.equal(packet.includes(portBytes), true);
  assert.equal(packet.includes(Buffer.from([192, 168, 1, 20])), true);
});

test("a PTR query for the service is answered with the same transaction id", () => {
  const questionName = Buffer.concat([
    Buffer.from([6]),
    Buffer.from("_zcode"),
    Buffer.from([4]),
    Buffer.from("_tcp"),
    Buffer.from([5]),
    Buffer.from("local"),
    Buffer.from([0]),
    Buffer.from([0x00, 0x0c, 0x00, 0x01]),
  ]);
  const query = Buffer.concat([
    Buffer.from([0x12, 0x34, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    questionName,
  ]);
  assert.equal(announcementAnswersQuery(query, announcement), true);
  const response = buildLanRemoteQueryResponse(query, announcement);
  assert.equal(response.readUInt16BE(0), 0x1234);
});
