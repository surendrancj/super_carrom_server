import { Room, Client } from 'colyseus';
import { PhysicsSystem } from '../physics/PhysicsSystem';

// ── Constants (must match client GameConfig) ──────────────────────────────────
// Must match client src/config/GameConfig.js exactly
const COIN_RADIUS    = 14.2;  // COIN.physicsRadius
const STRIKER_RADIUS = 25;    // STRIKER.radius
const POCKET_RADIUS  = 28;    // POCKET_RADIUS

const POCKETS = [
    { x: 130, y: 130 }, { x: 670, y: 130 },
    { x: 130, y: 670 }, { x: 670, y: 670 },
];

const COIN_LAYOUT = [
    { id: 'red',  kind: 'red',   x: 400,    y: 400    },
    { id: 'b1',   kind: 'black', x: 400,    y: 369.25 },
    { id: 'w1',   kind: 'white', x: 426.63, y: 384.63 },
    { id: 'b2',   kind: 'black', x: 426.63, y: 415.38 },
    { id: 'w2',   kind: 'white', x: 400,    y: 430.75 },
    { id: 'b3',   kind: 'black', x: 373.37, y: 415.38 },
    { id: 'w3',   kind: 'white', x: 373.37, y: 384.63 },
    { id: 'b4',   kind: 'black', x: 400,    y: 337.75 },
    { id: 'w4',   kind: 'white', x: 431.13, y: 346.09 },
    { id: 'b5',   kind: 'black', x: 453.91, y: 368.88 },
    { id: 'w5',   kind: 'white', x: 462.25, y: 400    },
    { id: 'b6',   kind: 'black', x: 453.91, y: 431.13 },
    { id: 'w6',   kind: 'white', x: 431.13, y: 453.91 },
    { id: 'b7',   kind: 'black', x: 400,    y: 462.25 },
    { id: 'w7',   kind: 'white', x: 368.88, y: 453.91 },
    { id: 'b8',   kind: 'black', x: 346.09, y: 431.13 },
    { id: 'w8',   kind: 'white', x: 337.75, y: 400    },
    { id: 'b9',   kind: 'black', x: 346.09, y: 368.88 },
    { id: 'w9',   kind: 'white', x: 368.88, y: 346.09 },
];

const RAILS = {
    bottom: { y: 645, minX: 220, maxX: 580 },
    top:    { y: 155, minX: 220, maxX: 580 },
};

// Must match client GameConfig.js SHOT values exactly
const SHOT = { minPower: 2, maxPower: 32 };

// ── Plain-object state (no schema — avoids version-mismatch decode crash) ─────
interface PlayerInfo {
    sessionId: string;
    side:      'bottom' | 'top';
    ready:     boolean;
    connected: boolean;
}

interface CoinInfo {
    id:     string;
    kind:   string;
    x:      number;
    y:      number;
    active: boolean;
}

interface ShotMessage {
    strikerX: number;
    angle:    number;
    power:    number;
}

// ── Room ──────────────────────────────────────────────────────────────────────
export class CarromRoom extends Room {
    maxClients = 2;

    private _physics!:   PhysicsSystem;
    private _strikerIds: Record<string, number> = {};
    private _coinIds:    Record<string, number> = {};
    private _coins:      Map<string, CoinInfo>  = new Map();
    private _players:    Map<string, PlayerInfo> = new Map();
    private _turn        = '';
    private _phase       = 'waiting';
    private _simulating  = false;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onCreate(_options: any) {
        // No setState — plain objects only, avoids client schema decode crash
        this._physics = new PhysicsSystem();
        this._physics.setWalls(130, 670, 130, 670);
        this._initCoins();

        this.onMessage('fire',        (client, data: ShotMessage)    => this._handleFire(client, data));
        this.onMessage('ready',       (client)                        => this._handleReady(client));
        this.onMessage('striker_pos', (client, data: { x: number })  => this._handleStrikerPos(client, data));

        console.log(`[room] ${this.roomId} created`);
    }

