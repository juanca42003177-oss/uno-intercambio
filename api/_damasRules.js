// _damasRules.js — reglas de Damas (copia fiel de damas.js del cliente) para que el
// relay RECHACE jugadas ilegales o fuera de turno. Sin esto un tramposo podia
// mandar un log falso (borrar piezas del rival, doble turno, saltos imposibles).
function damasInitialBoard() {
  const b = new Array(32).fill(0);
  for (let i = 0; i < 12; i++) b[i] = 2;      // p2 arriba
  for (let i = 20; i < 32; i++) b[i] = 1;     // p1 abajo
  return b;
}
function sqToRC(sq) {
  const row = Math.floor(sq / 4);
  const col = (sq % 4) * 2 + ((row % 2 === 0) ? 1 : 0);
  return [row, col];
}
function rcToSq(row, col) {
  if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
  if ((row + col) % 2 === 0) return -1; // casilla clara, no jugable
  return row * 4 + Math.floor(col / 2);
}
function isP1(p) { return p === 1 || p === 3; }
function isP2(p) { return p === 2 || p === 4; }
function isKing(p) { return p === 3 || p === 4; }
function mine(p, side) { return side === 'p1' ? isP1(p) : isP2(p); }
function theirs(p, side) { return side === 'p1' ? isP2(p) : isP1(p); }

function damasSimpleMoves(board, sq, side) {
  const [r, c] = sqToRC(sq);
  const p = board[sq];
  const dirs = isKing(p) ? [-1, 1] : (side === 'p1' ? [-1] : [1]);
  const out = [];
  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const t = rcToSq(r + dr, c + dc);
      if (t >= 0 && board[t] === 0) out.push({ from: sq, to: t, captures: [] });
    }
  }
  return out;
}
function damasCaptureMoves(board, sq, side, visited) {
  const [r, c] = sqToRC(sq);
  const p = board[sq];
  const dirs = [-1, 1]; // al capturar, hasta los hombres pueden saltar hacia atras
  const results = [];
  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const midSq = rcToSq(r + dr, c + dc);
      const landSq = rcToSq(r + 2 * dr, c + 2 * dc);
      if (midSq < 0 || landSq < 0) continue;
      if (!theirs(board[midSq], side)) continue;
      if (board[landSq] !== 0) continue;
      if (visited && visited.has(midSq)) continue;
      const b2 = board.slice();
      b2[landSq] = b2[sq]; b2[sq] = 0; b2[midSq] = 0;
      const v2 = new Set(visited); v2.add(midSq);
      const further = damasCaptureMoves(b2, landSq, side, v2);
      if (further.length === 0) {
        results.push({ from: sq, to: landSq, captures: [midSq] });
      } else {
        for (const f of further) results.push({ from: sq, to: f.to, captures: [midSq, ...f.captures] });
      }
    }
  }
  return results;
}
function damasLegalMoves(board, side) {
  let caps = [];
  for (let sq = 0; sq < 32; sq++) {
    if (!mine(board[sq], side)) continue;
    caps = caps.concat(damasCaptureMoves(board, sq, side, new Set()));
  }
  if (caps.length > 0) return caps;
  let simples = [];
  for (let sq = 0; sq < 32; sq++) {
    if (!mine(board[sq], side)) continue;
    simples = simples.concat(damasSimpleMoves(board, sq, side));
  }
  return simples;
}
function damasApplyMove(board, move, side) {
  const b = board.slice();
  const piece = b[move.from];
  b[move.from] = 0;
  for (const mid of (move.captures || [])) b[mid] = 0;
  b[move.to] = piece;
  const [rowTo] = sqToRC(move.to);
  if (!isKing(piece)) {
    if (side === 'p1' && rowTo === 0) b[move.to] = 3;
    if (side === 'p2' && rowTo === 7) b[move.to] = 4;
  }
  return b;
}
function damasCountSide(board, side) {
  let n = 0;
  for (const p of board) if (mine(p, side)) n++;
  return n;
}
function damasRebuild(log) {
  let board = damasInitialBoard();
  let turn = 'p1';
  for (const entry of log) {
    if (entry.type === 'move') { board = damasApplyMove(board, entry.move, entry.by); turn = entry.by === 'p1' ? 'p2' : 'p1'; }
  }
  return { board, turn };
}



module.exports={damasInitialBoard,damasLegalMoves,damasApplyMove,damasCountSide,damasRebuild};
