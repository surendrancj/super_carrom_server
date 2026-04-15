import config from '@colyseus/tools';
import { monitor } from '@colyseus/monitor';
import { CarromRoom } from './src/rooms/CarromRoom';
import cors from 'cors';

export default config({
    initializeGameServer(gameServer) {
        gameServer.define('carrom', CarromRoom).enableRealtimeListing();
    },

    initializeExpress(app) {
        app.use(cors());
        app.get('/health', (_req, res) => res.json({ ok: true }));

        // Monitor only in dev — skip in production to save memory
        if (process.env.NODE_ENV !== 'production') {
            app.use('/colyseus', monitor());
        }
    },

    beforeListen() {},
});
