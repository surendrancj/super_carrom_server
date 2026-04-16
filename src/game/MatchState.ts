export type PlayerSide = 'bottom' | 'top';
export type CoinKind = 'black' | 'white' | 'red';
export type MatchPhase = 'waiting' | 'playing' | 'gameover';
export type QueenStatus = 'on_board' | 'pending_cover' | 'covered';

export interface MatchPlayer {
    sessionId: string;
    side: PlayerSide;
    coinKind: Exclude<CoinKind, 'red'>;
    connected: boolean;
    ready: boolean;
}

export interface MatchCoin {
    id: string;
    kind: CoinKind;
    x: number;
    y: number;
    active: boolean;
}

export interface MatchState {
    phase: MatchPhase;
    turn: string;
    turnSide: PlayerSide;
    players: Partial<Record<PlayerSide, MatchPlayer>>;
    coins: Record<string, MatchCoin>;
    scores: {
        black: number;
        white: number;
        red: number;
    };
    queen: {
        status: QueenStatus;
        pendingCoverBy: PlayerSide | null;
        coveredBy: PlayerSide | null;
    };
    scoredCoins: Record<PlayerSide, string[]>;
    lastShot: ShotResult | null;
    winner: PlayerSide | null;
    endReason: 'coins' | 'resign' | 'disconnect' | null;
}

export interface ShotInput {
    firedBy: PlayerSide;
    pottedCoinIds: string[];
    strikerFoul: boolean;
}

export interface ShotResult {
    firedBy: PlayerSide;
    pottedCoinIds: string[];
    ownPottedIds: string[];
    opponentPottedIds: string[];
    redPotted: boolean;
    strikerFoul: boolean;
    extraTurn: boolean;
    nextTurnSide: PlayerSide;
    reviveCoinIds: string[];
    scoreDelta: {
        black: number;
        white: number;
        red: number;
    };
    queenEvent: 'none' | 'pocketed' | 'covered' | 'returned' | 'foul_returned';
    winner: PlayerSide | null;
}

export function coinKindForSide(side: PlayerSide): Exclude<CoinKind, 'red'> {
    return side === 'bottom' ? 'black' : 'white';
}

export function opponentSide(side: PlayerSide): PlayerSide {
    return side === 'bottom' ? 'top' : 'bottom';
}
