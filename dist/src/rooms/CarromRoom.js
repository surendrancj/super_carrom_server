"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarromRoom = void 0;
const colyseus_1 = require("colyseus");
const GameState_1 = require("../schema/GameState");
const PhysicsSystem_1 = require("../physics/PhysicsSystem");
// ── Constants (must match client GameConfig) ──────────────────────────────────
const COIN_RADIUS = 15.6; // physicsRadius
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
// Striker rail configs (y positions on 800px board)
const RAILS = {
    bottom: { y: 645, minX: 220, maxX: 580 }, // human / player 1
    top: { y: 155, minX: 220, maxX: 580 }, // opponent / player 2
};
// ── Room ──────────────────────────────────────────────────────────────────────
class CarromRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 2;
        this._strikerIds = {}; // sessionId → physics body id
        this._coinIds = {}; // coin id string → physics body id
        this._simulating = false;
    }
    // Typed accessor — avoids casting everywhere
    get gs() { return this.state; }
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    onCreate(options) {
        this.setState(new GameState_1.GameState());
        this._physics = new PhysicsSystem_1.PhysicsSystem();
        this._physics.setWalls(130, 670, 130, 670);
        this._initCoins();
        this.onMessage('fire', (client, data) => this._handleFire(client, data));
        this.onMessage('ready', (client) => this._handleReady(client));
        console.log(`[room] ${this.roomId} created`);
    }
    onJoin(client) {
        const isFirst = this.gs.players.size === 0;
        const player = new GameState_1.PlayerState();
        player.sessionId = client.sessionId;
        player.side = isFirst ? 'bottom' : 'top';
        player.connected = true;
        this.gs.players.set(client.sessionId, player);
        // Create striker physics body for this player
        const rail = isFirst ? RAILS.bottom : RAILS.top;
        const sid = this._physics.createKinematicCircle(rail.minX, rail.y, STRIKER_RADIUS);
        this._strikerIds[client.sessionId] = sid;
        console.log(`[room] ${client.sessionId} joined as ${player.side}`);
        // Two players in — game can start once both ready
        if (this.gs.players.size === 2) {
            this.broadcast('waiting_ready', {});
        }
    }
    onLeave(client, code) {
        const player = this.gs.players.get(client.sessionId);
        if (player) {
            player.connected = false;
            const consented = code === 1000;
            if (!consented) {
                // Give 30s to reconnect
                this.allowReconnection(client, 30).catch(() => {
                    this.gs.phase = 'gameover';
                    this.gs.winner = this._opponent(client.sessionId)?.sessionId ?? '';
                });
            }
        }
    }
    onDispose() {
        console.log(`[room] ${this.roomId} disposed`);
    }
    // ── Message handlers ──────────────────────────────────────────────────────
    _handleReady(client) {
        const player = this.gs.players.get(client.sessionId);
        if (player)
            player.ready = true;
        const players = Array.from(this.gs.players.values());
        if (players.length === 2 && players.every(p => p.ready)) {
            this.gs.phase = 'playing';
            // Bottom player (first to join) goes first
            const first = players.find(p => p.side === 'bottom');
            this.gs.turn = first.sessionId;
            this.broadcast('game_start', { turn: this.gs.turn });
            console.log(`[room] game started — first turn: ${this.gs.turn}`);
        }
    }
    _handleFire(client, data) {
        if (this.gs.phase !== 'playing')
            return;
        if (client.sessionId !== this.gs.turn)
            return; // not your turn
        if (this._simulating)
            return; // physics already running
        const player = this.gs.players.get(client.sessionId);
        const rail = RAILS[player.side];
        // Clamp striker X to valid range
        const sx = Math.max(rail.minX, Math.min(rail.maxX, data.strikerX));
        const sy = rail.y;
        // Place and launch striker
        const sid = this._strikerIds[client.sessionId];
        this._physics.setBodyType(sid, 'dynamic');
        this._physics.setPosition(sid, sx, sy);
        const MAX_DRAG = 70;
        const MAX_SPEED_MS = 18;
        const speed = data.power * MAX_SPEED_MS;
        this._physics.setVelocity(sid, Math.cos(data.angle) * speed, Math.sin(data.angle) * speed);
        // Tell ALL clients to start their local simulation (client-side prediction)
        this.broadcast('shot_fired', {
            by: client.sessionId,
            strikerX: sx, strikerY: sy,
            angle: data.angle, power: data.power,
        });
        // Run server simulation
        this._simulating = true;
        this._runSimulation(client.sessionId, sid);
    }
    // ── Server-side physics simulation ────────────────────────────────────────
    _runSimulation(firingSessionId, strikerId) {
        const allBodyIds = [
            strikerId,
            ...Object.values(this._coinIds),
        ];
        const STEP_MS = 16; // simulate in 16ms steps
        const MAX_STEPS = 6000; // 6000 × 16ms = 96s hard cap
        let steps = 0;
        const tick = () => {
            const dt = STEP_MS / 1000;
            // Decelerate and step
            for (const id of allBodyIds) {
                this._physics.applyDeceleration(id, dt);
                this._physics.stopIfSlow(id);
            }
            this._physics.step(dt);
            steps++;
            // Check pocket sinks
            this._checkPockets(strikerId);
            // Keep going until everything stops or cap reached
            if (!this._physics.allStopped(allBodyIds) && steps < MAX_STEPS) {
                setImmediate(tick);
                return;
            }
            // Simulation settled — send authoritative state to all clients
            this._onSimulationComplete(firingSessionId, strikerId);
        };
        setImmediate(tick);
    }
    _checkPockets(strikerId) {
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coinState = this.gs.coins.get(coinStrId);
            if (!coinState || !coinState.active)
                continue;
            const pos = this._physics.getPosition(physId);
            for (const pocket of POCKETS) {
                const dist = Math.hypot(pos.x - pocket.x, pos.y - pocket.y);
                if (dist < POCKET_RADIUS) {
                    coinState.active = false;
                    coinState.x = pocket.x;
                    coinState.y = pocket.y;
                    this._physics.setVelocity(physId, 0, 0);
                    this._physics.setBodyType(physId, 'kinematic');
                    break;
                }
            }
        }
        // Striker pocket (foul)
        const sp = this._physics.getPosition(strikerId);
        for (const pocket of POCKETS) {
            if (Math.hypot(sp.x - pocket.x, sp.y - pocket.y) < POCKET_RADIUS) {
                this._physics.setVelocity(strikerId, 0, 0);
                this._physics.setBodyType(strikerId, 'kinematic');
                this._physics.setPosition(strikerId, -200, -200); // park off-board
                break;
            }
        }
    }
    _onSimulationComplete(firingSessionId, strikerId) {
        this._simulating = false;
        // Reset striker to off-board (kinematic, parked)
        this._physics.setVelocity(strikerId, 0, 0);
        this._physics.setBodyType(strikerId, 'kinematic');
        // Sync authoritative coin positions into schema
        const settledCoins = {};
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coinState = this.gs.coins.get(coinStrId);
            const pos = this._physics.getPosition(physId);
            coinState.x = pos.x;
            coinState.y = pos.y;
            settledCoins[coinStrId] = { x: pos.x, y: pos.y, active: coinState.active };
        }
        // TODO: full carrom rules (_endTurn logic) — for now just switch turn
        this._switchTurn(firingSessionId);
        // Send settled state — clients reconcile by lerping any drifted coins
        this.broadcast('settled', {
            coins: settledCoins,
            turn: this.gs.turn,
        });
        console.log(`[room] simulation complete — turn → ${this.gs.turn}`);
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    _switchTurn(currentSessionId) {
        const next = Array.from(this.gs.players.keys())
            .find(id => id !== currentSessionId);
        this.gs.turn = next ?? currentSessionId;
    }
    _opponent(sessionId) {
        return Array.from(this.gs.players.values())
            .find(p => p.sessionId !== sessionId);
    }
    _initCoins() {
        for (const coin of COIN_LAYOUT) {
            const coinState = new GameState_1.CoinState();
            coinState.id = coin.id;
            coinState.kind = coin.kind;
            coinState.x = coin.x;
            coinState.y = coin.y;
            coinState.active = true;
            this.gs.coins.set(coin.id, coinState);
            const physId = this._physics.createDynamicCircle(coin.x, coin.y, COIN_RADIUS);
            this._coinIds[coin.id] = physId;
        }
    }
}
exports.CarromRoom = CarromRoom;
