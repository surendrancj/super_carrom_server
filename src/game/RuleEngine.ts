import {
    MatchCoin,
    MatchPlayer,
    MatchState,
    PlayerSide,
    ShotInput,
    ShotResult,
    coinKindForSide,
    opponentSide,
} from './MatchState';

const EMPTY_SCORE_DELTA = { black: 0, white: 0, red: 0 };

export function createMatchState(coins: MatchCoin[]): MatchState {
    const coinMap: Record<string, MatchCoin> = {};
    for (const coin of coins) {
        coinMap[coin.id] = { ...coin };
    }

    return {
        phase: 'waiting',
        turn: '',
        turnSide: 'bottom',
        players: {},
        coins: coinMap,
        scores: { black: 0, white: 0, red: 0 },
        queen: {
            status: 'on_board',
            pendingCoverBy: null,
            coveredBy: null,
        },
        scoredCoins: {
            bottom: [],
            top: [],
        },
        lastShot: null,
        winner: null,
        endReason: null,
    };
}

export function setPlayer(state: MatchState, player: MatchPlayer): MatchState {
    return {
        ...state,
        players: {
            ...state.players,
            [player.side]: { ...player },
        },
    };
}

export function setPlayerReady(state: MatchState, sessionId: string): MatchState {
    const players = { ...state.players };
    for (const side of Object.keys(players) as PlayerSide[]) {
        const player = players[side];
        if (player?.sessionId === sessionId) {
            players[side] = { ...player, ready: true };
        }
    }
    return { ...state, players };
}

export function startMatch(state: MatchState): MatchState {
    const first = state.players.bottom;
    return {
        ...state,
        phase: 'playing',
        turnSide: 'bottom',
        turn: first?.sessionId ?? '',
    };
}

export function syncCoinPositions(
    state: MatchState,
    coins: Record<string, { x: number; y: number; active: boolean }>,
): MatchState {
    const nextCoins = { ...state.coins };
    for (const [id, update] of Object.entries(coins)) {
        const current = nextCoins[id];
        if (!current) continue;
        nextCoins[id] = {
            ...current,
            x: update.x,
            y: update.y,
            active: update.active,
        };
    }
    return { ...state, coins: nextCoins };
}

export function resolveShot(state: MatchState, input: ShotInput): MatchState {
    const firedBy = input.firedBy;
    const opponent = opponentSide(firedBy);
    const ownKind = coinKindForSide(firedBy);
    const opponentKind = coinKindForSide(opponent);
    const pottedCoinIds = unique(input.pottedCoinIds).filter(id => !!state.coins[id]);
    const ownPottedIds = pottedCoinIds.filter(id => state.coins[id].kind === ownKind);
    const opponentPottedIds = pottedCoinIds.filter(id => state.coins[id].kind === opponentKind);
    const redPotted = pottedCoinIds.some(id => state.coins[id].kind === 'red');

    if (input.strikerFoul) {
        return resolveFoul(state, {
            firedBy,
            pottedCoinIds,
            ownPottedIds,
            opponentPottedIds,
            redPotted,
        });
    }

    const coins = { ...state.coins };
    const scores = { ...state.scores };
    const scoredCoins = {
        bottom: [...state.scoredCoins.bottom],
        top: [...state.scoredCoins.top],
    };
    const queen = { ...state.queen };
    const reviveCoinIds: string[] = [];
    const scoreDelta = { ...EMPTY_SCORE_DELTA };
    let queenEvent: ShotResult['queenEvent'] = 'none';

    for (const id of opponentPottedIds) {
        scores[opponentKind]++;
        scoreDelta[opponentKind]++;
        scoredCoins[opponent].push(id);
    }

    if (!redPotted && queen.pendingCoverBy === firedBy) {
        if (ownPottedIds.length > 0) {
            scores.red++;
            scoreDelta.red++;
            queen.status = 'covered';
            queen.coveredBy = firedBy;
            queenEvent = 'covered';
        } else {
            reviveCoinIds.push('red');
            queen.status = 'on_board';
            queenEvent = 'returned';
        }
        queen.pendingCoverBy = null;
    }

    if (redPotted) {
        if (opponentPottedIds.length > 0) {
            reviveCoinIds.push('red');
            queen.status = 'on_board';
            queen.pendingCoverBy = null;
            queenEvent = 'returned';
        } else if (ownPottedIds.length > 0) {
            scores.red++;
            scoreDelta.red++;
            queen.status = 'covered';
            queen.coveredBy = firedBy;
            queen.pendingCoverBy = null;
            queenEvent = 'covered';
        } else {
            queen.status = 'pending_cover';
            queen.pendingCoverBy = firedBy;
            queenEvent = 'pocketed';
        }
    }

    for (const id of ownPottedIds) {
        scores[ownKind]++;
        scoreDelta[ownKind]++;
        scoredCoins[firedBy].push(id);
    }

    for (const id of reviveCoinIds) {
        const coin = coins[id];
        if (coin) coins[id] = { ...coin, active: true };
    }

    const extraTurn = (ownPottedIds.length > 0 || redPotted) && opponentPottedIds.length === 0;
    const nextTurnSide = extraTurn ? firedBy : opponent;
    const winner = getWinner({ ...state, coins, scores, queen });

    const result: ShotResult = {
        firedBy,
        pottedCoinIds,
        ownPottedIds,
        opponentPottedIds,
        redPotted,
        strikerFoul: false,
        extraTurn,
        nextTurnSide,
        reviveCoinIds,
        scoreDelta,
        queenEvent,
        winner,
    };

    return {
        ...state,
        phase: winner ? 'gameover' : 'playing',
        turnSide: nextTurnSide,
        turn: state.players[nextTurnSide]?.sessionId ?? state.turn,
        coins,
        scores,
        queen,
        scoredCoins,
        lastShot: result,
        winner,
        endReason: winner ? 'coins' : null,
    };
}

