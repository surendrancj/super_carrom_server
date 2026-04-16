"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarromRoom = void 0;
const colyseus_1 = require("colyseus");
const PhysicsSystem_1 = require("../physics/PhysicsSystem");
// ── Constants (must match client GameConfig) ──────────────────────────────────
// Must match client src/config/GameConfig.js exactly
const COIN_RADIUS = 14.2; // COIN.physicsRadius
const STRIKER_RADIUS = 25; // STRIKER.radius
const POCKET_RADIUS = 28; // POCKET_RADIUS
const POCKETS = [
    { x: 130, y: 130 }, { x: 670, y: 130 },
    { x: 130, y: 670 }, { x: 670, y: 670 },
];
const COIN_LAYOUT = (() => {
    const raw = [
        { x: 400, y: 400, kind: 'red' },
        { x: 427.24, y: 393.36, kind: 'black' },
        { x: 419.57, y: 422.46, kind: 'white' },
        { x: 391.03, y: 428.02, kind: 'black' },
        { x: 372.53, y: 405.65, kind: 'white' },
        { x: 379.51, y: 378.1, kind: 'black' },
        { x: 408.99, y: 370.6, kind: 'white' },
        { x: 455.04, y: 387.29, kind: 'black' },
        { x: 447.9, y: 416.02, kind: 'white' },
        { x: 437.53, y: 445.28, kind: 'black' },
        { x: 410.65, y: 450.65, kind: 'white' },
        { x: 380.88, y: 455.58, kind: 'black' },
        { x: 362.06, y: 433.93, kind: 'white' },
        { x: 344.07, y: 411.87, kind: 'black' },
        { x: 350.95, y: 383.55, kind: 'white' },
        { x: 359.47, y: 356.81, kind: 'black' },
        { x: 388.54, y: 348.84, kind: 'white' },
        { x: 416.04, y: 341.67, kind: 'black' },
        { x: 437.05, y: 362.99, kind: 'white' },
    ];
    let black = 0;
    let white = 0;
    return raw.map((c) => {
        if (c.kind === 'red')
            return { id: 'red', ...c };
        if (c.kind === 'black')
            return { id: `b${++black}`, ...c };
        return { id: `w${++white}`, ...c };
    });
})();
const RAILS = {
    bottom: { y: 645, minX: 220, maxX: 580 },
    top: { y: 155, minX: 220, maxX: 580 },
};
// Must match client GameConfig.js SHOT values exactly
const SHOT = { minPower: 2, maxPower: 32 };
// ── Room ──────────────────────────────────────────────────────────────────────
class CarromRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 2;
        this._strikerIds = {};
        this._coinIds = {};
        this._coins = new Map();
        this._players = new Map();
        this._turn = '';
        this._phase = 'waiting';
        this._simulating = false;
    }
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    onCreate(_options) {
        // No setState — plain objects only, avoids client schema decode crash
        this._physics = new PhysicsSystem_1.PhysicsSystem();
        this._physics.setWalls(130, 670, 130, 670);
        this._initCoins();
        this.onMessage('fire', (client, data) => this._handleFire(client, data));
        this.onMessage('ready', (client) => this._handleReady(client));
        this.onMessage('striker_pos', (client, data) => this._handleStrikerPos(client, data));
        console.log(`[room] ${this.roomId} created`);
    }
    onJoin(client) {
        const isFirst = this._players.size === 0;
        const player = {
            sessionId: client.sessionId,
            side: isFirst ? 'bottom' : 'top',
            ready: false,
            connected: true,
        };
        this._players.set(client.sessionId, player);
        const rail = isFirst ? RAILS.bottom : RAILS.top;
        const sid = this._physics.createKinematicCircle(rail.minX, rail.y, STRIKER_RADIUS);
        this._strikerIds[client.sessionId] = sid;
        console.log(`[room] ${client.sessionId} joined as ${player.side}`);
        if (this._players.size === 2) {
            this.broadcast('waiting_ready', {});
        }
    }
    onLeave(client, code) {
        const player = this._players.get(client.sessionId);
        if (player) {
            player.connected = false;
            const consented = code === 1000;
            if (!consented) {
                this.allowReconnection(client, 30).catch(() => {
                    this._phase = 'gameover';
                });
            }
        }
    }
    onDispose() {
        console.log(`[room] ${this.roomId} disposed`);
    }
    // ── Message handlers ──────────────────────────────────────────────────────
    _handleReady(client) {
        const player = this._players.get(client.sessionId);
        if (player)
            player.ready = true;
        const players = Array.from(this._players.values());
        if (players.length === 2 && players.every(p => p.ready)) {
            this._phase = 'playing';
            const first = players.find(p => p.side === 'bottom');
            this._turn = first.sessionId;
            // Include coin layout so clients can assign matching string IDs and snap positions
            const coins = Array.from(this._coins.values()).map(c => ({
                id: c.id, kind: c.kind, x: c.x, y: c.y,
            }));
            this.broadcast('game_start', { turn: this._turn, coins });
            console.log(`[room] game started — first turn: ${this._turn}`);
        }
    }
    _handleFire(client, data) {
        if (this._phase !== 'playing')
            return;
        if (client.sessionId !== this._turn)
            return;
        if (this._simulating)
            return;
        const player = this._players.get(client.sessionId);
        const rail = RAILS[player.side];
        const sx = Math.max(rail.minX, Math.min(rail.maxX, data.strikerX));
        const sy = rail.y;
        const sid = this._strikerIds[client.sessionId];
        this._physics.setBodyType(sid, 'dynamic');
        this._physics.setPosition(sid, sx, sy);
        const speed = SHOT.minPower + data.power * (SHOT.maxPower - SHOT.minPower);
        const vx = Math.cos(data.angle) * speed;
        const vy = Math.sin(data.angle) * speed;
        this._physics.setVelocity(sid, vx, vy);
        this.broadcast('shot_fired', {
            sessionId: client.sessionId,
            strikerX: sx,
            strikerY: sy,
            angle: data.angle,
            vx,
            vy,
            power: data.power,
        });
        this._simulating = true;
        this._runSimulation(client.sessionId, sid);
    }
    // ── Server-side physics simulation ────────────────────────────────────────
    _runSimulation(firingSessionId, strikerId) {
        const allBodyIds = [strikerId, ...Object.values(this._coinIds)];
        const STEP_MS = 16;
        const MAX_STEPS = 6000;
        let steps = 0;
        const tick = () => {
            const dt = STEP_MS / 1000;
            // Step first (matching client update() order: step → deceleration → checkPockets).
            // Reversing this order (decel before step) causes the server to stop coins at
            // different positions than the client, making settled positions look "early".
            this._physics.step(dt);
            steps++;
            for (const id of allBodyIds) {
                this._physics.applyDeceleration(id, dt);
                this._physics.stopIfSlow(id);
            }
            this._checkPockets(strikerId);
            if (!this._physics.allStopped(allBodyIds) && steps < MAX_STEPS) {
                setImmediate(tick);
                return;
            }
            this._onSimulationComplete(firingSessionId, strikerId);
        };
        setImmediate(tick);
    }
    _checkPockets(strikerId) {
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coin = this._coins.get(coinStrId);
            if (!coin || !coin.active)
                continue;
            const pos = this._physics.getPosition(physId);
            for (const pocket of POCKETS) {
                if (Math.hypot(pos.x - pocket.x, pos.y - pocket.y) < POCKET_RADIUS) {
                    coin.active = false;
                    coin.x = pocket.x;
                    coin.y = pocket.y;
                    this._physics.setVelocity(physId, 0, 0);
                    this._physics.setBodyType(physId, 'kinematic');
                    break;
                }
            }
        }
        const sp = this._physics.getPosition(strikerId);
        for (const pocket of POCKETS) {
            if (Math.hypot(sp.x - pocket.x, sp.y - pocket.y) < POCKET_RADIUS) {
                this._physics.setVelocity(strikerId, 0, 0);
                this._physics.setBodyType(strikerId, 'kinematic');
                this._physics.setPosition(strikerId, -200, -200);
                break;
            }
        }
    }
    _onSimulationComplete(firingSessionId, strikerId) {
        this._simulating = false;
        this._physics.setVelocity(strikerId, 0, 0);
        this._physics.setBodyType(strikerId, 'kinematic');
        const settledCoins = {};
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coin = this._coins.get(coinStrId);
            const pos = this._physics.getPosition(physId);
            coin.x = pos.x;
            coin.y = pos.y;
            settledCoins[coinStrId] = { x: pos.x, y: pos.y, active: coin.active };
        }
        this._switchTurn(firingSessionId);
        this.broadcast('settled', {
            coins: settledCoins,
            turn: this._turn,
        });
        console.log(`[room] settled — turn → ${this._turn}`);
    }
    _handleStrikerPos(client, data) {
        if (client.sessionId !== this._turn)
            return;
        if (this._phase !== 'playing')
            return;
        this.broadcast('striker_pos', { x: data.x }, { except: client });
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    _switchTurn(currentSessionId) {
        const next = Array.from(this._players.keys())
            .find(id => id !== currentSessionId);
        this._turn = next ?? currentSessionId;
    }
    _initCoins() {
        for (const coin of COIN_LAYOUT) {
            const info = { ...coin, active: true };
            this._coins.set(coin.id, info);
            const physId = this._physics.createDynamicCircle(coin.x, coin.y, COIN_RADIUS);
            this._coinIds[coin.id] = physId;
        }
    }
}
exports.CarromRoom = CarromRoom;
