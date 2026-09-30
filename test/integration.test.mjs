import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/lib.mjs";
import { cli, result, project } from "./helpers.mjs";

const viewports = "1440x900,1024x768,768x1024,375x812";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-integration-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return temp;
}
async function local(t, dir) {
  const server = await startStaticServer(dir);
  t.after(server.close);
  return server;
}
const captureArgs = (url, out, selector = "#hero", views = "800x600") => [
  "capture",
  "--url",
  url,
  "--selector",
  selector,
  "--out",
  out,
  "--viewports",
  views,
  "--wait",
  "0",
  "--json",
];
const validateArgs = (url, out, selector = "#hero", views = "800x600") => [
  "validate",
  "--url",
  url,
  "--selector",
  selector,
  "--dir",
  out,
  "--viewports",
  views,
  "--wait",
  "0",
  "--json",
];

test(
  "image-set in inline, stylesheet and imported CSS remains portable offline",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(path.join(sourceDir, "styles"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "red.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
    );
    await fs.writeFile(
      path.join(sourceDir, "styles", "import.css"),
      '.imported{background-image:image-set("../red.svg" 1x type("image/svg+xml"), url(../red.svg) 2x)}',
    );
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>@import "styles/import.css";body{margin:0}.tile{width:100px;height:100px}.styled{background-image:-webkit-image-set("red.svg" 1x)}</style><section id="hero"><div class="tile" style='background-image:image-set("red.svg" 1x)'></div><div class="tile styled"></div><div class="tile imported"></div></section>`,
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli(captureArgs(source.url, out));
    assert.equal(captured.code, 0, captured.stdout + captured.stderr);
    assert.equal(result(captured).assets, 1);
    const verified = await cli(validateArgs(source.url, out));
    assert.equal(verified.code, 0, verified.stdout + verified.stderr);
    assert.deepEqual(result(verified).results[0].network.externalRequests, []);
  },
);

test(
  "successful capture and validation remove browser profiles and artifacts",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t);
    const scratch = path.join(temp, "browser-temp");
    await fs.mkdir(scratch);
    const source = await local(
      t,
      path.join(project, "examples/responsive-hero"),
    );
    const out = path.join(temp, "out");
    const env = {
      ...process.env,
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
    };
    for (const args of [
      captureArgs(source.url, out),
      validateArgs(source.url, out),
    ]) {
      const run = await cli(args, { env });
      assert.equal(run.code, 0, run.stdout + run.stderr);
      assert.deepEqual(
        await fs.readdir(scratch),
        [],
        "Browser owner must remove its temporary profiles and artifacts before returning",
      );
    }
  },
);

for (const [example, selector] of [
  ["responsive-hero", "#hero"],
  ["css-motion", "#motion"],
])
  test(
    `${example}: CLI capture, move, offline visual comparison and behavior`,
    { timeout: 120000 },
    async (t) => {
      const temp = await fixture(t),
        source = await local(t, path.join(project, "examples", example));
      const output = path.join(temp, "output");
      const captured = await cli(
        captureArgs(source.url, output, selector, viewports),
      );
      assert.equal(captured.code, 0, captured.stderr + captured.stdout);
      assert.equal(result(captured).status, "complete");
      assert.deepEqual((await fs.readdir(output)).sort(), [
        "assets",
        "index.html",
      ]);
      const moved = path.join(temp, "moved");
      await fs.rename(output, moved);
      const validated = await cli(
        validateArgs(source.url, moved, selector, viewports),
      );
      assert.equal(validated.code, 0, validated.stderr + validated.stdout);
      assert.equal(result(validated).results.length, 4);
      assert.ok(
        result(validated).results.every(
          (r) =>
            r.network.externalRequests.length === 0 &&
            r.visual.pass &&
            r.behavior === "not-tested",
        ),
      );
      const clone = await local(t, moved),
        browser = await chromium.launch();
      t.after(() => browser.close());
      const pages = [];
      for (const url of [source.url, clone.url]) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
        });
        pages.push(page);
        await page.goto(url);
        const target = page
          .locator(example === "css-motion" ? ".card" : ".button")
          .first();
        const initial = await target.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        await target.hover();
        await page.waitForTimeout(300);
        const hover = await target.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        assert.notEqual(hover, initial);
        await page.mouse.move(0, 0);
        await target.focus();
        await page.waitForTimeout(300);
        assert.equal(
          await target.evaluate((el) => getComputedStyle(el).backgroundColor),
          hover,
        );
      }
      if (example === "css-motion") {
        const observed = [];
        for (const page of pages)
          observed.push(
            await page.locator(".dot").evaluate((el) => {
              const a = el.getAnimations()[0];
              a.pause();
              a.currentTime = 0;
              const from = getComputedStyle(el).opacity;
              a.currentTime = 2000;
              return {
                from,
                to: getComputedStyle(el).opacity,
                duration: a.effect.getTiming().duration,
              };
            }),
          );
        assert.deepEqual(observed[0], observed[1]);
        assert.notEqual(observed[0].from, observed[0].to);
      }
    },
  );

test(
  "scripts and handlers are omitted; WAAPI and open shadow styles replay; forms stay local",
  { timeout: 60000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      `<!doctype html><style>body{margin:0}#hero{padding:20px}.box{width:40px;height:40px;background:red}</style><section id="hero"><button onclick="window.sentinel='handler'">Try</button><form action="/collect"><input name="message" value="hello"><input type="password" value="sensitive"><textarea>old</textarea><button>Send</button></form><div class="box"></div><div id="shadow"></div><svg><script>window.sentinel='svg'</script></svg><script>window.sentinel='source'</script></section><script>
  document.querySelector('textarea').value='edited';
  const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<style>span{color:rgb(12,34,56)}</style><span>Shadow content</span>';
  const a=document.querySelector('.box').animate([{opacity:.2},{opacity:.8}],{duration:1000,iterations:Infinity,easing:'linear'});a.pause();a.currentTime=500;a.playbackRate=2;
  document.querySelector('button').addEventListener('click',()=>window.externalListener=true);
  </script>`,
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli(captureArgs(source.url, out));
    assert.equal(captured.code, 2, captured.stdout + captured.stderr);
    assert.ok(
      result(captured).limitations.some(
        (l) => l.code === "SOURCE_RUNTIME_OMITTED",
      ),
    );
    assert.equal(result(captured).animationsReplayed, 1);
    const clone = await local(t, out),
      browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(clone.url);
    assert.equal(await page.evaluate(() => window.sentinel), undefined);
    await page.locator("button").first().click();
    assert.equal(await page.evaluate(() => window.externalListener), undefined);
    assert.equal(await page.locator("textarea").inputValue(), "edited");
    assert.equal(await page.locator("input[type=password]").inputValue(), "");
    assert.equal(
      await page
        .locator("#shadow span")
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(12, 34, 56)",
    );
    const animation = await page.locator(".box").evaluate((el) => {
      const a = el.getAnimations()[0];
      return {
        state: a.playState,
        time: a.currentTime,
        rate: a.playbackRate,
        opacity: getComputedStyle(el).opacity,
      };
    });
    assert.deepEqual(animation, {
      state: "paused",
      time: 500,
      rate: 2,
      opacity: "0.5",
    });
    await page.locator("form button").click();
    assert.equal(new URL(page.url()).pathname, "/");
  },
);

test(
  "CSS imports, srcset, SVG fragments and responsive variables localize correctly",
  { timeout: 90000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(path.join(sourceDir, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nested", "shape.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect id="tile" width="40" height="40" fill="red"/></svg>',
    );
    await fs.copyFile(
      path.join(project, "test/fixtures/uiport-test.ttf"),
      path.join(sourceDir, "nested", "uiport-test.ttf"),
    );
    await fs.writeFile(
      path.join(sourceDir, "nested", "font.css"),
      '@font-face{font-family:UITest;src:url(uiport-test.ttf) format("truetype")} .font{font:40px UITest}',
    );
    await fs.writeFile(
      path.join(sourceDir, "nested", "import.css"),
      "@import url(font.css) screen; .imported{background-image:url(shape.svg);width:40px;height:40px}",
    );
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/nested/"><style>@import url(import.css) layer(example) supports(display:grid);:root{--accent:rgb(255,0,0)}body{margin:0}#hero{padding:20px;background:var(--accent)}@media(max-width:600px){:root{--accent:rgb(0,0,255)}}</style><section id="hero"><img width="40" height="40" src="shape.svg" srcset="shape.svg 1x, shape.svg 2x"><svg width="40" height="40"><use href="shape.svg#tile"/></svg><div class="imported"></div><p class="font">UI UI</p></section>`,
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli(
      captureArgs(source.url, out, "#hero", "800x600,375x812"),
    );
    assert.equal(captured.code, 0, captured.stdout + captured.stderr);
    const html = await fs.readFile(path.join(out, "index.html"), "utf8");
    assert.match(html, /\.\/assets\/[^" ]+\.svg#tile/);
    assert.doesNotMatch(html, /@import/);
    assert.match(html, /\.\/assets\/[^" ]+\.ttf/);
    const validated = await cli(
      validateArgs(source.url, out, "#hero", "800x600,375x812"),
    );
    assert.equal(validated.code, 0, validated.stdout + validated.stderr);
  },
);

test(
  "missing and oversized resources produce partial output; exact-origin validation blocks another local port",
  { timeout: 60000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "big.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg">' + " ".repeat(4000) + "</svg>",
    );
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      '<section id="hero"><img src="missing.png"><img src="big.svg"></section>',
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const captured = await cli([
      ...captureArgs(source.url, out),
      "--max-resource-mb",
      "0.001",
    ]);
    assert.equal(captured.code, 2, captured.stdout + captured.stderr);
    assert.ok(
      result(captured).limitations.some(
        (l) => l.code === "RESOURCE_UNAVAILABLE",
      ),
    );
    const validated = await cli(validateArgs(source.url, out));
    assert.equal(validated.code, 1);
    assert.ok(
      result(validated).results[0].network.externalRequests.some((url) =>
        url.startsWith(source.url),
      ),
    );
  },
);

test(
  "CLI errors, deadline, missing browser and protected output do not leave artifacts",
  { timeout: 45000 },
  async (t) => {
    const temp = await fixture(t),
      source = await local(t, path.join(project, "examples/responsive-hero"));
    assert.equal((await cli(["--version"])).stdout.trim(), "0.1.0");
    assert.equal((await cli(["--help"])).code, 0);
    for (const [selector, extra] of [
      ["#missing", []],
      ["[", []],
      ["#hero", ["--timeout", "1000", "--wait", "5000"]],
    ]) {
      const out = path.join(temp, "out");
      const run = await cli([
        ...captureArgs(source.url, out, selector),
        ...extra,
      ]);
      assert.equal(run.code, 1, run.stdout);
      assert.equal(result(run).status, "failed");
      await assert.rejects(fs.access(out));
    }
    const out = path.join(temp, "protected");
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, "keep"), "keep");
    const protectedRun = await cli(captureArgs(source.url, out));
    assert.equal(protectedRun.code, 1);
    assert.equal(await fs.readFile(path.join(out, "keep"), "utf8"), "keep");
    const absent = await cli(
      captureArgs(source.url, path.join(temp, "absent")),
      {
        env: {
          ...process.env,
          UIPORT_BROWSER_PATH: path.join(temp, "no-browser"),
        },
      },
    );
    assert.equal(absent.code, 1);
    assert.match(result(absent).error.message, /does not exist/);
    assert.ok(!(await fs.readdir(temp)).some((n) => n.startsWith(".uiport-")));
  },
);

test(
  "serve emits one readiness document and closes on termination",
  { timeout: 10000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        path.join(project, "bin/cli.mjs"),
        "serve",
        "--dir",
        path.join(project, "examples/responsive-hero"),
        "--port",
        "0",
        "--json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    let output = "";
    const ready = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]));
      });
    });
    assert.equal((await fetch(ready.url)).status, 200);
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.kill("SIGTERM");
    await closed;
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).status);
    assert.deepEqual(events, ["ready"]);
    await assert.rejects(fetch(ready.url));
  },
);

