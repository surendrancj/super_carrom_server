// ─── PhysicsSystem.ts ────────────────────────────────────────────────────────
// Direct port of PhysicsSystem.js — pure math, no Phaser dependency.
// Runs identically on server (Node.js) and client (browser/V8).

const SCALE = 100; // px per metre — must match client GameConfig

const PHYSICS = {
    coin:          { density: 1.0, restitution: 0.75 },
    striker:       { density: 2.0, restitution: 0.70 },
    wall:          { restitution: 0.65 },
    deceleration:  4.5,   // m/s²
    stopThreshold: 0.03,  // m/s
};

interface Body {
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    type: 'dynamic' | 'kinematic';
    restitution: number;
    mass: number;
}

interface Walls { left: number; right: number; top: number; bottom: number; }

export class PhysicsSystem {
    private _bodies = new Map<number, Body>();
    private _nextId = 1;
    private _walls: Walls = { left: 130, right: 670, top: 130, bottom: 670 };

    setWalls(left: number, right: number, top: number, bottom: number) {
        this._walls = { left, right, top, bottom };
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    private _makeBody(x: number, y: number, radius: number, type: 'dynamic' | 'kinematic'): number {
        const id = this._nextId++;
        this._bodies.set(id, { x, y, vx: 0, vy: 0, radius, type, restitution: PHYSICS.coin.restitution, mass: 1.0 });
        return id;
    }

    createDynamicCircle(x: number, y: number, radius: number): number {
        const id = this._makeBody(x, y, radius, 'dynamic');
        const b = this._bodies.get(id)!;
        b.mass = PHYSICS.coin.density;
        b.restitution = PHYSICS.coin.restitution;
        return id;
    }

    createKinematicCircle(x: number, y: number, radius: number): number {
        const id = this._makeBody(x, y, radius, 'kinematic');
        const b = this._bodies.get(id)!;
        b.mass = PHYSICS.striker.density;
        b.restitution = PHYSICS.striker.restitution;
        return id;
    }

    destroyBody(id: number) { this._bodies.delete(id); }

    // ── Manipulation ──────────────────────────────────────────────────────────

    setVelocity(id: number, vx: number, vy: number) {
        const b = this._bodies.get(id);
        if (b) { b.vx = vx * SCALE; b.vy = vy * SCALE; }
    }

    setPosition(id: number, x: number, y: number) {
        const b = this._bodies.get(id);
        if (b) { b.x = x; b.y = y; }
    }

    setBodyType(id: number, type: 'dynamic' | 'kinematic') {
        const b = this._bodies.get(id);
        if (!b) return;
        b.type = type;
        if (type === 'dynamic') {
            b.mass = PHYSICS.striker.density;
            b.restitution = PHYSICS.striker.restitution;
        }
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    getPosition(id: number): { x: number; y: number } {
        const b = this._bodies.get(id);
        return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
    }

    getSpeed(id: number): number {
        const b = this._bodies.get(id);
        if (!b) return 0;
        return Math.sqrt(b.vx * b.vx + b.vy * b.vy) / SCALE;
    }

    applyDeceleration(id: number, dt: number, rate = PHYSICS.deceleration) {
        const b = this._bodies.get(id);
        if (!b) return;
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed === 0) return;
        const reduction = rate * SCALE * dt;
        const newSpeed  = Math.max(0, speed - reduction);
        b.vx *= newSpeed / speed;
        b.vy *= newSpeed / speed;
    }

    stopIfSlow(id: number, threshold = PHYSICS.stopThreshold) {
        const b = this._bodies.get(id);
        if (!b) return;
        if (this.getSpeed(id) < threshold) { b.vx = 0; b.vy = 0; }
    }

    allStopped(ids: number[]): boolean {
        return ids.every(id => this.getSpeed(id) < PHYSICS.stopThreshold);
    }

    // ── Physics step ──────────────────────────────────────────────────────────

    step(dt: number) {
        const dynamic: Body[] = [];
        for (const b of this._bodies.values()) {
            if (b.type === 'dynamic') dynamic.push(b);
        }
        if (dynamic.length === 0) return;

        // Phase 1: separate overlapping stationary bodies
        for (let pass = 0; pass < 8; pass++) {
            let anyOverlap = false;
            for (let i = 0; i < dynamic.length; i++)
                for (let j = i + 1; j < dynamic.length; j++)
                    if (this._separateOverlap(dynamic[i], dynamic[j])) anyOverlap = true;
            if (!anyOverlap) break;
        }

        // Phase 2: CCD
        let remaining = dt;
        for (let iter = 0; iter < 32 && remaining > 1e-7; iter++) {
            let earliestT    = remaining;
            let earliestType: 'cc' | 'wall' | null = null;
            let ccA: Body | null = null, ccB: Body | null = null;
            let wallBody: Body | null = null, wallAxis: string | null = null;

            for (let i = 0; i < dynamic.length; i++) {
                for (let j = i + 1; j < dynamic.length; j++) {
                    const t = this._sweepCircles(dynamic[i], dynamic[j], remaining);
                    if (t !== null && t < earliestT - 1e-9) {
                        earliestT = t; earliestType = 'cc';
                        ccA = dynamic[i]; ccB = dynamic[j];
                    }
                }
            }
            for (const b of dynamic) {
                const { t, axis } = this._sweepWall(b, remaining);
                if (t !== null && t < earliestT - 1e-9) {
                    earliestT = t; earliestType = 'wall';
                    wallBody = b; wallAxis = axis;
                }
            }

            if (earliestT < 1e-9) break;
            for (const b of dynamic) { b.x += b.vx * earliestT; b.y += b.vy * earliestT; }
            remaining -= earliestT;

            if (earliestType === 'cc')   this._resolveCircles(ccA!, ccB!);
            if (earliestType === 'wall') this._resolveWall(wallBody!, wallAxis!);
            if (!earliestType) break;
        }
    }

    // ── CCD helpers ───────────────────────────────────────────────────────────

    private _sweepCircles(a: Body, b: Body, maxT: number): number | null {
        const dx = a.x - b.x, dy = a.y - b.y;
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const minDist = a.radius + b.radius;
        const A = dvx * dvx + dvy * dvy;
        if (A < 1e-10) return null;
        const B = 2 * (dx * dvx + dy * dvy);
        const C = dx * dx + dy * dy - minDist * minDist;
        const disc = B * B - 4 * A * C;
        if (disc < 0) return null;
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t < 0 || t > maxT) return null;
        if (C <= 0 && B >= 0) return null;
        return t;
    }

