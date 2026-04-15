import { listen } from '@colyseus/tools';
import { CarromRoom } from './src/rooms/CarromRoom';
import cors from 'cors';

const PORT = Number(process.env.PORT) || 3000;

listen({
    initializeGameServer(gameServer) {
        gameServer.define('carrom', CarromRoom).enableRealtimeListing();
    },

    initializeExpress(app) {
        app.use(cors());
        app.get('/health', (_req, res) => res.json({ ok: true }));
    },

    beforeListen() {
        console.log(`[carrom] starting on port ${PORT}`);
    },
}, PORT);