test(
  "growing scroll is bounded and structural changes are reported",
  { timeout: 30000 },
  async (t) => {
    const temp = await fixture(t),
      sourceDir = path.join(temp, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      `<meta name="viewport" content="width=device-width,initial-scale=1"><section id="hero" style="height:50000px">Start</section><script>const h=document.querySelector('#hero');h.innerHTML=innerWidth<600?'<p>Mobile</p>':'<div>Desktop</div>';window.addEventListener('scroll',()=>h.style.height=(h.offsetHeight+1000)+'px');</script>`,
    );
    const source = await local(t, sourceDir),
      out = path.join(temp, "out");
    const run = await cli([
      ...captureArgs(source.url, out, "#hero", "800x600,375x812"),
      "--max-scroll-steps",
      "2",
    ]);
    assert.equal(run.code, 2, run.stdout + run.stderr);
    const codes = result(run).limitations.map((l) => l.code);
    assert.ok(codes.includes("SCROLL_LIMIT"));
    assert.ok(codes.includes("RESPONSIVE_DOM_CHANGED"));
  },
);

test(
  "cancelling capture closes the browser without creating an output",
  {
    timeout: 15000,
    skip:
      process.platform === "win32" &&
      "Windows child.kill forcibly terminates; it does not deliver POSIX signals",
  },
  async (t) => {
    const temp = await fixture(t),
      source = await local(t, path.join(project, "examples/responsive-hero"));
    const out = path.join(temp, "out");
    const args = captureArgs(source.url, out);
    args[args.indexOf("--wait") + 1] = "60000";
    const child = spawn(
      process.execPath,
      [path.join(project, "bin/cli.mjs"), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    const closed = new Promise((resolve) => child.once("close", resolve));
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stderr.once("data", resolve);
    });
    child.kill("SIGTERM");
    assert.equal(await closed, 1);
    assert.equal(JSON.parse(stdout).status, "failed");
    await assert.rejects(fs.access(out));
  },
);

