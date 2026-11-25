import { renderBackdrop } from "./backdrop.js";
import { World, Vec2, Box, Circle } from "./physics.js";

const field = document.querySelector("#field");
const scene = document.querySelector("#bodies");
const aim = document.querySelector("#aim");
const ballNode = document.querySelector("#ball");
const band = document.querySelector("#band");
const ammo = document.querySelector("#ammo");
const result = document.querySelector("#result");
const version = new URLSearchParams(location.search).get("demo");
const original = version === "before";
const origin = { x: 4.3, y: 7.9 };
const floor = 10.2;
const gravity = 14;
const radius = 0.46;
const maxShots = 4;
const towerPositions = [17, 21, 25];
const timestep = 1 / 120;
const stepsPerShot = 300;
let world, shapes, targets, ball, steps, shots, request;
let angle = 28, power = 16, drag = null, accumulator = 0, lastTime = 0;

function svg(tag, attributes, parent) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent.appendChild(element);
  return element;
}

const trajectory = Array.from({length: 12}, (_, i) =>
  svg("circle", { r: 0.050 - i * 0.002, opacity: 1 - i * 0.048 }, aim));

const rounds = Array.from({ length: maxShots }, () => ammo.appendChild(document.createElement("i")));
function updateAmmo() {
  const remaining = maxShots - shots;
  rounds.forEach((round, i) => round.classList.toggle("spent", i >= remaining));
  ammo.setAttribute("aria-label", remaining + " shots remaining");
}
function addBox(x, y, width, height, kind) {
  const body = world.createDynamicBody({ position: Vec2(x, y) });
  body.createFixture(Box(width / 2, height / 2), {
    density: kind === "target" ? 0.65 : 0.85, friction: 0.58, restitution: 0.07,
  });
  const node = svg("g", {}, scene);
  svg("rect", { class: kind, x: -width/2, y: -height/2, width, height, rx: .032 }, node);
  if (kind === "target") {
    svg("path", { class: "target-core", d: "M0-.18.18 0 0 .18-.18 0Z" }, node);
  } else {
    const x = -width/2 + .06, y = -height/2 + .06;
    svg("path", { class: "block-edge", d: "M" + x + " " + (height/2 - .07) + "V" + y + "H" + (width/2 - .06) }, node);
  }
  const shape = { body, node, startX: x, startY: y, cleared: false };
  shapes.push(shape);
  return shape;
}

function reset() {
  cancelAnimationFrame(request);
  world = new World(Vec2(0, gravity), { original });
  scene.replaceChildren();
  shapes = []; targets = []; shots = 0; steps = 0; ball = null; drag = null;
  angle = 28; power = 16;
  delete document.body.dataset.dragging;
  window.shotResult = null;
  const terrain = world.createTerrain({ left: 0, right: 30, top: floor, bottom: 12 });
  const tiles = document.querySelector("#terrain-tiles");
  tiles.setAttribute("x", terrain.left);
  tiles.setAttribute("y", terrain.top);
  tiles.setAttribute("width", terrain.tileWidth);
  tiles.setAttribute("height", terrain.tileHeight);
  document.querySelector("#tile-outline").setAttribute("d", "M0 " + terrain.tileHeight + "V0H" + terrain.tileWidth);
  for (const x of towerPositions) {
    const postHeight = 2.05;
    for (const offset of [-0.85, 0.85]) {
      addBox(x + offset, floor - postHeight / 2, 0.42, postHeight, "block");
    }
    addBox(x, floor - postHeight - 0.19, 2.65, 0.38, "block");
    targets.push(addBox(x, floor - postHeight - 0.38 - 0.40, 0.80, 0.80, "target"));
  }
  world.settle(90,timestep);
  document.body.dataset.state = "ready";
  result.textContent = "";
  updateAmmo();
  draw();
}

function velocity() {
  const radians = angle * Math.PI / 180;
  return Vec2(power * Math.cos(radians), -power * Math.sin(radians));
}
function draw() {
  renderBackdrop(field);
  for (const {body, node} of shapes) {
    const p = body.getPosition();
    node.setAttribute("transform", "translate(" + p.x + " " + p.y + ") rotate(" + body.getAngle() * 180 / Math.PI + ")");
  }
  const flying = document.body.dataset.state === "flying";
  const pos = flying ? ball.getPosition() : drag?.point ?? origin;
  ballNode.setAttribute("transform", "translate(" + pos.x + " " + pos.y + ")");
  band.setAttribute("d", "M3.81 7.72L" + (flying ? "4.3 7.72" : pos.x + " " + pos.y) + "L4.78 7.72");
  if (!flying && document.body.dataset.state === "ready") {
    aim.removeAttribute("display");
    const v = velocity();
    trajectory.forEach((dot, i) => {
      const t = (i + 1) * 0.065;
      dot.setAttribute("cx", origin.x + v.x * t);
      dot.setAttribute("cy", origin.y + v.y * t + gravity * t * t / 2);
    });
  } else {
    aim.setAttribute("display", "none");
  }
}
function measure(name, start) {
  performance.measure(name, { start, end: performance.now(), detail: {
    devtools: { track: "Slingshot", trackGroup: "Game" },
  } });
  performance.clearMeasures(name);
}

