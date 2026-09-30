import postcss from "postcss";
import { randomUUID } from "node:crypto";

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
        // Browser-specific selectors may not be queryable.
      }
    }
  }
  return result;
}

// CSS nesting uses the maximum specificity of the parent's selector list.
// Expand nesting tokens only outside strings/attributes and preserve escapes.
function resolveSelector(selector, parent) {
  let result = "",
    quote = "",
    brackets = 0,
    nested = false;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "\\") {
      result += char + (selector[++i] || "");
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "&" && brackets === 0) {
      result += parent;
      nested = true;
      continue;
    }
    result += char;
  }
  return nested ? result : `${parent} ${result}`;
}
function selectorsFor(rule) {
  let parent = rule.parent;
  while (parent && parent.type !== "rule") parent = parent.parent;
  if (!parent) return rule.selectors;
  const context = `:is(${selectorsFor(parent).join(", ")})`;
  return rule.selectors.map((selector) => resolveSelector(selector, context));
}

export function contextualCss(stylesheets) {
  const roots = stylesheets.map((text) => postcss.parse(text));
  const rules = [];
  const descriptors = [];
  function visit(container, owner) {
    if (container.type === "rule") owner = container;
    let declarations = [];
    const flush = () => {
      if (owner && declarations.length) {
        const id = rules.length;
        rules.push({ container, declarations });
        descriptors.push({ id, selectors: selectorsFor(owner) });
      }
      declarations = [];
    };
    // Preserve declaration order around nested rules. A conditional at-rule
    // may contain declarations applying implicitly to its enclosing selector.
    for (const node of container.nodes || []) {
      if (node.type === "decl" && node.prop.startsWith("--"))
        declarations.push(node);
      else if (node.nodes) {
        flush();
        visit(node, owner);
      }
    }
    flush();
  }
  for (const root of roots) visit(root, null);
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
      const anchorFor = (container) => {
        let anchor = container;
        for (let parent = container.parent; parent; parent = parent.parent)
          if (parent.type === "rule") anchor = parent;
        return anchor;
      };
      const affected = new Set(
        [...missing.values()].map((item) =>
          anchorFor(rules[item.rule].container),
        ),
      );
      const tails = new Map();
      // Replay every custom declaration of an affected style block, including
      // selectors that still match. Otherwise hoisting only a missing selector
      // would incorrectly override a later nested rule of equal specificity.
      for (const [
        id,
        { container: original, declarations },
      ] of rules.entries()) {
        const anchor = anchorFor(original);
        if (!affected.has(anchor)) continue;
        const selectors = descriptors[id].selectors.map((selector) => {
          const elements = [...missing.values()].filter(
            (item) => item.rule === id && item.selector === selector,
          );
          return elements.length
            ? `:is(${selector}, :where(${elements.map((item) => `[data-uiport-id="${item.id}"]`).join(", ")}))`
            : selector;
        });
        let fallback = postcss.rule({ selector: selectors.join(", ") });
        for (const node of declarations) fallback.append(node.clone());
        // Keep conditional/group rules while removing style ancestors already
        // represented in the resolved selectors.
        for (
          let parent = original.type === "atrule" ? original : original.parent;
          parent && parent !== anchor.parent;
          parent = parent.parent
        )
          if (parent.type === "atrule") {
            // Reopening an anonymous layer would create a different, later
            // layer. Give this original layer a shared private identity first.
            if (parent.name.toLowerCase() === "layer" && !parent.params.trim())
              parent.params = `uiport-context-${randomUUID()}`;
            const wrapper = parent.clone({ nodes: [] });
            wrapper.append(fallback);
            fallback = wrapper;
          }
        const tail = tails.get(anchor) || anchor;
        tail.after(fallback);
        tails.set(anchor, fallback);
      }
      return roots.map((root) => root.toString());
    },
  };
}