test(
  "bounded scroll, unavailable resources and an invalid selector produce truthful outcomes",
  { timeout: 30000 },
  async (t) => {
    const dir = await fixture(t);
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const sourceDir = path.join(dir, "source");
    await fs.mkdir(sourceDir);
    await fs.writeFile(
      path.join(sourceDir, "index.html"),
      '<main id="hero" style="height:9000px"><img src="missing.svg">Long page</main>',
    );
    const source = await startStaticServer(sourceDir);
    t.after(source.close);
    const result = await cli([
      "capture",
      "--url",
      source.url,
      "--selector",
      "#hero",
      "--out",
      path.join(dir, "out"),
      "--viewports",
      "800x600",
      "--max-scroll-steps",
      "1",
      "--wait",
      "0",
      "--json",
    ]);
    assert.equal(result.code, 2, result.stdout);
    assert.ok(
      JSON.parse(result.stdout).limitations.some(
        (l) => l.code === "SCROLL_LIMIT",
      ),
    );
    assert.ok(
      JSON.parse(result.stdout).limitations.some(
        (l) => l.code === "RESOURCE_UNAVAILABLE",
      ),
    );
    const invalid = await cli([
      "capture",
      "--url",
      source.url,
      "--selector",
      "[",
      "--out",
      path.join(dir, "invalid"),
      "--viewports",
      "800x600",
      "--max-scroll-steps",
      "1",
      "--wait",
      "0",
      "--json",
    ]);
    assert.equal(invalid.code, 1);
    await assert.rejects(fs.access(path.join(dir, "invalid")));
  },
);
