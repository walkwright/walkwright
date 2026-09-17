export function hideStyle(selectors: string[]): string | undefined {
  if (selectors.length === 0) {
    return undefined;
  }

  const css = selectors
    .map((selector) => `${selector}{display:none;}`)
    .join("");

  return `document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(css)};
  document.head.append(style);
});`;
}
