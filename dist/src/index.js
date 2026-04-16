"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const colyseus_1 = require("colyseus");
const CarromRoom_1 = require("./rooms/CarromRoom");
const PORT = Number(process.env.PORT) || 3000;
const server = new colyseus_1.Server({
    express(app) {
        app.use((0, cors_1.default)());
        app.get('/health', (_req, res) => res.json({ ok: true }));
        app.use('/colyseus', (0, colyseus_1.monitor)());
    },
});
server.define('carrom', CarromRoom_1.CarromRoom).filterBy(['code']).enableRealtimeListing();
server.listen(PORT).then(() => {
    console.log(`\n  Colyseus server running`);
    console.log(`  WebSocket  → ws://localhost:${PORT}`);
    console.log(`  Monitor UI → http://localhost:${PORT}/colyseus\n`);
});
