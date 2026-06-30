import "./game.js";

const {
  EMPTY,
  BLUE,
  RED,
  HOLE,
  PLAYERS,
  CELL_COORDS,
  freshGame,
  findHole,
  findWin,
  legalActions,
  keyOfGame,
  keyToCode,
  outcomeText,
  playerName
} = window.MakeShiftGame;

const boardEl = document.getElementById("board");
const cellLayerEl = document.getElementById("cellLayer");
const headlineEl = document.getElementById("headline");
const sublineEl = document.getElementById("subline");
const placeBtn = document.getElementById("placeBtn");
const moveBtn = document.getElementById("moveBtn");
const pushBtn = document.getElementById("pushBtn");
const playFirstBtn = document.getElementById("playFirstBtn");
const playSecondBtn = document.getElementById("playSecondBtn");
const solutionHeadlineEl = document.getElementById("solutionHeadline");
const solutionBestEl = document.getElementById("solutionBest");
const solutionDetailEl = document.getElementById("solutionDetail");
const solutionChoicesTitleEl = document.getElementById("solutionChoicesTitle");
const solutionTableEl = document.getElementById("solutionTable");

let state = freshUiState(0);
let humanPlayer = 0;
let aiPlayer = 1;
let mode = null;
let selected = null;
let winner = null;
let winningLine = null;
let tablebase = null;
let tablebaseReady = Boolean(window.MAKE_SHIFT_TABLEBASE);
let statusMessage = "";
let gameToken = 0;
let aiThinking = false;
let movementAnimations = [];
let placementAnimations = [];
let activeAnimations = 0;

