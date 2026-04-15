"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarromRoom = void 0;
const colyseus_1 = require("colyseus");
const PhysicsSystem_1 = require("../physics/PhysicsSystem");
// ── Constants (must match client GameConfig) ──────────────────────────────────
const COIN_RADIUS = 15.6;
const STRIKER_RADIUS = 23.6;
const POCKET_RADIUS = 30;
const POCKETS = [
    { x: 130, y: 130 }, { x: 670, y: 130 },
    { x: 130, y: 670 }, { x: 670, y: 670 },
];
const COIN_LAYOUT = [
    { id: 'red', kind: 'red', x: 400, y: 400 },
    { id: 'b1', kind: 'black', x: 400, y: 369.25 },
    { id: 'w1', kind: 'white', x: 426.63, y: 384.63 },
    { id: 'b2', kind: 'black', x: 426.63, y: 415.38 },
    { id: 'w2', kind: 'white', x: 400, y: 430.75 },
    { id: 'b3', kind: 'black', x: 373.37, y: 415.38 },
    { id: 'w3', kind: 'white', x: 373.37, y: 384.63 },
    { id: 'b4', kind: 'black', x: 400, y: 337.75 },
    { id: 'w4', kind: 'white', x: 431.13, y: 346.09 },
    { id: 'b5', kind: 'black', x: 453.91, y: 368.88 },
    { id: 'w5', kind: 'white', x: 462.25, y: 400 },
    { id: 'b6', kind: 'black', x: 453.91, y: 431.13 },
    { id: 'w6', kind: 'white', x: 431.13, y: 453.91 },
    { id: 'b7', kind: 'black', x: 400, y: 462.25 },
    { id: 'w7', kind: 'white', x: 368.88, y: 453.91 },
    { id: 'b8', kind: 'black', x: 346.09, y: 431.13 },
    { id: 'w8', kind: 'white', x: 337.75, y: 400 },
    { id: 'b9', kind: 'black', x: 346.09, y: 368.88 },
    { id: 'w9', kind: 'white', x: 368.88, y: 346.09 },
];
const RAILS = {
    bottom: { y: 645, minX: 220, maxX: 580 },
    top: { y: 155, minX: 220, maxX: 580 },
};
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
            this.broadcast('game_start', { turn: this._turn });
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
        const speed = data.power * 18;
        this._physics.setVelocity(sid, Math.cos(data.angle) * speed, Math.sin(data.angle) * speed);
        this.broadcast('shot_fired', {
            sessionId: client.sessionId,
            strikerX: sx,
            strikerY: sy,
            angle: data.angle,
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
            for (const id of allBodyIds) {
                this._physics.applyDeceleration(id, dt);
                this._physics.stopIfSlow(id);
            }
            this._physics.step(dt);
            steps++;
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
