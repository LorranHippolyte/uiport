import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/lib.mjs";
import { cli, result } from "./helpers.mjs";

async function fixture(t, handler) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "uiport-migration-"),
  );
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  t.after(async () => {
    await close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, url, close };
}
const common = (url, selector, viewports = "800x600") => [
  "--url",
  url,
  "--selector",
  selector,
  "--viewports",
  viewports,
  "--wait",
  "0",
  "--json",
];
async function browserFor(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  return browser;
}

test(
  "migration preserves full pages, section scripts, visual libraries and pt-BR by default",
  { timeout: 60000 },
  async (t) => {
    const source = await fixture(t, (req, res) => {
      if (req.url === "/gsap.min.js") {
        res.setHeader("content-type", "text/javascript");
        return res.end('window.visualLabel=()=>"Biblioteca preservada";');
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><head><title>Página original</title><style>body{margin:0}#hero{padding:20px}</style><script>window.headPresent=true</script><script src="/gsap.min.js"></script></head><body><header>Cabeçalho</header><main id="hero"><p id="locale">${req.headers["accept-language"].split(",")[0]}</p><button id="inline" onclick="this.textContent=visualLabel()">Clique</button><button id="registered">Registro</button><script>document.querySelector('#registered').addEventListener('click',e=>e.target.textContent='Script preservado')</script></main><footer>Rodapé</footer></body></html>`,
      );
    });
    const browser = await browserFor(t);
    for (const selector of ["#hero", "body", "html"]) {
      const out = path.join(source.directory, selector.replace("#", ""));
      const captured = await cli([
        "capture",
        ...common(source.url, selector),
        "--out",
        out,
      ]);
      assert.equal(captured.code, 2, captured.stdout + captured.stderr);
      assert.ok(
        result(captured).limitations.some(
          (l) => l.code === "SOURCE_RUNTIME_UNVERIFIED",
        ),
      );
      const preview = await startStaticServer(out);
      t.after(preview.close);
      const page = await browser.newPage();
      await page.goto(preview.url);
      assert.equal(await page.locator("html").count(), 1);
      assert.equal(await page.locator("body").count(), 1);
      assert.equal(await page.locator('[data-uiport-root="true"]').count(), 1);
      assert.equal(
        await page
          .locator('[data-uiport-root="true"]')
          .evaluate((el) => el.tagName),
        selector === "#hero" ? "MAIN" : selector.toUpperCase(),
      );
      assert.equal(await page.locator("#locale").textContent(), "pt-BR");
      assert.equal(await page.title(), "Página original");
      if (selector !== "#hero") {
        assert.equal(await page.locator("header").textContent(), "Cabeçalho");
        assert.equal(await page.locator("footer").textContent(), "Rodapé");
      }
      if (selector === "html")
        assert.equal(await page.evaluate(() => window.headPresent), true);
      await page.locator("#inline").click();
      assert.equal(
        await page.locator("#inline").textContent(),
        "Biblioteca preservada",
      );
      await page.locator("#registered").click();
      assert.equal(
        await page.locator("#registered").textContent(),
        "Script preservado",
      );
      const validated = await cli([
        "validate",
        ...common(source.url, selector),
        "--dir",
        out,
      ]);
      assert.equal(validated.code, 0, validated.stdout + validated.stderr);
      await page.close();
    }
  },
);

