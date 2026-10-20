// A tiny element builder. Text is always set with textContent, never parsed as HTML.

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...(Node | string | number | null | undefined | false)[]} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(typeof child === "object" ? /** @type {Node} */ (child) : document.createTextNode(String(child)));
  }
  return el;
}
