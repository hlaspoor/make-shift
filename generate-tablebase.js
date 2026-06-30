const fs = require("node:fs");
const path = require("node:path");
const Game = require("./src/game.js");

function chooseBestAction(actions, value, dtm) {
  const ranked = actions.map((action, order) => {
    const score = action.type === "W" ? 1 : -(value.get(action.nextKey) || 0);
    const storedDtm = action.type === "W" ? 0 : dtm.get(action.nextKey) || 0;
    const distance = score === 0 ? 0 : storedDtm + 1;
    return { action, score, distance, order };
  });
  const wins = ranked.filter(item => item.score === 1);
  if (wins.length) return wins.sort((a, b) => a.distance - b.distance || a.order - b.order)[0].order;
  const draws = ranked.filter(item => item.score === 0);
  if (draws.length) return draws.sort((a, b) => a.order - b.order)[0].order;
  return ranked.sort((a, b) => b.distance - a.distance || a.order - b.order)[0].order;
}

function buildGraph() {
  const initial = Game.freshGame(0);
  const queue = [initial];
  const states = new Map([[Game.keyOfGame(initial), initial]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const game = queue[cursor];
    for (const action of Game.legalActions(game)) {
      if (action.type !== "S") continue;
      const key = Game.keyOfGame(action.after);
      if (states.has(key)) continue;
      states.set(key, action.after);
      queue.push(action.after);
    }
  }

  const actionMap = new Map();
  let terminalActions = 0;
  let maxLegalMoves = 0;
  for (const [key, game] of states) {
    const actions = Game.legalActions(game).map(action => {
      if (action.type === "S") return { ...action, nextKey: Game.keyOfGame(action.after) };
      terminalActions += 1;
      return action;
    });
    maxLegalMoves = Math.max(maxLegalMoves, actions.length);
    actionMap.set(key, actions);
  }
  return { initialKey: Game.keyOfGame(initial), states, actionMap, terminalActions, maxLegalMoves };
}

function solve(actionMap) {
  const value = new Map();
  const dtm = new Map();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [key, actions] of actionMap) {
      if (value.has(key)) continue;
      let bestWin = Infinity;
      for (const action of actions) {
        if (action.type === "W") bestWin = Math.min(bestWin, 1);
        else if (value.get(action.nextKey) === -1 && dtm.has(action.nextKey)) {
          bestWin = Math.min(bestWin, 1 + dtm.get(action.nextKey));
        }
      }
      if (bestWin < Infinity) {
        value.set(key, 1);
        dtm.set(key, bestWin);
        changed = true;
        continue;
      }

      let forcedLoss = actions.length > 0;
      let worstLoss = 0;
      for (const action of actions) {
        if (action.type === "W" || value.get(action.nextKey) !== 1 || !dtm.has(action.nextKey)) {
          forcedLoss = false;
          break;
        }
        worstLoss = Math.max(worstLoss, 1 + dtm.get(action.nextKey));
      }
      if (forcedLoss) {
        value.set(key, -1);
        dtm.set(key, worstLoss);
        changed = true;
      }
    }
  }

  for (const key of actionMap.keys()) {
    if (!value.has(key)) {
      value.set(key, 0);
      dtm.set(key, 0);
    }
  }
  return { value, dtm };
}

function pushVarint(bytes, value) {
  let remaining = value;
  while (remaining >= 128) {
    bytes.push((remaining & 127) | 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
}

function packEvaluation(actionMap, value, dtm) {
  const records = Array.from(actionMap.keys(), key => {
    const outcome = value.get(key);
    const distance = dtm.get(key) || 0;
    const actions = actionMap.get(key);
    const policy = chooseBestAction(actions, value, dtm);
    if (policy > 63) throw new Error(`Policy index too large for ${key}: ${policy}`);
    const info = (((distance * 3) + (outcome + 1)) * 64) + policy;
    return [Game.keyToCode(key), info];
  }).sort((a, b) => a[0] - b[0]);

  const bytes = [];
  let previousCode = 0;
  for (const [code, info] of records) {
    pushVarint(bytes, code - previousCode);
    pushVarint(bytes, info);
    previousCode = code;
  }
  return Buffer.from(bytes).toString("base64");
}

function countValues(value) {
  const counts = { win: 0, draw: 0, loss: 0 };
  for (const outcome of value.values()) {
    if (outcome > 0) counts.win += 1;
    else if (outcome < 0) counts.loss += 1;
    else counts.draw += 1;
  }
  return counts;
}

function main() {
  const graph = buildGraph();
  const solved = solve(graph.actionMap);
  const counts = countValues(solved.value);
  const initialActions = graph.actionMap.get(graph.initialKey);
  const initialPolicy = chooseBestAction(initialActions, solved.value, solved.dtm);
  const initialValue = solved.value.get(graph.initialKey);
  const initialDtm = solved.dtm.get(graph.initialKey) || 0;

  const payload = {
    version: 1,
    evaluationPacked: packEvaluation(graph.actionMap, solved.value, solved.dtm)
  };
  const body = `self.MAKE_SHIFT_TABLEBASE=${JSON.stringify(payload)};\n`;
  fs.mkdirSync(path.join(__dirname, "public"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "public", "tablebase-data.js"), body);
  fs.writeFileSync(path.join(__dirname, "tablebase-data.js"), body);

  console.log("Wrote public/tablebase-data.js and tablebase-data.js");
  console.log(`states=${graph.states.size} terminalActions=${graph.terminalActions} maxLegalMoves=${graph.maxLegalMoves}`);
  console.log(`win=${counts.win} draw=${counts.draw} loss=${counts.loss}`);
  console.log(`initial=${Game.outcomeText(initialValue)} dtm=${initialDtm} best="${initialActions[initialPolicy].desc}"`);
  console.log(`bytes=${Buffer.byteLength(body)}`);
}

main();