function resolveFoul(
    state: MatchState,
    input: Pick<ShotInput, 'firedBy'> & {
        pottedCoinIds: string[];
        ownPottedIds: string[];
        opponentPottedIds: string[];
        redPotted: boolean;
    },
): MatchState {
    const firedBy = input.firedBy;
    const opponent = opponentSide(firedBy);
    const ownKind = coinKindForSide(firedBy);
    const coins = { ...state.coins };
    const scores = { ...state.scores };
    const scoredCoins = {
        bottom: [...state.scoredCoins.bottom],
        top: [...state.scoredCoins.top],
    };
    const queen = { ...state.queen };
    const reviveCoinIds = [...input.pottedCoinIds];
    const scoreDelta = { ...EMPTY_SCORE_DELTA };

    if (queen.pendingCoverBy === firedBy && !reviveCoinIds.includes('red')) {
        reviveCoinIds.push('red');
    }

    const penaltyCoinId = scoredCoins[firedBy].pop();
    if (penaltyCoinId) {
        reviveCoinIds.push(penaltyCoinId);
        scores[ownKind] = Math.max(0, scores[ownKind] - 1);
        scoreDelta[ownKind]--;
    }

    for (const id of unique(reviveCoinIds)) {
        const coin = coins[id];
        if (coin) coins[id] = { ...coin, active: true };
    }

    queen.status = queen.coveredBy ? 'covered' : 'on_board';
    queen.pendingCoverBy = null;

    const nextTurnSide = opponent;
    const result: ShotResult = {
        firedBy,
        pottedCoinIds: input.pottedCoinIds,
        ownPottedIds: input.ownPottedIds,
        opponentPottedIds: input.opponentPottedIds,
        redPotted: input.redPotted,
        strikerFoul: true,
        extraTurn: false,
        nextTurnSide,
        reviveCoinIds: unique(reviveCoinIds),
        scoreDelta,
        queenEvent: 'foul_returned',
        winner: null,
    };

    return {
        ...state,
        phase: 'playing',
        turnSide: nextTurnSide,
        turn: state.players[nextTurnSide]?.sessionId ?? state.turn,
        coins,
        scores,
        queen,
        scoredCoins,
        lastShot: result,
        winner: null,
        endReason: null,
    };
}

function getWinner(state: MatchState): PlayerSide | null {
    for (const side of ['bottom', 'top'] as PlayerSide[]) {
        const ownKind = coinKindForSide(side);
        const ownCoinsLeft = Object.values(state.coins)
            .filter(coin => coin.kind === ownKind && coin.active)
            .length;

        if (ownCoinsLeft === 0 && state.queen.coveredBy === side) {
            return side;
        }
    }
    return null;
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}
