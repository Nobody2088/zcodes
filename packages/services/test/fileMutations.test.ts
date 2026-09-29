import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileService } from "../src/file/fileService.js";

test("file mutations create, write, rename, and remove without touching the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-file-mutations-"));
  const service = createFileService();
  try {
    const created = await service.createDirectory({ path: join(root, "project") });
    assert.equal(created.path, join(root, "project"));

    const written = await service.writeTextFile({
      path: join(created.path, "note.txt"),
      content: "hello",
    });
    assert.equal(await readFile(written.path, "utf8"), "hello");
    assert.equal(written.bytesWritten, Buffer.byteLength("hello"));

    const renamed = await service.renamePath({
      from: written.path,
      to: join(created.path, "renamed.txt"),
    });
    assert.equal(await readFile(renamed.path, "utf8"), "hello");

    await assert.rejects(service.removePath({ path: "/" }));
    await service.removePath({ path: created.path });
    await assert.rejects(readFile(renamed.path, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removing a symlink removes the link and leaves the target", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-file-symlink-"));
  const service = createFileService();
  const target = join(root, "target.txt");
  const link = join(root, "link.txt");
  await writeFile(target, "keep");
  await symlink(target, link);
  try {
    await service.removePath({ path: link });
    assert.equal(await readFile(target, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