function freshUiState(turn) {
  return {
    game: freshGame(turn)
  };
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readVarint(bytes, cursor) {
  let value = 0;
  let shift = 1;
  let index = cursor;
  while (index < bytes.length) {
    const byte = bytes[index];
    index += 1;
    value += (byte & 127) * shift;
    if (byte < 128) return [value, index];
    shift *= 128;
  }
  throw new Error("Invalid tablebase-data.js");
}

function getTablebase() {
  if (tablebase) return tablebase;
  if (!window.MAKE_SHIFT_TABLEBASE?.evaluationPacked) throw new Error("Missing tablebase-data.js");
  const bytes = decodeBase64(window.MAKE_SHIFT_TABLEBASE.evaluationPacked);
  const evaluation = new Map();
  let cursor = 0;
  let code = 0;
  while (cursor < bytes.length) {
    let delta;
    [delta, cursor] = readVarint(bytes, cursor);
    code += delta;
    let info;
    [info, cursor] = readVarint(bytes, cursor);
    const policy = info % 64;
    const packed = Math.floor(info / 64);
    const value = (packed % 3) - 1;
    const dtm = Math.floor(packed / 3);
    evaluation.set(code, { value, dtm, policy });
  }
  tablebase = { evaluation };
  return tablebase;
}

function evaluateGame(game) {
  if (!tablebaseReady) return null;
  return getTablebase().evaluation.get(keyToCode(keyOfGame(game))) || null;
}

function rankedActions(game) {
  const actions = legalActions(game);
  return actions.map((action, order) => {
    const score = action.type === "W" ? 1 : -(evaluateGame(action.after)?.value || 0);
    const dtm = action.type === "W" ? 1 : (evaluateGame(action.after)?.dtm || 0) + (score === 0 ? 0 : 1);
    return { action, order, score, dtm };
  }).sort((a, b) => b.score - a.score || compareDtm(a, b) || a.order - b.order);
}

function compareDtm(a, b) {
  if (a.score === 1) return a.dtm - b.dtm;
  if (a.score === -1) return b.dtm - a.dtm;
  return 0;
}

function isHumanTurn() {
  return state.game.turn === humanPlayer && !winner;
}

function isBusy() {
  return aiThinking || activeAnimations > 0 || !isHumanTurn();
}

function startNewGame(nextHumanPlayer) {
  humanPlayer = nextHumanPlayer;
  aiPlayer = 1 - humanPlayer;
  state = freshUiState(0);
  mode = null;
  selected = null;
  winner = null;
  winningLine = null;
  statusMessage = "";
  aiThinking = false;
  gameToken += 1;
  render();
  maybeRunAi();
}

function finishAction(action) {
  mode = null;
  selected = null;
  if (action.type === "W") {
    winner = state.game.turn;
    winningLine = action.line;
    state.game = action.after;
  } else {
    state.game = action.after;
  }
  render();
  maybeRunAi();
}

function applyAction(action) {
  queueActionAnimation(action);
  finishAction(action);
}

function queueActionAnimation(action) {
  const detail = action.detail;
  movementAnimations = [];
  placementAnimations = [];
  if (detail.kind === "move") {
    queueMovementGhost(detail.from, detail.to, ".stone", 180);
  } else if (detail.kind === "push") {
    queueMovementGhost(detail.from, detail.hole, ".push-stone", 180);
    if (detail.length === 2) {
      queueMovementGhost(detail.second, detail.from, ".push-stone", 180);
    }
  } else if (detail.kind === "place") {
    placementAnimations.push({ to: detail.to, selector: ".stone" });
  }
}

function queueMovementGhost(from, to, selector, duration) {
  const fromCell = cellLayerEl.querySelector(`.cell[data-index="${from}"]`);
  const source = fromCell?.querySelector(selector);
  if (!source) return;
  movementAnimations.push({
    to,
    selector,
    duration,
    ghost: source.cloneNode(true),
    fromRect: source.getBoundingClientRect()
  });
}

function setMode(nextMode) {
  if (isBusy()) return;
  mode = nextMode;
  selected = null;
  statusMessage = "";
  render();
}

function matchingActionForCell(index) {
  const actions = legalActions(state.game);
  if (mode === "place") {
    return actions.find(action => action.detail.kind === "place" && action.detail.to === index);
  }
  if (mode === "move") {
    if (selected === null) return null;
    return actions.find(action => action.detail.kind === "move" && action.detail.from === selected && action.detail.to === index);
  }
  if (mode === "push") {
    return actions.find(action => action.detail.kind === "push" && (action.detail.target ?? action.detail.from) === index);
  }
  return null;
}

function legalTargetsForMode() {
  if (!mode) return [];
  const actions = legalActions(state.game);
  if (mode === "place") return actions.filter(action => action.detail.kind === "place").map(action => action.detail.to);
  if (mode === "push") return actions.filter(action => action.detail.kind === "push").map(action => action.detail.target ?? action.detail.from);
  if (mode === "move" && selected !== null) {
    return actions.filter(action => action.detail.kind === "move" && action.detail.from === selected).map(action => action.detail.to);
  }
  return [];
}

function handleCellClick(index) {
  if (isBusy()) return;
  const cell = state.game.cells[index];
  if (mode === "move" && selected === null) {
    if (cell === PLAYERS[state.game.turn].stone) {
      selected = index;
      statusMessage = `Move ${CELL_COORDS[index]} to an empty push-stone.`;
    } else {
      statusMessage = "Choose one of your stones first.";
    }
    render();
    return;
  }
  const action = matchingActionForCell(index);
  if (!action) {
    statusMessage = mode ? "That square is not legal for this action." : "Choose Place, Move, or Push first.";
    render();
    return;
  }
  applyAction(action);
}

function chooseAiAction() {
  const actions = legalActions(state.game);
  const evaluation = evaluateGame(state.game);
  if (evaluation && actions[evaluation.policy]) return actions[evaluation.policy];
  const ranked = rankedActions(state.game);
  return ranked[0]?.action || actions[0];
}

function maybeRunAi() {
  if (activeAnimations > 0) {
    window.setTimeout(maybeRunAi, 40);
    return;
  }
  if (winner || state.game.turn !== aiPlayer || aiThinking) return;
  const token = gameToken;
  aiThinking = true;
  render();
  window.setTimeout(() => {
    if (token !== gameToken || winner || state.game.turn !== aiPlayer) return;
    aiThinking = false;
    const action = chooseAiAction();
    if (!action) {
      statusMessage = "AI has no legal move.";
      render();
      return;
    }
    applyAction(action);
  }, 260);
}

function renderRuleBoard(name, setup) {
  const board = document.querySelector(`[data-rule-board="${name}"]`);
  if (!board) return;
  board.innerHTML = "";
  for (let index = 0; index < 9; index += 1) {
    const cell = document.createElement("span");
    const value = setup.cells[index];
    if (value === HOLE) cell.classList.add("hole");
    if (setup.highlight?.includes(index)) cell.classList.add("rule-highlight");
    if (value !== HOLE) {
      const push = document.createElement("i");
      push.className = "push-stone";
      if (value === BLUE || value === RED) {
        const stone = document.createElement("b");
        stone.className = `stone ${value === BLUE ? PLAYERS[0].className : PLAYERS[1].className}`;
        push.append(stone);
      }
      cell.append(push);
    }
    board.append(cell);
  }
  for (const arrow of setup.arrows || []) {
    const marker = document.createElement("i");
    marker.className = `rule-arrow ${arrow}`;
    board.append(marker);
  }
}

function renderRuleBoards() {
  renderRuleBoard("setup", {
    cells: [EMPTY, EMPTY, EMPTY, EMPTY, HOLE, EMPTY, EMPTY, EMPTY, EMPTY]
  });
  renderRuleBoard("single-push", {
    cells: [EMPTY, EMPTY, EMPTY, EMPTY, HOLE, BLUE, EMPTY, EMPTY, EMPTY],
    highlight: [5],
    arrows: ["from-right"]
  });
  renderRuleBoard("double-push", {
    cells: [EMPTY, RED, HOLE, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    highlight: [0],
    arrows: ["double-left"]
  });
  renderRuleBoard("no-reverse", {
    cells: [EMPTY, EMPTY, EMPTY, EMPTY, RED, HOLE, EMPTY, EMPTY, EMPTY],
    highlight: [4, 5],
    arrows: ["blocked-back"]
  });
}

function drawCoords(index) {
  return `<span class="cell-coord">${CELL_COORDS[index]}</span>`;
}

function renderBoard() {
  cellLayerEl.innerHTML = "";
  const legal = legalTargetsForMode();
  const hole = findHole(state.game.cells);
  for (let index = 0; index < 9; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", CELL_COORDS[index]);
    if (index === hole) button.classList.add("hole");
    if (legal.includes(index)) button.classList.add("legal");
    if (index === selected) button.classList.add("selected");
    if (winningLine?.includes(index)) button.classList.add("winning");
    button.addEventListener("click", () => handleCellClick(index));

    button.insertAdjacentHTML("beforeend", drawCoords(index));

    const value = state.game.cells[index];
    if (value !== HOLE) {
      const push = document.createElement("span");
      push.className = "push-stone";
      if (value === BLUE || value === RED) {
        const stone = document.createElement("span");
        stone.className = `stone ${value === BLUE ? PLAYERS[0].className : PLAYERS[1].className}`;
        push.append(stone);
      }
      button.append(push);
    }
    cellLayerEl.append(button);
  }
  applyMovementAnimations();
  applyPlacementAnimations();
  movementAnimations = [];
  placementAnimations = [];
}

function finishAnimatedElement(element) {
  activeAnimations += 1;
  element.addEventListener("animationend", () => {
    activeAnimations = Math.max(0, activeAnimations - 1);
    renderStatus();
  }, { once: true });
}

function applyPlacementAnimations() {
  for (const { to, selector } of placementAnimations) {
    const toCell = cellLayerEl.querySelector(`.cell[data-index="${to}"]`);
    const target = toCell?.querySelector(selector);
    if (!target) continue;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
    finishAnimatedElement(target);
    target.classList.add("place-in");
  }
}

function applyMovementAnimations() {
  for (const { to, selector, duration, ghost, fromRect } of movementAnimations) {
    const toCell = cellLayerEl.querySelector(`.cell[data-index="${to}"]`);
    const target = toCell?.querySelector(selector);
    if (!target || !ghost) continue;
    const toRect = target.getBoundingClientRect();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) continue;
    target.classList.add("movement-target-hidden");
    ghost.classList.add("movement-ghost");
    ghost.style.left = `${fromRect.left}px`;
    ghost.style.top = `${fromRect.top}px`;
    ghost.style.width = `${fromRect.width}px`;
    ghost.style.height = `${fromRect.height}px`;
    document.body.append(ghost);
    activeAnimations += 1;
    ghost.animate([
      { transform: "translate(0, 0)" },
      { transform: `translate(${toRect.left - fromRect.left}px, ${toRect.top - fromRect.top}px)` }
    ], {
      duration,
      easing: "ease-out",
      fill: "forwards"
    }).finished.finally(() => {
      ghost.remove();
      target.classList.remove("movement-target-hidden");
      activeAnimations = Math.max(0, activeAnimations - 1);
      renderStatus();
    });
  }
}

function renderStatus() {
  const player = playerName(state.game.turn);
  if (winner !== null) {
    headlineEl.textContent = `${playerName(winner)} wins`;
    sublineEl.textContent = "Start a new game to play again.";
  } else if (aiThinking) {
    headlineEl.textContent = `${player} to move`;
    sublineEl.textContent = "AI is choosing from the solved tablebase.";
  } else if (!isHumanTurn()) {
    headlineEl.textContent = `${player} to move`;
    sublineEl.textContent = "Waiting for AI.";
  } else {
    headlineEl.textContent = `${player} to move`;
    if (statusMessage) sublineEl.textContent = statusMessage;
    else if (mode === "place") sublineEl.textContent = "Place a stone on an empty black push-stone.";
    else if (mode === "move" && selected === null) sublineEl.textContent = "Choose one of your stones.";
    else if (mode === "move") sublineEl.textContent = "Choose an empty black push-stone.";
    else if (mode === "push") sublineEl.textContent = "Choose a black push-stone that can slide into the empty space.";
    else sublineEl.textContent = "Choose Place, Move, or Push.";
  }
  placeBtn.disabled = isBusy() || state.game.left[state.game.turn] === 0;
  moveBtn.disabled = isBusy();
  pushBtn.disabled = isBusy();
  placeBtn.classList.toggle("active", mode === "place");
  moveBtn.classList.toggle("active", mode === "move");
  pushBtn.classList.toggle("active", mode === "push");
  playFirstBtn.setAttribute("aria-pressed", String(humanPlayer === 0));
  playSecondBtn.setAttribute("aria-pressed", String(humanPlayer === 1));
}

function resultText(item) {
  if (item.score === 1) return `Wins in ${item.dtm}`;
  if (item.score === -1) return `Loses in ${item.dtm}`;
  return "Draws";
}

function renderSolutionTable(items) {
  const rows = items.map(item => `
    <div class="solution-row" role="row">
      <span class="solution-move" role="cell">${item.action.desc}</span>
      <span class="solution-result" role="cell">${resultText(item)}</span>
    </div>
  `).join("");
  solutionTableEl.innerHTML = `
    <div class="solution-row solution-head" role="row">
      <span class="solution-move" role="columnheader">Move</span>
      <span class="solution-result" role="columnheader">Result</span>
    </div>
    ${rows || '<div class="solution-empty">No legal moves.</div>'}
  `;
}

function renderSolution() {
  if (!tablebaseReady) {
    solutionHeadlineEl.textContent = "Tablebase unavailable";
    solutionBestEl.textContent = "Best move: --";
    solutionDetailEl.textContent = "Run npm run generate-tablebase, then reload.";
    renderSolutionTable([]);
    return;
  }
  const game = state.game;
  const evaluation = evaluateGame(game);
  const actions = rankedActions(game);
  if (!evaluation) {
    solutionHeadlineEl.textContent = "Solved position";
    solutionBestEl.textContent = "Best move: --";
    solutionDetailEl.textContent = "This position is outside the generated tablebase.";
    renderSolutionTable([]);
    return;
  }
  const player = playerName(game.turn);
  const best = actions.find(item => item.order === evaluation.policy) || actions[0];
  const opponent = playerName(1 - game.turn);
  const isInitial = keyOfGame(game) === keyOfGame(freshGame(0));
  if (evaluation.value === 1) {
    solutionHeadlineEl.textContent = isInitial ? `${player} wins with perfect play` : `${player} is winning`;
    solutionBestEl.textContent = best ? `Best move: ${best.action.desc}` : "Best move: --";
    solutionDetailEl.textContent = best ? `Wins in ${best.dtm}.` : "Forced win.";
  } else if (evaluation.value === -1) {
    solutionHeadlineEl.textContent = isInitial ? `${opponent} wins with perfect play` : `${opponent} is winning`;
    solutionBestEl.textContent = best ? `Best defense: ${best.action.desc}` : "Best defense: --";
    solutionDetailEl.textContent = best ? `Best defense loses in ${best.dtm}.` : "Forced loss.";
  } else {
    solutionHeadlineEl.textContent = "Drawn with perfect play";
    solutionBestEl.textContent = best ? `Best move: ${best.action.desc}` : "Best move: --";
    solutionDetailEl.textContent = "No forced win.";
  }
  solutionChoicesTitleEl.textContent = "Legal moves";
  renderSolutionTable(actions);
}

function render() {
  renderBoard();
  renderStatus();
  renderSolution();
}

placeBtn.addEventListener("click", () => setMode("place"));
moveBtn.addEventListener("click", () => setMode("move"));
pushBtn.addEventListener("click", () => setMode("push"));
playFirstBtn.addEventListener("click", () => startNewGame(0));
playSecondBtn.addEventListener("click", () => startNewGame(1));

try {
  if (tablebaseReady) getTablebase();
} catch (error) {
  tablebaseReady = false;
  statusMessage = error.message;
}

renderRuleBoards();
render();
maybeRunAi();
