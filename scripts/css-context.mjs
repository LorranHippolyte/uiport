import postcss from "postcss";

// Inspect only selector context. No stylesheet or script is executed in this
// detached document. Keep original declarations, specificity and enclosing
// media/supports/container/layer rules rather than freezing computed values.
function missingSelectors({ snapshot, rules }) {
  const copy = document.implementation.createHTMLDocument("");
  for (const { name, value } of snapshot.htmlAttributes)
    copy.documentElement.setAttribute(name, value);
  for (const { name, value } of snapshot.bodyAttributes)
    copy.body.setAttribute(name, value);
  let container = copy.body;
  for (const ancestor of snapshot.ancestors) {
    const el = copy.createElement(ancestor.tag);
    for (const { name, value } of ancestor.attributes)
      el.setAttribute(name, value);
    container.append(el);
    container = el;
  }
  container.innerHTML = snapshot.html;
  const clones = new Map(
    [...copy.querySelectorAll("[data-uiport-id]")].map((element) => [
      element.getAttribute("data-uiport-id"),
      element,
    ]),
  );
  const result = [];
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          const id = element.getAttribute("data-uiport-id");
          const cloned = clones.get(id);
          if (cloned && !cloned.matches(selector))
            result.push({ rule: rule.id, selector, id });
        }
      } catch {
        // Relative/nested selectors are not independently matchable here.
      }
    }
  }
  return result;
}

export function contextualCss(stylesheets) {
  const roots = stylesheets.map((text) => postcss.parse(text));
  const rules = [];
  const descriptors = [];
  for (const root of roots)
    root.walkRules((rule) => {
      if (!rule.nodes.some((n) => n.type === "decl" && n.prop.startsWith("--")))
        return;
      const id = rules.length;
      rules.push(rule);
      descriptors.push({ id, selectors: rule.selectors });
    });
  const missing = new Map();
  return {
    async observe(page, snapshot) {
      const result = await page.evaluate(missingSelectors, {
        snapshot,
        rules: descriptors,
      });
      for (const item of result)
        missing.set(`${item.rule}|${item.selector}|${item.id}`, item);
    },
    render() {
      for (const { rule: id, selector, id: element } of missing.values()) {
        const original = rules[id];
        const fallback = original.clone({
          selector: `:is(${selector}, :where([data-uiport-id="${element}"]))`,
        });
        for (const node of [...fallback.nodes])
          if (node.type !== "decl" || !node.prop.startsWith("--"))
            node.remove();
        original.after(fallback);
      }
      return roots.map((root) => root.toString());
    },
  };
}