    private _sweepWall(b: Body, maxT: number): { t: number | null; axis: string | null } {
        const { left, right, top, bottom } = this._walls;
        let t: number | null = null, axis: string | null = null;
        const check = (candidate: number, candidateAxis: string) => {
            if (candidate >= 0 && candidate <= maxT) {
                if (t === null || candidate < t) { t = candidate; axis = candidateAxis; }
            }
        };
        if (b.vx < 0) check((left  + b.radius - b.x) / b.vx, 'left');
        if (b.vx > 0) check((right - b.radius - b.x) / b.vx, 'right');
        if (b.vy < 0) check((top   + b.radius - b.y) / b.vy, 'top');
        if (b.vy > 0) check((bottom - b.radius - b.y) / b.vy, 'bottom');
        return { t, axis };
    }

    private _separateOverlap(a: Body, b: Body): boolean {
        const MOVING = 5;
        if (Math.sqrt(a.vx * a.vx + a.vy * a.vy) > MOVING) return false;
        if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) > MOVING) return false;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const min = a.radius + b.radius;
        if (dist >= min) return false;
        const nx = dist < 1e-6 ? 1 : dx / dist;
        const ny = dist < 1e-6 ? 0 : dy / dist;
        const push = (min - dist) * 0.5 + 0.1;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        return true;
    }

    private _resolveCircles(a: Body, b: Body) {
        const dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) dist = 0.001;
        const nx = dx / dist, ny = dy / dist;
        const overlap = (a.radius + b.radius) - dist + 0.05;
        a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const vRel = dvx * nx + dvy * ny;
        if (vRel <= 0) return;
        const e = (a.restitution + b.restitution) * 0.5;
        const j = (1 + e) * vRel / (1 / a.mass + 1 / b.mass);
        a.vx -= (j / a.mass) * nx; a.vy -= (j / a.mass) * ny;
        b.vx += (j / b.mass) * nx; b.vy += (j / b.mass) * ny;
    }

    private _resolveWall(b: Body, axis: string) {
        const e = PHYSICS.wall.restitution;
        const skin = 0.05;
        const { left, right, top, bottom } = this._walls;
        if (axis === 'left')   { b.vx =  Math.abs(b.vx) * e; b.x = left   + b.radius + skin; }
        if (axis === 'right')  { b.vx = -Math.abs(b.vx) * e; b.x = right  - b.radius - skin; }
        if (axis === 'top')    { b.vy =  Math.abs(b.vy) * e; b.y = top    + b.radius + skin; }
        if (axis === 'bottom') { b.vy = -Math.abs(b.vy) * e; b.y = bottom - b.radius - skin; }
    }
}
