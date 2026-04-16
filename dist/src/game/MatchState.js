"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coinKindForSide = coinKindForSide;
exports.opponentSide = opponentSide;
function coinKindForSide(side) {
    return side === 'bottom' ? 'black' : 'white';
}
function opponentSide(side) {
    return side === 'bottom' ? 'top' : 'bottom';
}