function step() {
  world.step(timestep);
  steps++;
  for (const target of targets) {
    if (target.cleared) continue;
    const p = target.body.getPosition();
    if (Math.abs(p.x - target.startX) > 0.8 || p.y > target.startY + 0.7) {
      target.cleared = true;
      target.node.classList.add("cleared");
    }
  }
}

function finish() {
  const position = body => {
    const {x,y} = body.getPosition();
    return { x, y };
  };
  const remainingTargets = targets.filter(t => !t.cleared).length;
  window.shotResult = { steps, remainingTargets, projectile: position(ball),
    targets: targets.map(t => ({ ...position(t.body), cleared: t.cleared })) };
  const state = !remainingTargets ? "won" : shots === maxShots ? "lost" : "ready";
  document.body.dataset.state = state;
  result.textContent = state === "won" ? "Cleared!" : state === "lost" ? "Out of shots" : "";
  draw();
}

function tick(now) {
  const frameStart = performance.now();
  accumulator += Math.max(0, now - lastTime) / 1000;
  lastTime = Math.max(lastTime, now);
  // Retain the elapsed-time backlog across slow renders. Bound each batch so a
  // resumed tab can still accept input between physics updates.
  const count = Math.min(Math.floor(accumulator / timestep), 12, stepsPerShot - steps);
  for (let i = 0; i < count; i++) {
    step();
    accumulator -= timestep;
    if (performance.now() - frameStart >= 50) break;
  }
  measure("Physics step", frameStart);
  draw();
  measure("Game frame", frameStart);
  if (steps === stepsPerShot) finish();
  else request = requestAnimationFrame(tick);
}

function launch() {
  if (document.body.dataset.state !== "ready") return;
  drag = null;
  delete document.body.dataset.dragging;
  if (ball) world.destroyBody(ball);
  ball = world.createDynamicBody({ position: Vec2(origin.x, origin.y), bullet: true });
  ball.createFixture(Circle(radius), { density: 5.5, friction: 0.65, restitution: 0.28 });
  ball.setLinearVelocity(velocity());
  steps = 0; shots++; accumulator = 0;
  window.shotResult = null;
  updateAmmo();
  document.body.dataset.state = "flying";
  lastTime = performance.now();
  request = requestAnimationFrame(tick);
}

function worldPoint(event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(field.getScreenCTM().inverse());
  return { x: p.x / 36, y: p.y / 36 };
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function pull(event) {
  if (drag?.id !== event.pointerId) return;
  const p = worldPoint(event);
  const x = origin.x - p.x, y = p.y - origin.y;
  angle = Math.round(clamp(Math.atan2(y, x) * 180 / Math.PI, 8, 70));
  power = Math.round(clamp(Math.hypot(x,y) * 7, 8, 24) * 4) / 4;
  const v = velocity();
  drag.point = { x: origin.x - v.x / 7, y: origin.y - v.y / 7 };
  draw();
}
function cancelPull() {
  drag = null;
  delete document.body.dataset.dragging;
  draw();
}
function finished() {
  return document.body.dataset.state === "won" || document.body.dataset.state === "lost";
}
field.addEventListener("pointerdown", event => {
  if (document.body.dataset.state === "flying" || drag || event.button !== 0) return;
  const p = worldPoint(event);
  const grabRadius = Math.max(1.3, 20 * 30 / field.clientWidth);
  if (Math.hypot(p.x - origin.x, p.y - origin.y) > grabRadius) return;
  if (finished()) reset();
  drag = { id: event.pointerId, point: origin };
  document.body.dataset.dragging = "";
  field.setPointerCapture(event.pointerId);
});
field.addEventListener("pointermove", pull);
field.addEventListener("pointerup", event => {
  if (drag?.id !== event.pointerId) return;
  if (worldPoint(event).x < origin.x - 0.25) { pull(event); launch(); }
  else cancelPull();
});
field.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) cancelPull(); });
field.addEventListener("lostpointercapture", event => { if (drag?.id === event.pointerId) cancelPull(); });
field.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() === "r") { reset(); return; }
  if (!["ArrowLeft","ArrowRight","ArrowDown","ArrowUp"," "].includes(event.key)) return;
  event.preventDefault();
  if (document.body.dataset.state === "flying" || drag) return;
  if (finished()) reset();
  if (event.key === " ") { if (!event.repeat) launch(); return; }
  if (event.key === "ArrowUp") angle = clamp(angle + 1, 8, 70);
  if (event.key === "ArrowDown") angle = clamp(angle - 1, 8, 70);
  if (event.key === "ArrowRight") power = clamp(power + .5, 8, 24);
  if (event.key === "ArrowLeft") power = clamp(power - .5, 8, 24);
  draw();
});

document.querySelector("#restart").addEventListener("click", () => {
  reset();
  field.focus({ preventScroll: true });
});

if (window.frameElement && version) {
  document.documentElement.classList.add("embedded");
  const frame = window.frameElement;
  const main = document.querySelector("main");
  new ResizeObserver(() => { frame.style.height = Math.ceil(main.getBoundingClientRect().height) + "px"; }).observe(main);
}
reset();