    onJoin(client: Client) {
        const isFirst = this._players.size === 0;
        const player: PlayerInfo = {
            sessionId: client.sessionId,
            side:      isFirst ? 'bottom' : 'top',
            ready:     false,
            connected: true,
        };
        this._players.set(client.sessionId, player);

        const rail = isFirst ? RAILS.bottom : RAILS.top;
        const sid  = this._physics.createKinematicCircle(rail.minX, rail.y, STRIKER_RADIUS);
        this._strikerIds[client.sessionId] = sid;

        console.log(`[room] ${client.sessionId} joined as ${player.side}`);

        if (this._players.size === 2) {
            this.broadcast('waiting_ready', {});
        }
    }

    onLeave(client: Client, code?: number) {
        const player = this._players.get(client.sessionId);
        if (player) {
            player.connected = false;
            const consented  = code === 1000;
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

    private _handleReady(client: Client) {
        const player = this._players.get(client.sessionId);
        if (player) player.ready = true;

        const players = Array.from(this._players.values());
        if (players.length === 2 && players.every(p => p.ready)) {
            this._phase = 'playing';
            const first = players.find(p => p.side === 'bottom')!;
            this._turn  = first.sessionId;
            // Include coin layout so clients can assign matching string IDs and snap positions
            const coins = Array.from(this._coins.values()).map(c => ({
                id: c.id, kind: c.kind, x: c.x, y: c.y,
            }));
            this.broadcast('game_start', { turn: this._turn, coins });
            console.log(`[room] game started — first turn: ${this._turn}`);
        }
    }

    private _handleFire(client: Client, data: ShotMessage) {
        if (this._phase !== 'playing') return;
        if (client.sessionId !== this._turn) return;
        if (this._simulating) return;

        const player = this._players.get(client.sessionId)!;
        const rail   = RAILS[player.side];

        const sx = Math.max(rail.minX, Math.min(rail.maxX, data.strikerX));
        const sy = rail.y;

        const sid = this._strikerIds[client.sessionId];
        this._physics.setBodyType(sid, 'dynamic');
        this._physics.setPosition(sid, sx, sy);

        const speed = SHOT.minPower + data.power * (SHOT.maxPower - SHOT.minPower);
        this._physics.setVelocity(sid, Math.cos(data.angle) * speed, Math.sin(data.angle) * speed);

        this.broadcast('shot_fired', {
            sessionId: client.sessionId,
            strikerX:  sx,
            strikerY:  sy,
            angle:     data.angle,
            power:     data.power,
        });

        this._simulating = true;
        this._runSimulation(client.sessionId, sid);
    }

    // ── Server-side physics simulation ────────────────────────────────────────

    private _runSimulation(firingSessionId: string, strikerId: number) {
        const allBodyIds = [strikerId, ...Object.values(this._coinIds)];
        const STEP_MS    = 16;
        const MAX_STEPS  = 6000;
        let   steps      = 0;

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

    private _checkPockets(strikerId: number) {
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coin = this._coins.get(coinStrId);
            if (!coin || !coin.active) continue;

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

    private _onSimulationComplete(firingSessionId: string, strikerId: number) {
        this._simulating = false;
        this._physics.setVelocity(strikerId, 0, 0);
        this._physics.setBodyType(strikerId, 'kinematic');

        const settledCoins: Record<string, { x: number; y: number; active: boolean }> = {};
        for (const [coinStrId, physId] of Object.entries(this._coinIds)) {
            const coin = this._coins.get(coinStrId)!;
            const pos  = this._physics.getPosition(physId);
            coin.x = pos.x;
            coin.y = pos.y;
            settledCoins[coinStrId] = { x: pos.x, y: pos.y, active: coin.active };
        }

        this._switchTurn(firingSessionId);

        this.broadcast('settled', {
            coins: settledCoins,
            turn:  this._turn,
        });

        console.log(`[room] settled — turn → ${this._turn}`);
    }

    private _handleStrikerPos(client: Client, data: { x: number }) {
        if (client.sessionId !== this._turn) return;
        if (this._phase !== 'playing') return;
        this.broadcast('striker_pos', { x: data.x }, { except: client });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _switchTurn(currentSessionId: string) {
        const next = Array.from(this._players.keys())
            .find(id => id !== currentSessionId);
        this._turn = next ?? currentSessionId;
    }

    private _initCoins() {
        for (const coin of COIN_LAYOUT) {
            const info: CoinInfo = { ...coin, active: true };
            this._coins.set(coin.id, info);
            const physId = this._physics.createDynamicCircle(coin.x, coin.y, COIN_RADIUS);
            this._coinIds[coin.id] = physId;
        }
    }
}
