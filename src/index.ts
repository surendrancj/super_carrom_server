import cors from 'cors';
import { Server, monitor } from 'colyseus';
import { CarromRoom } from './rooms/CarromRoom';

const PORT = Number(process.env.PORT) || 3000;

const server = new Server({
    express(app) {
        app.use(cors());
        app.get('/health', (_req, res) => res.json({ ok: true }));
        app.use('/colyseus', monitor());
    },
});

server.define('carrom', CarromRoom).enableRealtimeListing();

server.listen(PORT).then(() => {
    console.log(`\n  Colyseus server running`);
    console.log(`  WebSocket  → ws://localhost:${PORT}`);
    console.log(`  Monitor UI → http://localhost:${PORT}/colyseus\n`);
});
