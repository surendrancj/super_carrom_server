import { Room, Client } from 'colyseus';
import { PhysicsSystem } from '../physics/PhysicsSystem';

// ── Constants (must match client GameConfig) ──────────────────────────────────
// Must match client src/config/GameConfig.js exactly
const COIN_RADIUS    = 14.2;  // COIN.physicsRadius
const STRIKER_RADIUS = 25;    // STRIKER.radius
const POCKET_RADIUS  = 28;    // POCKET_RADIUS

const COIN_LAYOUT: Array<{ id: string; kind: 'black' | 'white' | 'red'; x: number; y: number }> = (() => {
    const raw: Array<{ kind: 'black' | 'white' | 'red'; x: number; y: number }> = [
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
        if (c.kind === 'red') return { id: 'red', ...c };
        if (c.kind === 'black') return { id: `b${++black}`, ...c };
        return { id: `w${++white}`, ...c };
    });
})();

type Side = 'bottom' | 'top';

interface WallsConfig { left: number; right: number; top: number; bottom: number; }
interface PocketConfig { x: number; y: number; }
interface RailConfig { y: number; minX: number; maxX: number; }

interface GameConfigWire {
    walls?: WallsConfig;
    pockets?: PocketConfig[];
    pocketRadius?: number;
    striker?: RailConfig;
    aiStriker?: RailConfig;
}

