"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = exports.PlayerState = exports.CoinState = void 0;
const schema_1 = require("@colyseus/schema");
class CoinState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.kind = ''; // black | white | red
        this.x = 0;
        this.y = 0;
        this.active = true;
    }
}
exports.CoinState = CoinState;
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], CoinState.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], CoinState.prototype, "kind", void 0);
__decorate([
    (0, schema_1.type)('float32'),
    __metadata("design:type", Number)
], CoinState.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)('float32'),
    __metadata("design:type", Number)
], CoinState.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)('boolean'),
    __metadata("design:type", Boolean)
], CoinState.prototype, "active", void 0);
class PlayerState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.sessionId = '';
        this.side = ''; // bottom | top
        this.score = 0;
        this.connected = true;
        this.ready = false;
    }
}
exports.PlayerState = PlayerState;
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], PlayerState.prototype, "sessionId", void 0);
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], PlayerState.prototype, "side", void 0);
__decorate([
    (0, schema_1.type)('number'),
    __metadata("design:type", Number)
], PlayerState.prototype, "score", void 0);
__decorate([
    (0, schema_1.type)('boolean'),
    __metadata("design:type", Boolean)
], PlayerState.prototype, "connected", void 0);
__decorate([
    (0, schema_1.type)('boolean'),
    __metadata("design:type", Boolean)
], PlayerState.prototype, "ready", void 0);
class GameState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        // waiting → playing → gameover
        this.phase = 'waiting';
        // sessionId of the player whose turn it is
        this.turn = '';
        // sessionId of winner (empty until game ends)
        this.winner = '';
        // Scores
        this.scoreBlack = 0;
        this.scoreWhite = 0;
        this.scoreRed = 0;
        // '' | sessionId of player who pocketed red and must cover next turn
        this.queenPendingBy = '';
        this.coins = new schema_1.MapSchema();
        this.players = new schema_1.MapSchema();
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], GameState.prototype, "phase", void 0);
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], GameState.prototype, "turn", void 0);
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], GameState.prototype, "winner", void 0);
__decorate([
    (0, schema_1.type)('number'),
    __metadata("design:type", Number)
], GameState.prototype, "scoreBlack", void 0);
__decorate([
    (0, schema_1.type)('number'),
    __metadata("design:type", Number)
], GameState.prototype, "scoreWhite", void 0);
__decorate([
    (0, schema_1.type)('number'),
    __metadata("design:type", Number)
], GameState.prototype, "scoreRed", void 0);
__decorate([
    (0, schema_1.type)('string'),
    __metadata("design:type", String)
], GameState.prototype, "queenPendingBy", void 0);
__decorate([
    (0, schema_1.type)({ map: CoinState }),
    __metadata("design:type", Object)
], GameState.prototype, "coins", void 0);
__decorate([
    (0, schema_1.type)({ map: PlayerState }),
    __metadata("design:type", Object)
], GameState.prototype, "players", void 0);
