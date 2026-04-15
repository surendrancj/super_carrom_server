"use strict";
// ─── PhysicsSystem.ts ────────────────────────────────────────────────────────
// Direct port of PhysicsSystem.js — pure math, no Phaser dependency.
// Runs identically on server (Node.js) and client (browser/V8).
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhysicsSystem = void 0;
// ── Constants — must be kept in sync with client src/config/GameConfig.js ──────
const SCALE = 50; // px per metre — MUST match GameConfig.js SCALE
const PHYSICS = {
    coin: { density: 1.0, restitution: 0.85 },
    striker: { density: 1.0, restitution: 0.85 },
    wall: { restitution: 0.85 },
    deceleration: 10.0, // m/s²  — GameConfig.js PHYSICS.deceleration
    stopThreshold: 0.5, // m/s   — GameConfig.js PHYSICS.stopThreshold
};
class PhysicsSystem {
    constructor() {
        this._bodies = new Map();
        this._nextId = 1;
        this._walls = { left: 130, right: 670, top: 130, bottom: 670 };
    }
    setWalls(left, right, top, bottom) {
        this._walls = { left, right, top, bottom };
    }
    // ── Factory ───────────────────────────────────────────────────────────────
    _makeBody(x, y, radius, type) {
        const id = this._nextId++;
        this._bodies.set(id, { x, y, vx: 0, vy: 0, radius, type, restitution: PHYSICS.coin.restitution, mass: 1.0 });
        return id;
    }
    createDynamicCircle(x, y, radius) {
        const id = this._makeBody(x, y, radius, 'dynamic');
        const b = this._bodies.get(id);
        b.mass = PHYSICS.coin.density;
        b.restitution = PHYSICS.coin.restitution;
        return id;
    }
    createKinematicCircle(x, y, radius) {
        const id = this._makeBody(x, y, radius, 'kinematic');
        const b = this._bodies.get(id);
        b.mass = PHYSICS.striker.density;
        b.restitution = PHYSICS.striker.restitution;
        return id;
    }
    destroyBody(id) { this._bodies.delete(id); }
    // ── Manipulation ──────────────────────────────────────────────────────────
    setVelocity(id, vx, vy) {
        const b = this._bodies.get(id);
        if (b) {
            b.vx = vx * SCALE;
            b.vy = vy * SCALE;
        }
    }
    setPosition(id, x, y) {
        const b = this._bodies.get(id);
        if (b) {
            b.x = x;
            b.y = y;
        }
    }
    setBodyType(id, type) {
        const b = this._bodies.get(id);
        if (!b)
            return;
        b.type = type;
        if (type === 'dynamic') {
            b.mass = PHYSICS.striker.density;
            b.restitution = PHYSICS.striker.restitution;
        }
    }
    // ── Queries ───────────────────────────────────────────────────────────────
    getPosition(id) {
        const b = this._bodies.get(id);
        return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
    }
    getSpeed(id) {
        const b = this._bodies.get(id);
        if (!b)
            return 0;
        return Math.sqrt(b.vx * b.vx + b.vy * b.vy) / SCALE;
    }
    applyDeceleration(id, dt, rate = PHYSICS.deceleration) {
        const b = this._bodies.get(id);
        if (!b)
            return;
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed === 0)
            return;
        const reduction = rate * SCALE * dt;
        const newSpeed = Math.max(0, speed - reduction);
        b.vx *= newSpeed / speed;
        b.vy *= newSpeed / speed;
    }
    stopIfSlow(id, threshold = PHYSICS.stopThreshold) {
        const b = this._bodies.get(id);
        if (!b)
            return;
        if (this.getSpeed(id) < threshold) {
            b.vx = 0;
            b.vy = 0;
        }
    }
    allStopped(ids) {
        return ids.every(id => this.getSpeed(id) < PHYSICS.stopThreshold);
    }
    // ── Physics step ──────────────────────────────────────────────────────────
    step(dt) {
        const dynamic = [];
        for (const b of this._bodies.values()) {
            if (b.type === 'dynamic')
                dynamic.push(b);
        }
        if (dynamic.length === 0)
            return;
        // Phase 1: separate overlapping stationary bodies
        for (let pass = 0; pass < 8; pass++) {
            let anyOverlap = false;
            for (let i = 0; i < dynamic.length; i++)
                for (let j = i + 1; j < dynamic.length; j++)
                    if (this._separateOverlap(dynamic[i], dynamic[j]))
                        anyOverlap = true;
            if (!anyOverlap)
                break;
        }
        // Phase 2: CCD
        let remaining = dt;
        for (let iter = 0; iter < 32 && remaining > 1e-7; iter++) {
            let earliestT = remaining;
            let earliestType = null;
            let ccA = null, ccB = null;
            let wallBody = null, wallAxis = null;
            for (let i = 0; i < dynamic.length; i++) {
                for (let j = i + 1; j < dynamic.length; j++) {
                    const t = this._sweepCircles(dynamic[i], dynamic[j], remaining);
                    if (t !== null && t < earliestT - 1e-9) {
                        earliestT = t;
                        earliestType = 'cc';
                        ccA = dynamic[i];
                        ccB = dynamic[j];
                    }
                }
            }
            for (const b of dynamic) {
                const { t, axis } = this._sweepWall(b, remaining);
                if (t !== null && t < earliestT - 1e-9) {
                    earliestT = t;
                    earliestType = 'wall';
                    wallBody = b;
                    wallAxis = axis;
                }
            }
            if (earliestT < 1e-9)
                break;
            for (const b of dynamic) {
                b.x += b.vx * earliestT;
                b.y += b.vy * earliestT;
            }
            remaining -= earliestT;
            if (earliestType === 'cc')
                this._resolveCircles(ccA, ccB);
            if (earliestType === 'wall')
                this._resolveWall(wallBody, wallAxis);
            if (!earliestType)
                break;
        }
    }
    // ── CCD helpers ───────────────────────────────────────────────────────────
    _sweepCircles(a, b, maxT) {
        const dx = a.x - b.x, dy = a.y - b.y;
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const minDist = a.radius + b.radius;
        const A = dvx * dvx + dvy * dvy;
        if (A < 1e-10)
            return null;
        const B = 2 * (dx * dvx + dy * dvy);
        const C = dx * dx + dy * dy - minDist * minDist;
        const disc = B * B - 4 * A * C;
        if (disc < 0)
            return null;
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t < 0 || t > maxT)
            return null;
        if (C <= 0 && B >= 0)
            return null;
        return t;
    }
    _sweepWall(b, maxT) {
        const { left, right, top, bottom } = this._walls;
        let t = null, axis = null;
        const check = (candidate, candidateAxis) => {
            if (candidate >= 0 && candidate <= maxT) {
                if (t === null || candidate < t) {
                    t = candidate;
                    axis = candidateAxis;
                }
            }
        };
        if (b.vx < 0)
            check((left + b.radius - b.x) / b.vx, 'left');
        if (b.vx > 0)
            check((right - b.radius - b.x) / b.vx, 'right');
        if (b.vy < 0)
            check((top + b.radius - b.y) / b.vy, 'top');
        if (b.vy > 0)
            check((bottom - b.radius - b.y) / b.vy, 'bottom');
        return { t, axis };
    }
    _separateOverlap(a, b) {
        const MOVING = 5;
        if (Math.sqrt(a.vx * a.vx + a.vy * a.vy) > MOVING)
            return false;
        if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) > MOVING)
            return false;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const min = a.radius + b.radius;
        if (dist >= min)
            return false;
        const nx = dist < 1e-6 ? 1 : dx / dist;
        const ny = dist < 1e-6 ? 0 : dy / dist;
        const push = (min - dist) * 0.5 + 0.1;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        return true;
    }
    _resolveCircles(a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0)
            dist = 0.001;
        const nx = dx / dist, ny = dy / dist;
        const overlap = (a.radius + b.radius) - dist + 0.05;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const vRel = dvx * nx + dvy * ny;
        if (vRel <= 0)
            return;
        const e = (a.restitution + b.restitution) * 0.5;
        const j = (1 + e) * vRel / (1 / a.mass + 1 / b.mass);
        a.vx -= (j / a.mass) * nx;
        a.vy -= (j / a.mass) * ny;
        b.vx += (j / b.mass) * nx;
        b.vy += (j / b.mass) * ny;
    }
    _resolveWall(b, axis) {
        const e = PHYSICS.wall.restitution;
        const skin = 0.05;
        const { left, right, top, bottom } = this._walls;
        if (axis === 'left') {
            b.vx = Math.abs(b.vx) * e;
            b.x = left + b.radius + skin;
        }
        if (axis === 'right') {
            b.vx = -Math.abs(b.vx) * e;
            b.x = right - b.radius - skin;
        }
        if (axis === 'top') {
            b.vy = Math.abs(b.vy) * e;
            b.y = top + b.radius + skin;
        }
        if (axis === 'bottom') {
            b.vy = -Math.abs(b.vy) * e;
            b.y = bottom - b.radius - skin;
        }
    }
}
exports.PhysicsSystem = PhysicsSystem;