test(
  "migration keeps browser-loaded resources through redirects without refetching or a personal session",
  { timeout: 30000 },
  async (t) => {
    let imageRequests = 0;
    const source = await fixture(t, (req, res) => {
      if (req.url === "/image") {
        res.writeHead(302, { location: "/shape.svg" });
        return res.end();
      }
      if (req.url === "/shape.svg") {
        imageRequests++;
        if (!req.headers.referer) return res.writeHead(403).end();
        res.setHeader("content-type", "image/svg+xml");
        return res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="red"/></svg>',
        );
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end('<section id="hero"><img src="/image"></section>');
    });
    const out = path.join(source.directory, "out");
    const captured = await cli([
      "capture",
      ...common(source.url, "#hero"),
      "--out",
      out,
    ]);
    assert.equal(captured.code, 0, captured.stdout + captured.stderr);
    assert.equal(result(captured).assets, 1);
    assert.equal(
      imageRequests,
      1,
      "Export must reuse the already received response, including the redirect alias",
    );
    await source.close();
    const preview = await startStaticServer(out);
    t.after(preview.close);
    const browser = await browserFor(t);
    const page = await browser.newPage();
    await page.goto(preview.url);
    assert.equal(
      await page.locator("img").evaluate((img) => img.naturalWidth),
      100,
    );
    assert.match(
      await page.locator("img").getAttribute("src"),
      /^\.\/assets\//,
    );
  },
);

test(
  "migration restores contextual variables while retaining original responsive conditions and inheritance",
  { timeout: 45000 },
  async (t) => {
    const source = await fixture(t, (_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--spacing:24px}body{margin:0}#trigger + #hero{--accent:rgb(255,0,0)}
body:has(#trigger){--fluid:clamp(30px,10vw,100px)}
#hero{background:var(--accent,blue);padding:var(--spacing)}.box{width:var(--fluid);height:30px}
@media(max-width:600px){:root{--spacing:8px}#trigger + #hero{--accent:rgb(0,128,0)}}
</style><div id="trigger"></div><section id="hero"><div class="box"></div></section>`);
    });
    const out = path.join(source.directory, "out");
    const captured = await cli([
      "capture",
      ...common(source.url, "#hero", "800x600,375x812"),
      "--out",
      out,
    ]);
    assert.equal(captured.code, 0, captured.stdout + captured.stderr);
    const preview = await startStaticServer(out);
    t.after(preview.close);
    const browser = await browserFor(t);
    for (const width of [800, 600, 500, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      await page.goto(preview.url);
      const values = await page.locator("#hero").evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        padding: getComputedStyle(el).paddingTop,
        width: getComputedStyle(el.querySelector(".box")).width,
      }));
      assert.deepEqual(values, {
        background: width <= 600 ? "rgb(0, 128, 0)" : "rgb(255, 0, 0)",
        padding: width <= 600 ? "8px" : "24px",
        width: `${width * 0.1}px`,
      });
      await page.close();
    }
    const validated = await cli([
      "validate",
      ...common(source.url, "#hero", "800x600,375x812"),
      "--dir",
      out,
    ]);
    assert.equal(validated.code, 0, validated.stdout + validated.stderr);
  },
);

test(
  "migration validates an existing prototype artifact without rewriting it",
  { timeout: 20000 },
  async (t) => {
    const html =
      '<!doctype html><html><head><style>body{margin:0}#hero{padding:20px}</style></head><body><section id="hero" data-effect-extractor-root="true">Artefato antigo</section></body></html>';
    const source = await fixture(t, (_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    await fs.writeFile(path.join(source.directory, "index.html"), html);
    const validated = await cli([
      "validate",
      ...common(source.url, "#hero"),
      "--dir",
      source.directory,
    ]);
    assert.equal(validated.code, 0, validated.stdout + validated.stderr);
    assert.equal(
      await fs.readFile(path.join(source.directory, "index.html"), "utf8"),
      html,
    );
  },
);

test("migration preview serves WebAssembly and uppercase script extensions correctly", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uiport-mime-"));
  await fs.writeFile(
    path.join(dir, "module.WASM"),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  );
  await fs.writeFile(path.join(dir, "APP.JS"), "window.example=1");
  const server = await startStaticServer(dir);
  t.after(async () => {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const response = await fetch(`${server.url}/module.WASM`);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  await globalThis.WebAssembly.compileStreaming(response);
  assert.equal(
    (await fetch(`${server.url}/APP.JS`)).headers.get("content-type"),
    "text/javascript",
  );
});