const DEFAULT_CONFIG: Required<GameConfigWire> = {
    walls: { left: 130, right: 670, top: 130, bottom: 670 },
    pockets: [
        { x: 130, y: 130 }, { x: 670, y: 130 },
        { x: 130, y: 670 }, { x: 670, y: 670 },
    ],
    pocketRadius: POCKET_RADIUS,
    striker: { y: 645, minX: 220, maxX: 580 },
    aiStriker: { y: 155, minX: 220, maxX: 580 },
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

function _num(n: any, fallback: number) {
    return (typeof n === 'number' && Number.isFinite(n)) ? n : fallback;
}

function _normalizeConfig(input: any): Required<GameConfigWire> {
    const cfg = input && typeof input === 'object' ? input as GameConfigWire : {};

    const walls = cfg.walls && typeof cfg.walls === 'object'
        ? {
            left:   _num(cfg.walls.left,   DEFAULT_CONFIG.walls.left),
            right:  _num(cfg.walls.right,  DEFAULT_CONFIG.walls.right),
            top:    _num(cfg.walls.top,    DEFAULT_CONFIG.walls.top),
            bottom: _num(cfg.walls.bottom, DEFAULT_CONFIG.walls.bottom),
        }
        : { ...DEFAULT_CONFIG.walls };

    const pockets = Array.isArray(cfg.pockets) && cfg.pockets.length > 0
        ? cfg.pockets
            .filter(p => p && typeof p === 'object')
            .map(p => ({ x: _num((p as any).x, 0), y: _num((p as any).y, 0) }))
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        : [...DEFAULT_CONFIG.pockets];

    const striker = cfg.striker && typeof cfg.striker === 'object'
        ? {
            y:    _num(cfg.striker.y,    DEFAULT_CONFIG.striker.y),
            minX: _num(cfg.striker.minX, DEFAULT_CONFIG.striker.minX),
            maxX: _num(cfg.striker.maxX, DEFAULT_CONFIG.striker.maxX),
        }
        : { ...DEFAULT_CONFIG.striker };

    const aiStriker = cfg.aiStriker && typeof cfg.aiStriker === 'object'
        ? {
            y:    _num(cfg.aiStriker.y,    DEFAULT_CONFIG.aiStriker.y),
            minX: _num(cfg.aiStriker.minX, DEFAULT_CONFIG.aiStriker.minX),
            maxX: _num(cfg.aiStriker.maxX, DEFAULT_CONFIG.aiStriker.maxX),
        }
        : { ...DEFAULT_CONFIG.aiStriker };

    if (striker.minX > striker.maxX) [striker.minX, striker.maxX] = [striker.maxX, striker.minX];
    if (aiStriker.minX > aiStriker.maxX) [aiStriker.minX, aiStriker.maxX] = [aiStriker.maxX, aiStriker.minX];

    return {
        walls,
        pockets: pockets.length ? pockets : [...DEFAULT_CONFIG.pockets],
        pocketRadius: _num(cfg.pocketRadius, DEFAULT_CONFIG.pocketRadius),
        striker,
        aiStriker,
    };
}

function _normalizeCoinLayout(input: any): Array<{ id: string; kind: 'black' | 'white' | 'red'; x: number; y: number }> {
    if (!Array.isArray(input)) return COIN_LAYOUT;

    const raw = input
        .filter(c => c && typeof c === 'object')
        .map(c => {
            const kind = (c as any).kind ?? (c as any).type;
            const x = (c as any).x;
            const y = (c as any).y;
            return { kind, x, y };
        })
        .filter(c => (c.kind === 'black' || c.kind === 'white' || c.kind === 'red')
            && typeof c.x === 'number' && Number.isFinite(c.x)
            && typeof c.y === 'number' && Number.isFinite(c.y)
        ) as Array<{ kind: 'black' | 'white' | 'red'; x: number; y: number }>;

    if (raw.length === 0) return COIN_LAYOUT;

    let red = 0;
    let black = 0;
    let white = 0;
    return raw.map((c) => {
        if (c.kind === 'red') return { id: (++red === 1) ? 'red' : `r${red}`, ...c };
        if (c.kind === 'black') return { id: `b${++black}`, ...c };
        return { id: `w${++white}`, ...c };
    });
}

// ── Room ──────────────────────────────────────────────────────────────────────
export class CarromRoom extends Room {
    maxClients = 2;

    private _physics!:   PhysicsSystem;
    private _config:     Required<GameConfigWire> = DEFAULT_CONFIG;
    private _rails:      Record<Side, RailConfig> = { bottom: DEFAULT_CONFIG.striker, top: DEFAULT_CONFIG.aiStriker };
    private _strikerIds: Record<string, number> = {};
    private _coinIds:    Record<string, number> = {};
    private _coins:      Map<string, CoinInfo>  = new Map();
    private _players:    Map<string, PlayerInfo> = new Map();
    private _turn        = '';
    private _phase       = 'waiting';
    private _simulating  = false;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onCreate(options: any) {
        // No setState — plain objects only, avoids client schema decode crash
        this._config = _normalizeConfig(options?.gameConfig);
        this._rails  = { bottom: this._config.striker, top: this._config.aiStriker };
        this._physics = new PhysicsSystem();
        this._physics.setWalls(
            this._config.walls.left,
            this._config.walls.right,
            this._config.walls.top,
            this._config.walls.bottom,
        );
        this._initCoins(_normalizeCoinLayout(options?.coinLayout));

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

        const rail = isFirst ? this._rails.bottom : this._rails.top;
        const sx = (rail.minX + rail.maxX) / 2;
        const sid  = this._physics.createKinematicCircle(sx, rail.y, STRIKER_RADIUS);
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
            this.broadcast('game_start', { turn: this._turn, coins, config: this._config });
            console.log(`[room] game started — first turn: ${this._turn}`);
        }
    }

    private _handleFire(client: Client, data: ShotMessage) {
        if (this._phase !== 'playing') return;
        if (client.sessionId !== this._turn) return;
        if (this._simulating) return;

        const player = this._players.get(client.sessionId)!;
        const rail   = this._rails[player.side];

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
            strikerX:  sx,
            strikerY:  sy,
            angle:     data.angle,
            vx,
            vy,
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
            for (const pocket of this._config.pockets) {
                if (Math.hypot(pos.x - pocket.x, pos.y - pocket.y) < this._config.pocketRadius) {
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
        for (const pocket of this._config.pockets) {
            if (Math.hypot(sp.x - pocket.x, sp.y - pocket.y) < this._config.pocketRadius) {
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

    private _initCoins(layout: Array<{ id: string; kind: 'black' | 'white' | 'red'; x: number; y: number }>) {
        for (const coin of layout) {
            const info: CoinInfo = { ...coin, active: true };
            this._coins.set(coin.id, info);
            const physId = this._physics.createDynamicCircle(coin.x, coin.y, COIN_RADIUS);
            this._coinIds[coin.id] = physId;
        }
    }
}
