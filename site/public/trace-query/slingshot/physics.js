export const Vec2 = (x, y) => ({ x, y });
export const Box = (halfWidth, halfHeight) => ({ halfWidth, halfHeight });
export const Circle = radius => ({ radius });

class Body {
  constructor({ position, angle = 0 }) {
    this.position = { ...position };
    this.angle = angle;
    this.vx = this.vy = this.spin = 0;
  }

  createFixture(shape, { density = 1, friction = 0.5, restitution = 0 } = {}) {
    this.shape = shape;
    this.friction = friction;
    this.restitution = restitution;
    const { halfWidth: w, halfHeight: h, radius: r } = shape;
    const mass = density * (r ? Math.PI * r * r : 4 * w * h);
    this.invMass = 1 / mass;
    this.invInertia = 1 / (mass * (r ? r * r / 2 : (w * w + h * h) / 3));
    this.updateBounds();
  }

  updateBounds() {
    const { halfWidth: w, halfHeight: h, radius: r } = this.shape;
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
    const dx = r || Math.abs(this.c) * w + Math.abs(this.s) * h;
    const dy = r || Math.abs(this.s) * w + Math.abs(this.c) * h;
    this.left = this.position.x - dx;
    this.right = this.position.x + dx;
    this.top = this.position.y - dy;
    this.bottom = this.position.y + dy;
  }

  getPosition() { return this.position; }
  getAngle() { return this.angle; }
  setLinearVelocity({ x, y }) { this.vx = x; this.vy = y; }
}

function extent(body, x, y) {
  const { halfWidth: w, halfHeight: h, radius } = body.shape;
  return radius || Math.abs(x * body.c + y * body.s) * w + Math.abs(y * body.c - x * body.s) * h;
}

// Return the tangent interval of a supporting vertex or face along a collision normal.
function support(body, nx, ny, side) {
  const center = -ny * body.position.x + nx * body.position.y;
  if (body.shape.radius) return [center, center];
  let lo = center, hi = center;
  for (const [x, y, length] of [[body.c, body.s, body.shape.halfWidth], [-body.s, body.c, body.shape.halfHeight]]) {
    const normal = nx * x + ny * y;
    const tangent = (-ny * x + nx * y) * length;
    if (Math.abs(normal) < 0.025) { lo -= Math.abs(tangent); hi += Math.abs(tangent); }
    else { const offset = side * Math.sign(normal) * tangent; lo += offset; hi += offset; }
  }
  return [lo, hi];
}

function collision(a, b) {
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const axes = [];
  for (const body of [a, b]) {
    if (!body.shape.radius) axes.push([body.c, body.s], [-body.s, body.c]);
  }
  if (a.shape.radius || b.shape.radius) {
    let x = dx, y = dy;
    if (!a.shape.radius || !b.shape.radius) {
      const box = a.shape.radius ? b : a;
      const circle = a.shape.radius ? a : b;
      const rx = circle.position.x - box.position.x, ry = circle.position.y - box.position.y;
      const { halfWidth: w, halfHeight: h } = box.shape;
      const u = Math.max(-w, Math.min(w, rx * box.c + ry * box.s));
      const v = Math.max(-h, Math.min(h, ry * box.c - rx * box.s));
      x = rx - (u * box.c - v * box.s);
      y = ry - (u * box.s + v * box.c);
    }
    const len = Math.hypot(x, y);
    if (len > 1e-8) axes.push([x / len, y / len]);
    else if (!axes.length) axes.push([1, 0]);
  }

  let depth = Infinity, nx, ny;
  for (const [x, y] of axes) {
    const d = dx * x + dy * y;
    const overlap = extent(a, x, y) + extent(b, x, y) - Math.abs(d);
    if (overlap <= 0) return;
    if (overlap < depth) {
      depth = overlap;
      nx = d < 0 ? -x : x;
      ny = d < 0 ? -y : y;
    }
  }

  const [a0, a1] = support(a, nx, ny, 1), [b0, b1] = support(b, nx, ny, -1);
  const tangent = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
  const normal = a.position.x * nx + a.position.y * ny + extent(a, nx, ny) - depth / 2;
  return { a, b, nx, ny, depth, x: nx * normal - ny * tangent, y: ny * normal + nx * tangent };
}

