(function initMakeShiftGame(root, factory) {
  const api = factory();
  if (root) root.MakeShiftGame = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this, function createMakeShiftGame() {
  const EMPTY = 0;
  const BLUE = 1;
  const RED = 2;
  const HOLE = 3;
  const PLAYERS = [
    { id: 0, name: "Ivory", className: "ivory", stone: BLUE },
    { id: 1, name: "Madder", className: "madder", stone: RED }
  ];
  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  const CELL_NAMES = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
  const CELL_COORDS = ["a3", "b3", "c3", "a2", "b2", "c2", "a1", "b1", "c1"];
  const DIRS = [
    { dr: -1, dc: 0, label: "up" },
    { dr: 1, dc: 0, label: "down" },
    { dr: 0, dc: -1, label: "left" },
    { dr: 0, dc: 1, label: "right" }
  ];
  const OPPOSITE_LABELS = {
    up: "down",
    down: "up",
    left: "right",
    right: "left"
  };

  function freshGame(turn = 0) {
    return {
      cells: [EMPTY, EMPTY, EMPTY, EMPTY, HOLE, EMPTY, EMPTY, EMPTY, EMPTY],
      turn,
      left: [3, 3],
      ban: -1
    };
  }

  function cloneGame(game) {
    return {
      cells: game.cells.slice(),
      turn: game.turn,
      left: game.left.slice(),
      ban: game.ban
    };
  }

  function rowCol(index) {
    return [Math.floor(index / 3), index % 3];
  }

  function indexOf(row, col) {
    if (row < 0 || row > 2 || col < 0 || col > 2) return -1;
    return row * 3 + col;
  }

  function neighbor(index, dir) {
    const [row, col] = rowCol(index);
    return indexOf(row + dir.dr, col + dir.dc);
  }

  function findHole(cells) {
    return cells.indexOf(HOLE);
  }

  function stoneForPlayer(player) {
    return player === 0 ? BLUE : RED;
  }

  function cellOwner(cell) {
    if (cell === BLUE) return 0;
    if (cell === RED) return 1;
    return -1;
  }

  function findWin(cells, player) {
    const stone = stoneForPlayer(player);
    return WIN_LINES.find(line => line.every(index => cells[index] === stone)) || null;
  }

  function encodePushBan(oldHole, newHole, length) {
    return ((oldHole * 9 + newHole) * 2) + (length - 1);
  }

  function decodePushBan(code) {
    if (code < 0) return null;
    const length = (code % 2) + 1;
    const pair = Math.floor(code / 2);
    return { oldHole: Math.floor(pair / 9), newHole: pair % 9, length };
  }

  function keyOfGame(game) {
    let boardCode = 0;
    for (const cell of game.cells) boardCode = boardCode * 4 + cell;
    return `${game.turn}${game.left[0]}${game.left[1]}${(game.ban + 1).toString(36).padStart(2, "0")}${boardCode.toString(36).padStart(5, "0")}`;
  }

  function keyToCode(key) {
    const turn = Number(key[0]);
    const left0 = Number(key[1]);
    const left1 = Number(key[2]);
    const ban = parseInt(key.slice(3, 5), 36);
    const board = parseInt(key.slice(5), 36);
    return (((((turn * 4 + left0) * 4 + left1) * 163 + ban) * 262144) + board);
  }

  function switchAfter(after, ban) {
    after.turn = 1 - after.turn;
    after.ban = ban;
    return after;
  }

  function actionResult(game, after, desc, detail) {
    const line = findWin(after.cells, game.turn);
    if (line) return { type: "W", desc, detail, after, line };
    return { type: "S", desc, detail, after: switchAfter(after, detail.nextBan ?? -1) };
  }

  function legalActions(game) {
    const actions = [];
    const player = game.turn;
    const stone = stoneForPlayer(player);

    if (game.left[player] > 0) {
      for (let index = 0; index < 9; index += 1) {
        if (game.cells[index] !== EMPTY) continue;
        const after = cloneGame(game);
        after.cells[index] = stone;
        after.left[player] -= 1;
        actions.push(actionResult(game, after, `place ${CELL_COORDS[index]}`, {
          kind: "place",
          to: index,
          nextBan: -1
        }));
      }
    }

    for (let from = 0; from < 9; from += 1) {
      if (game.cells[from] !== stone) continue;
      for (let to = 0; to < 9; to += 1) {
        if (game.cells[to] !== EMPTY) continue;
        const after = cloneGame(game);
        after.cells[from] = EMPTY;
        after.cells[to] = stone;
        actions.push(actionResult(game, after, `${CELL_COORDS[from]} -> ${CELL_COORDS[to]}`, {
          kind: "move",
          from,
          to,
          nextBan: -1
        }));
      }
    }

    const hole = findHole(game.cells);
    for (const dir of DIRS) {
      const slideLabel = OPPOSITE_LABELS[dir.label];
      const first = neighbor(hole, dir);
      if (first < 0 || game.cells[first] === HOLE) continue;
      const singleBan = encodePushBan(hole, first, 1);
      if (game.ban !== singleBan) {
        const after = cloneGame(game);
        after.cells[hole] = after.cells[first];
        after.cells[first] = HOLE;
      actions.push(actionResult(game, after, `push ${CELL_COORDS[first]} ${slideLabel}`, {
        kind: "push",
        from: first,
        target: first,
        hole,
        newHole: first,
        length: 1,
          nextBan: encodePushBan(first, hole, 1)
        }));
      }

      const second = neighbor(first, dir);
      if (second < 0 || game.cells[second] === HOLE) continue;
      const [holeRow, holeCol] = rowCol(hole);
      const isEdgeHole = holeRow === 0 || holeRow === 2 || holeCol === 0 || holeCol === 2;
      if (!isEdgeHole) continue;
      const doubleBan = encodePushBan(hole, second, 2);
      if (game.ban === doubleBan) continue;
      const after = cloneGame(game);
      after.cells[hole] = after.cells[first];
      after.cells[first] = after.cells[second];
      after.cells[second] = HOLE;
      actions.push(actionResult(game, after, `push ${CELL_COORDS[second]}+${CELL_COORDS[first]} ${slideLabel}`, {
        kind: "push",
        from: first,
        second,
        target: second,
        hole,
        newHole: second,
        length: 2,
        nextBan: encodePushBan(second, hole, 2)
      }));
    }

    return actions;
  }

  function outcomeText(value) {
    if (value > 0) return "Winning";
    if (value < 0) return "Losing";
    return "Drawing";
  }

  function playerName(player) {
    return PLAYERS[player].name;
  }

  return {
    EMPTY,
    BLUE,
    RED,
    HOLE,
    PLAYERS,
    WIN_LINES,
    CELL_NAMES,
    CELL_COORDS,
    freshGame,
    cloneGame,
    rowCol,
    indexOf,
    findHole,
    findWin,
    legalActions,
    keyOfGame,
    keyToCode,
    decodePushBan,
    outcomeText,
    playerName
  };
});
