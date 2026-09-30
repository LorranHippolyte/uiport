// Runs inside the source browser. No Node state is captured by this function.
export function extractSection({
  selector: targetSelector,
  omitScripts = false,
}) {
  const target = document.querySelector(targetSelector);
  if (!target) throw new Error("Target disappeared before capture.");
  if (
    [
      "HEAD",
      "SCRIPT",
      "STYLE",
      "LINK",
      "META",
      "BASE",
      "IFRAME",
      "OBJECT",
      "EMBED",
    ].includes(target.tagName)
  )
    throw new Error("Select a section container such as main, section or div.");
  let removedExecutable = 0;
  let canvasFailures = 0;
  // Ignore control characters when checking executable URL schemes.
  const unsafe = (value) =>
    /^(javascript:|vbscript:|data:)/i.test(
      // eslint-disable-next-line no-control-regex
      value.replace(/[\u0000-\u0020]/g, ""),
    );
  const clean = (element) => {
    for (const attr of [...element.attributes]) {
      if (
        (omitScripts && /^on/i.test(attr.name)) ||
        ["srcdoc", "autofocus", "ping"].includes(attr.name) ||
        (["href", "xlink:href", "action", "formaction"].includes(attr.name) &&
          omitScripts &&
          unsafe(attr.value))
      ) {
        element.removeAttribute(attr.name);
        removedExecutable++;
      }
    }
    if (element.tagName === "FORM") element.setAttribute("action", "#");
    if (element.hasAttribute("formaction"))
      element.setAttribute("formaction", "#");
    if (["IFRAME", "OBJECT", "EMBED"].includes(element.tagName)) {
      element.removeAttribute("src");
      element.removeAttribute("data");
      element.setAttribute("sandbox", "");
    }
    return element;
  };

  const deepElements = [];
  const visit = (element) => {
    if (!(element instanceof Element)) return;
    deepElements.push(element);
    if (element.shadowRoot)
      for (const child of element.shadowRoot.children) visit(child);
    for (const child of element.children) visit(child);
  };
  visit(target);
  deepElements.forEach((element, index) =>
    element.setAttribute("data-uiport-id", `up-${index}`),
  );
  target.setAttribute("data-uiport-root", "true");
  let parent = target.parentElement;
  let ancestorId = 0;
  while (parent) {
    parent.setAttribute("data-uiport-id", `up-ancestor-${ancestorId++}`);
    parent = parent.parentElement;
  }
  let preservedScripts = 0;

  const absoluteUrl = (value, base = document.baseURI) => {
    if (
      !value ||
      /^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(value.trim())
    )
      return value;
    try {
      return new URL(value, base).href;
    } catch {
      return value;
    }
  };
  const absolutizeCssUrls = (cssText, base) =>
    String(cssText || "").replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (full, quote, raw) => {
        const value = raw.trim();
        if (/^(data:|blob:|#)/i.test(value)) return full;
        return `url("${absoluteUrl(value, base)}")`;
      },
    );

  const cloneDeep = (source) => {
    if (!(source instanceof Element)) return source.cloneNode(true);
    if (
      ["BASE", "META", "LINK"].includes(source.tagName.toUpperCase()) ||
      (omitScripts && source.tagName.toUpperCase() === "SCRIPT")
    ) {
      removedExecutable++;
      return document.createTextNode("");
    }
    if (source.tagName.toUpperCase() === "SCRIPT") preservedScripts++;
    const clone = clean(source.cloneNode(false));
    for (const name of [
      "src",
      "href",
      "xlink:href",
      "poster",
      "data-src",
      "data-background-image",
    ]) {
      if (clone.hasAttribute(name))
        clone.setAttribute(
          name,
          absoluteUrl(clone.getAttribute(name), source.baseURI),
        );
    }
    if (source.hasAttribute("style"))
      clone.setAttribute(
        "style",
        absolutizeCssUrls(source.getAttribute("style"), source.baseURI),
      );
    if (source instanceof HTMLImageElement && source.currentSrc)
      clone.setAttribute("src", source.currentSrc);
    if (source instanceof HTMLInputElement) {
      clone.setAttribute(
        "value",
        ["password", "hidden"].includes(source.type) ? "" : source.value,
      );
      if (source.checked) clone.setAttribute("checked", "");
      else clone.removeAttribute("checked");
    }
    if (source instanceof HTMLTextAreaElement) {
      clone.textContent = source.value;
      return clone;
    }
    if (source instanceof HTMLOptionElement) {
      if (source.selected) clone.setAttribute("selected", "");
      else clone.removeAttribute("selected");
    }
    if (source instanceof HTMLCanvasElement) {
      try {
        const image = document.createElement("img");
        for (const attribute of clone.attributes)
          image.setAttribute(attribute.name, attribute.value);
        image.setAttribute("src", source.toDataURL("image/png"));
        image.setAttribute("data-extracted-canvas-frame", "true");
        image.width = source.width;
        image.height = source.height;
        return image;
      } catch {
        canvasFailures++;
      }
    }
    if (source.tagName === "STYLE") {
      clone.textContent = absolutizeCssUrls(source.textContent, source.baseURI);
      return clone;
    }
    if (source.shadowRoot) {
      const template = document.createElement("template");
      template.setAttribute("shadowrootmode", "open");
      for (const sheet of source.shadowRoot.adoptedStyleSheets || []) {
        try {
          const style = document.createElement("style");
          style.textContent = [...sheet.cssRules]
            .map((rule) => rule.cssText)
            .join("\n");
          template.content.append(style);
        } catch {}
      }
      for (const child of source.shadowRoot.childNodes)
        template.content.append(cloneDeep(child));
      clone.append(template);
    }
    if (source.tagName === "TEMPLATE") {
      for (const child of source.content.childNodes)
        clone.content.append(cloneDeep(child));
    } else
      for (const child of source.childNodes) clone.append(cloneDeep(child));
    return clone;
  };

  const attributesOf = (element) =>
    [...clean(element.cloneNode(false)).attributes].map((attribute) => ({
      name: attribute.name,
      value: attribute.value,
    }));

  const ancestors = [];
  let ancestor = target.parentElement;
  while (
    ancestor &&
    ancestor !== document.body &&
    ancestor !== document.documentElement
  ) {
    ancestors.unshift({
      tag: ancestor.tagName.toLowerCase(),
      attributes: attributesOf(ancestor),
    });
    ancestor = ancestor.parentElement;
  }

  const references = [];
  const referenceKeys = new Set();
  const addReference = (kind, value, ownerId, base = document.baseURI) => {
    if (!value || /^(data:|#|javascript:|mailto:|tel:)/i.test(value.trim()))
      return;
    const url = absoluteUrl(value, base);
    const key = `${kind}|${url}`;
    if (!referenceKeys.has(key)) {
      referenceKeys.add(key);
      references.push({ kind, url, ownerId });
    }
  };
  const urlsFromCss = (kind, value, ownerId) => {
    for (const match of String(value || "").matchAll(
      /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    ))
      addReference(kind, match[1], ownerId);
  };

  const usedFontFamilies = new Set();
  for (const element of deepElements) {
    const ownerId = element.getAttribute("data-uiport-id");
    if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(element.tagName))
      continue;
    if (element.hasAttribute("srcset")) {
      const srcset = element.getAttribute("srcset");
      if (!srcset.trim().startsWith("data:"))
        for (const candidate of srcset.split(","))
          addReference(
            "srcset",
            candidate.trim().split(/\s+/)[0],
            ownerId,
            element.baseURI,
          );
    }
    for (const attribute of [
      "src",
      "poster",
      "data-src",
      "data-background-image",
    ])
      addReference(
        attribute,
        element.getAttribute(attribute),
        ownerId,
        element.baseURI,
      );
    if (element instanceof HTMLImageElement && element.currentSrc)
      addReference("currentSrc", element.currentSrc, ownerId);
    if (element instanceof SVGUseElement)
      addReference(
        "svg-use",
        element.getAttribute("href") || element.getAttribute("xlink:href"),
        ownerId,
        element.baseURI,
      );
    const style = getComputedStyle(element);
    usedFontFamilies.add(style.fontFamily);
    for (const property of [
      "background-image",
      "mask-image",
      "border-image-source",
      "list-style-image",
      "cursor",
    ]) {
      urlsFromCss(property, style.getPropertyValue(property), ownerId);
    }
    for (const pseudoName of ["::before", "::after", "::marker"]) {
      const pseudo = getComputedStyle(element, pseudoName);
      for (const property of ["background-image", "mask-image", "content"]) {
        urlsFromCss(
          `${pseudoName}:${property}`,
          pseudo.getPropertyValue(property),
          ownerId,
        );
      }
    }
  }

  const stylesheets = [
    ...document.styleSheets,
    ...document.adoptedStyleSheets,
  ].map((sheet, order) => {
    const owner = sheet.ownerNode;
    let text = null;
    try {
      text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    } catch {
      if (!sheet.href && owner?.tagName === "STYLE") text = owner.textContent;
    }
    return {
      order,
      href: sheet.href || null,
      baseUrl: sheet.href || owner?.baseURI || document.baseURI,
      media: sheet.media?.mediaText || "",
      disabled: sheet.disabled,
      text,
    };
  });

  const customProperties = {};
  const rootStyle = getComputedStyle(target);
  for (const property of rootStyle) {
    if (property.startsWith("--"))
      customProperties[property] = rootStyle.getPropertyValue(property);
  }

  const animations = [];
  const seen = new Set();
  for (const element of deepElements) {
    for (const animation of element.getAnimations({ subtree: false })) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      let keyframes = null;
      let timing = null;
      try {
        keyframes = effect?.getKeyframes?.() || null;
      } catch {}
      try {
        timing = effect?.getTiming?.() || null;
        if (timing?.iterations === Infinity) timing.iterations = "Infinity";
      } catch {}
      animations.push({
        kind: animation.constructor?.name || "Animation",
        targetId: effect?.target?.getAttribute?.("data-uiport-id") || null,
        pseudoElement: effect?.pseudoElement || null,
        keyframes,
        timing,
        timeline: animation.timeline?.constructor?.name || null,
        currentTime:
          typeof animation.currentTime === "number"
            ? animation.currentTime
            : null,
        playbackRate: animation.playbackRate,
        playState: animation.playState,
      });
    }
  }

  const rootTag = target.tagName.toLowerCase();
  const wholeDocument = rootTag === "html";
  const fullPage = wholeDocument || rootTag === "body";
  const content = cloneDeep(fullPage ? document.body : target);
  const html = fullPage ? content.innerHTML : content.outerHTML;
  // A full-document selection also preserves original head scripts/data. CSS,
  // base URLs and the viewport are handled by the export's document builder.
  const headHtml = wholeDocument
    ? [...document.head.children]
        .filter((node) => ["SCRIPT", "NOSCRIPT"].includes(node.tagName))
        .map((node) => cloneDeep(node).outerHTML || "")
        .join("\n")
    : "";
  const visualLibraryPattern =
    /(gsap|scrolltrigger|lottie|aos(?:\.|-|\/)|swiper|splide|lenis|anime(?:\.min)?\.js|motion(?:\.min)?\.js|three(?:\.min)?\.js|pixi|webflow)/i;
  const runtimeScripts =
    omitScripts || wholeDocument
      ? []
      : [...document.scripts]
          .filter(
            (script) =>
              script.src &&
              !target.contains(script) &&
              visualLibraryPattern.test(script.src),
          )
          .map((script) => ({
            src: script.src,
            type: script.type || "",
            async: script.async,
            defer: script.defer,
            noModule: script.noModule,
          }));
  return {
    html,
    rootTag,
    headHtml,
    title: document.title,
    preservedScripts,
    runtimeScripts,
    structure: deepElements
      .map((el) => `${el.tagName}:${el.id}:${el.children.length}`)
      .join("|"),
    baseUrl: document.baseURI,
    sourceScripts: document.scripts.length,
    removedExecutable,
    canvasFailures,
    ancestors,
    htmlAttributes: attributesOf(document.documentElement).filter(
      (attribute) => attribute.name !== "lang",
    ),
    bodyAttributes: attributesOf(document.body),
    references,
    usedFontFamilies: [...usedFontFamilies],
    stylesheets,
    customProperties,
    animations,
    featureCounts: {
      elements: deepElements.length,
      canvas: deepElements.filter((el) => el.tagName === "CANVAS").length,
      iframe: deepElements.filter((el) =>
        ["IFRAME", "OBJECT", "EMBED"].includes(el.tagName),
      ).length,
      video: target.querySelectorAll("video").length,
    },
  };
}
