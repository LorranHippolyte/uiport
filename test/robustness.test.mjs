import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  captureArgs,
  cli,
  fixture,
  local,
  result,
  validateArgs,
} from "./helpers.mjs";

const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<section id="hero"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/%3E" srcset="a.svg 1x a.svg 2x" alt="x"></section>`;

test(
  "stdout carries exactly one JSON document when a dependency prints to stdout",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, "index.html"), page);
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli(captureArgs(source.url, out));
    assert.equal(captured.code, 2, captured.stdout + captured.stderr);
    const parsed = result(captured);
    assert.equal(parsed.status, "partial");
    assert.ok(
      parsed.limitations.some((l) => l.code === "SRCSET_INVALID"),
      parsed.stdout,
    );
    // An unparsable descriptor list is preserved, not silently dropped.
    const html = await fs.readFile(path.join(out, "index.html"), "utf8");
    assert.match(html, /srcset="a\.svg 1x a\.svg 2x"/);
    // Source page content never reaches the diagnostics channel.
    assert.doesNotMatch(captured.stderr, /a\.svg 1x a\.svg 2x/);
  },
);

test(
  "a root that does not render is reported instead of waiting for a screenshot",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<section id="hidden" style="display:none">hidden</section>
<section id="empty" style="width:0;height:0;overflow:hidden">empty</section>`,
    );
    const source = await local(t, sourceDir);
    for (const [selector, code] of [
      ["#hidden", "SECTION_NOT_VISIBLE"],
      ["#empty", "SECTION_EMPTY_AREA"],
    ]) {
      const out = path.join(temp, `out-${code}`);
      const captured = await cli(captureArgs(source.url, out, selector));
      assert.equal(captured.code, 2, captured.stdout + captured.stderr);
      const parsed = result(captured);
      assert.ok(
        parsed.limitations.some((l) => l.code === code),
        parsed.stdout,
      );
      assert.doesNotMatch(captured.stderr, /Timeout/);
    }
  },
);

test(
  "validation refuses a root that does not render with an actionable message",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><section id="empty" style="width:0;height:0;overflow:hidden">empty</section>',
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli(captureArgs(source.url, out, "#empty"));
    assert.equal(captured.code, 2, captured.stdout + captured.stderr);
    const validated = await cli(validateArgs(source.url, out, "#empty"));
    assert.equal(validated.code, 1, validated.stdout + validated.stderr);
    assert.match(
      result(validated).error.message,
      /does not render a visible box/,
    );
    assert.doesNotMatch(validated.stderr, /Timeout/);
  },
);
