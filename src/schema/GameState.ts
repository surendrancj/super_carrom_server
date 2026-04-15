import { Schema, MapSchema, type } from '@colyseus/schema';

export class CoinState extends Schema {
    @type('string')  id:     string  = '';
    @type('string')  kind:   string  = '';   // black | white | red
    @type('float32') x:      number  = 0;
    @type('float32') y:      number  = 0;
    @type('boolean') active: boolean = true;
}

export class PlayerState extends Schema {
    @type('string')  sessionId: string  = '';
    @type('string')  side:      string  = '';   // bottom | top
    @type('number')  score:     number  = 0;
    @type('boolean') connected: boolean = true;
    @type('boolean') ready:     boolean = false;
}

export class GameState extends Schema {
    // waiting → playing → gameover
    @type('string') phase: string = 'waiting';

    // sessionId of the player whose turn it is
    @type('string') turn: string = '';

    // sessionId of winner (empty until game ends)
    @type('string') winner: string = '';

    // Scores
    @type('number') scoreBlack:  number = 0;
    @type('number') scoreWhite:  number = 0;
    @type('number') scoreRed:    number = 0;

    // '' | sessionId of player who pocketed red and must cover next turn
    @type('string') queenPendingBy: string = '';

    @type({ map: CoinState })   coins   = new MapSchema<CoinState>();
    @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
