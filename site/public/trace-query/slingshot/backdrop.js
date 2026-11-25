export function renderBackdrop(svg) {
  if (svg.querySelector("#grid-background")) return;
  const ns = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(ns, "g");
  group.id = "grid-background";
  group.setAttribute("aria-hidden", "true");
  group.innerHTML = '<defs><pattern id="grid-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1" fill="#b6c5ba"/></pattern></defs><rect width="100%" height="100%" fill="#eaf0e8"/><rect width="100%" height="100%" fill="url(#grid-dots)"/>';
  svg.prepend(group);
}