function resolve({ a, b, nx, ny, x, y }) {
  const ax = x - a.position.x, ay = y - a.position.y;
  const bx = b ? x - b.position.x : 0, by = b ? y - b.position.y : 0;
  const invMass = a.invMass + (b?.invMass || 0);
  function impulse(dx, dy, restitution, limit) {
    const ra = ax * dy - ay * dx, rb = bx * dy - by * dx;
    const v = ((b?.vx || 0) - a.vx) * dx + ((b?.vy || 0) - a.vy) * dy + (b?.spin || 0) * rb - a.spin * ra;
    const mass = invMass + ra * ra * a.invInertia + rb * rb * (b?.invInertia || 0);
    const j = Math.max(limit === Infinity ? 0 : -limit, Math.min(limit, -(1 + restitution) * v / mass));
    a.vx -= dx * j * a.invMass; a.vy -= dy * j * a.invMass; a.spin -= ra * j * a.invInertia;
    if (b) { b.vx += dx * j * b.invMass; b.vy += dy * j * b.invMass; b.spin += rb * j * b.invInertia; }
    return j;
  }
  const normal = impulse(nx, ny, a.restitution, Infinity);
  impulse(-ny, nx, 0, normal * a.friction);
}

function overlaps(a, b) {
  return a.right >= b.left && b.right >= a.left && a.bottom >= b.top && b.bottom >= a.top;
}

// The original implementation searches every pair, including immovable terrain tiles.
function findCollisionPairsNaively(terrain, bodies, grounded, pairs) {
  const colliders = terrain.concat(bodies);
  for (let i = 0; i < colliders.length; i++) {
    const a = colliders[i];
    for (let j = i + 1; j < colliders.length; j++) {
      const b = colliders[j];
      if (!overlaps(a, b) || j < terrain.length) continue;
      if (i < terrain.length) grounded.add(b);
      else pairs.push([a, b]);
    }
  }
}

export class World {
  constructor(gravity, { original = false } = {}) {
    this.gravity = gravity;
    this.original = original;
    this.bodies = [];
    this.tiles = [];
  }

  createTerrain({ left, right, top, bottom }) {
    const columns = 256, rows = 16;
    const tileWidth = (right - left) / columns, tileHeight = (bottom - top) / rows;
    this.terrain = { left, right, top, bottom, columns, rows, tileWidth, tileHeight };
    this.tiles = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        this.tiles.push({ left: left + col * tileWidth, right: left + (col + 1) * tileWidth,
          top: top + row * tileHeight, bottom: top + (row + 1) * tileHeight });
      }
    }
    return this.terrain;
  }

  createDynamicBody(options) {
    const body = new Body(options);
    this.bodies.push(body);
    return body;
  }

  destroyBody(body) {
    const index = this.bodies.indexOf(body);
    if (index !== -1) this.bodies.splice(index, 1);
  }

  terrainTileAt(x, y) {
    const { left, top, tileWidth, tileHeight, columns, rows } = this.terrain;
    const col = Math.max(0, Math.min(columns - 1, Math.floor((x - left) / tileWidth)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((y - top) / tileHeight)));
    return this.tiles[row * columns + col];
  }

  findIndexedPairs(grounded, pairs) {
    for (const [i, body] of this.bodies.entries()) {
      if (this.terrain && overlaps(body, this.terrain)) {
        const tile = this.terrainTileAt(body.left, body.top);
        if (overlaps(body, tile)) grounded.add(body);
      }
      for (let j = i + 1; j < this.bodies.length; j++) {
        if (overlaps(body, this.bodies[j])) pairs.push([body, this.bodies[j]]);
      }
    }
  }

  settle(steps, dt) {
    for (let i = 0; i < steps; i++) this.step(dt, false);
  }

  step(dt, original = this.original) {
    for (const body of this.bodies) {
      body.vx += this.gravity.x * dt;
      body.vy += this.gravity.y * dt;
      body.position.x += body.vx * dt;
      body.position.y += body.vy * dt;
      body.angle += body.spin * dt;
      body.updateBounds();
    }
    const grounded = new Set(), pairs = [], contacts = [];
    if (original) findCollisionPairsNaively(this.tiles, this.bodies, grounded, pairs);
    else this.findIndexedPairs(grounded, pairs);

    // Weld adjacent tile surfaces so a rolling body never catches an internal seam.
    for (const a of this.bodies) {
      if (!grounded.has(a)) continue;
      const [lo, hi] = support(a, 0, 1, 1);
      contacts.push({ a, nx: 0, ny: 1, x: -(lo + hi) / 2, y: this.terrain.top, depth: a.bottom - this.terrain.top });
    }
    for (const [a, b] of pairs) {
      const contact = collision(a, b);
      if (contact) contacts.push(contact);
    }
    for (const { a, b, nx, ny, depth } of contacts) {
      const correction = Math.max(0, depth - 0.002) * 0.65 / (a.invMass + (b?.invMass || 0));
      a.position.x -= nx * correction * a.invMass; a.position.y -= ny * correction * a.invMass;
      if (b) { b.position.x += nx * correction * b.invMass; b.position.y += ny * correction * b.invMass; }
    }
    for (let i = 0; i < 8; i++) for (const contact of contacts) resolve(contact);
  }
}
