const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { randomUUID } = require('crypto');

const publicDir = path.join(__dirname, 'public');
const rooms = new Map();

function normalizeRoomCode(code) {
  return (code || 'table').trim().toLowerCase();
}

const STAGES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

function createRoom(code) {
  const room = {
    code,
    players: [],
    dealerIndex: 0,
    state: {
      stage: 'waiting',
      pot: 0,
      currentBet: 0,
      community: [],
      deck: [],
      currentPlayerIndex: null,
      acted: new Set(),
      message: 'Waiting for players to join.'
    },
    connections: []
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  const normalized = normalizeRoomCode(code);
  if (!rooms.has(normalized)) {
    return createRoom(normalized);
  }
  return rooms.get(normalized);
}

function shuffleDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  suits.forEach((suit) => {
    ranks.forEach((rank) => deck.push(`${rank}${suit}`));
  });

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function activePlayers(room) {
  return room.players.filter((p) => !p.folded && p.stack > 0);
}

function cardValue(card) {
  const match = card.match(/^(10|[2-9JQKA])([♠♥♦♣])$/);
  if (!match) return null;
  const rank = match[1];
  const suit = match[2];
  const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
  return { rank: values[rank], suit, label: rank };
}

function highestStraight(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  // Wheel straight (A-2-3-4-5)
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const window = unique.slice(i, i + 5);
    const isStraight = window.every((v, idx) => idx === 0 || window[idx - 1] - v === 1);
    if (isStraight) return window[0];
  }
  return null;
}

function evaluateHand(cards) {
  const parsed = cards.map(cardValue).filter(Boolean);
  const counts = parsed.reduce((acc, c) => {
    acc.countByRank[c.rank] = (acc.countByRank[c.rank] || 0) + 1;
    acc.bySuit[c.suit] = acc.bySuit[c.suit] || [];
    acc.bySuit[c.suit].push(c.rank);
    acc.ranks.push(c.rank);
    return acc;
  }, { countByRank: {}, bySuit: {}, ranks: [] });

  const ranksDesc = [...counts.ranks].sort((a, b) => b - a);
  const flushSuit = Object.keys(counts.bySuit).find((s) => counts.bySuit[s].length >= 5);
  const straightHigh = highestStraight(ranksDesc);
  const straightFlushHigh = flushSuit ? highestStraight(counts.bySuit[flushSuit]) : null;

  const rankGroups = Object.entries(counts.countByRank)
    .map(([rank, freq]) => ({ rank: Number(rank), freq }))
    .sort((a, b) => b.freq - a.freq || b.rank - a.rank);

  const takeKickers = (exclude, limit) => ranksDesc.filter((r) => !exclude.includes(r)).slice(0, limit);

  if (straightFlushHigh) {
    return { score: [8, straightFlushHigh], name: 'Straight flush' };
  }

  if (rankGroups[0]?.freq === 4) {
    const quad = rankGroups[0].rank;
    const kicker = takeKickers([quad], 1)[0];
    return { score: [7, quad, kicker], name: 'Four of a kind' };
  }

  if (rankGroups[0]?.freq === 3 && rankGroups[1]?.freq >= 2) {
    return { score: [6, rankGroups[0].rank, rankGroups[1].rank], name: 'Full house' };
  }

  if (flushSuit) {
    const topFlush = counts.bySuit[flushSuit].sort((a, b) => b - a).slice(0, 5);
    return { score: [5, ...topFlush], name: 'Flush' };
  }

  if (straightHigh) {
    return { score: [4, straightHigh], name: 'Straight' };
  }

  if (rankGroups[0]?.freq === 3) {
    const trips = rankGroups[0].rank;
    const kickers = takeKickers([trips], 2);
    return { score: [3, trips, ...kickers], name: 'Three of a kind' };
  }

  if (rankGroups[0]?.freq === 2 && rankGroups[1]?.freq === 2) {
    const pairHigh = rankGroups[0].rank;
    const pairLow = rankGroups[1].rank;
    const kicker = takeKickers([pairHigh, pairLow], 1)[0];
    return { score: [2, pairHigh, pairLow, kicker], name: 'Two pair' };
  }

  if (rankGroups[0]?.freq === 2) {
    const pair = rankGroups[0].rank;
    const kickers = takeKickers([pair], 3);
    return { score: [1, pair, ...kickers], name: 'Pair' };
  }

  const highCards = ranksDesc.slice(0, 5);
  return { score: [0, ...highCards], name: 'High card' };
}

function compareScores(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function nextActiveIndex(room, start) {
  const total = room.players.length;
  if (total === 0) return null;
  for (let i = 1; i <= total; i += 1) {
    const idx = (start + i) % total;
    const candidate = room.players[idx];
    if (!candidate.folded && candidate.stack > 0) {
      return idx;
    }
  }
  return null;
}

function resetPlayerBets(room) {
  room.players.forEach((p) => {
    p.bet = 0;
  });
  room.state.currentBet = 0;
  room.state.acted = new Set();
}

function postBlinds(room) {
  if (room.players.length < 2) return;
  const sbIndex = (room.dealerIndex + 1) % room.players.length;
  const bbIndex = (room.dealerIndex + 2) % room.players.length;
  const smallBlindPlayer = room.players[sbIndex];
  const bigBlindPlayer = room.players[bbIndex];

  const sb = Math.min(SMALL_BLIND, smallBlindPlayer.stack);
  const bb = Math.min(BIG_BLIND, bigBlindPlayer.stack);

  smallBlindPlayer.stack -= sb;
  bigBlindPlayer.stack -= bb;

  smallBlindPlayer.bet = sb;
  bigBlindPlayer.bet = bb;

  room.state.pot = sb + bb;
  room.state.currentBet = bb;
  room.state.currentPlayerIndex = nextActiveIndex(room, bbIndex);
  room.state.message = `Blinds posted. ${room.players[room.state.currentPlayerIndex].name} to act.`;
  room.state.acted = new Set();
}

function startRound(room, actorId) {
  if (room.players.length < 2) {
    throw new Error('At least two players are required.');
  }
  const actor = room.players.find((p) => p.id === actorId);
  if (!actor || !actor.isHost) {
    throw new Error('Only the host can start a round.');
  }
  room.state.stage = 'preflop';
  room.state.community = [];
  room.state.deck = shuffleDeck();
  room.state.pot = 0;
  room.state.currentBet = 0;
  room.state.acted = new Set();
  room.players.forEach((p) => {
    p.folded = false;
    p.cards = [room.state.deck.pop(), room.state.deck.pop()];
    p.bet = 0;
    p.bestHand = null;
    if (typeof p.stack !== 'number') {
      p.stack = 1000;
    }
  });
  room.dealerIndex = room.dealerIndex % room.players.length;
  postBlinds(room);
}

function advanceStage(room) {
  if (room.state.stage === 'preflop') {
    room.state.community = [room.state.deck.pop(), room.state.deck.pop(), room.state.deck.pop()];
    room.state.stage = 'flop';
  } else if (room.state.stage === 'flop') {
    room.state.community.push(room.state.deck.pop());
    room.state.stage = 'turn';
  } else if (room.state.stage === 'turn') {
    room.state.community.push(room.state.deck.pop());
    room.state.stage = 'river';
  } else if (room.state.stage === 'river') {
    room.state.stage = 'showdown';
    room.state.currentPlayerIndex = null;
    resetPlayerBets(room);
    resolveShowdown(room);
    return;
  }
  resetPlayerBets(room);
  room.state.currentPlayerIndex = nextActiveIndex(room, room.dealerIndex);
  room.state.message = `${room.players[room.state.currentPlayerIndex].name} to act.`;
}

function resolveShowdown(room) {
  const contenders = room.players.filter((p) => !p.folded && p.cards && p.cards.length === 2);
  if (contenders.length === 0) {
    room.state.message = 'Geen spelers over voor een showdown.';
    room.state.stage = 'waiting';
    return;
  }

  contenders.forEach((p) => {
    p.bestHand = evaluateHand([...p.cards, ...room.state.community]);
  });

  let winners = [];
  contenders.forEach((p) => {
    if (winners.length === 0) {
      winners = [p];
      return;
    }
    const diff = compareScores(p.bestHand.score, winners[0].bestHand.score);
    if (diff > 0) {
      winners = [p];
    } else if (diff === 0) {
      winners.push(p);
    }
  });

  const share = Math.floor(room.state.pot / winners.length);
  const remainder = room.state.pot - share * winners.length;
  winners.forEach((p, idx) => {
    p.stack += share + (idx === 0 ? remainder : 0);
  });
  room.state.pot = 0;
  room.state.currentPlayerIndex = null;
  room.state.stage = 'showdown';
  const winnerNames = winners.map((p) => p.name).join(' & ');
  room.state.message = `${winnerNames} wint de pot (${share}${winners.length > 1 ? ' gedeeld' : ''}) met ${winners[0].bestHand.name}.`;
}

function autoWin(room, winner) {
  winner.stack += room.state.pot;
  room.state.pot = 0;
  room.state.stage = 'waiting';
  room.state.currentPlayerIndex = null;
  room.state.message = `${winner.name} wins the pot! Start a new round when ready.`;
  resetPlayerBets(room);
  room.state.community = [];
}

function evaluateEndOfAction(room) {
  const active = activePlayers(room);
  if (active.length === 1) {
    autoWin(room, active[0]);
    return;
  }
  const everyoneMatched = active.every((p) => p.bet === room.state.currentBet);
  const everyoneActed = active.every((p) => room.state.acted.has(p.id));
  if (room.state.stage !== 'showdown' && everyoneMatched && everyoneActed) {
    advanceStage(room);
  }
}

function advanceTurn(room) {
  if (room.state.stage === 'showdown' || room.state.stage === 'waiting') return;
  const nextIndex = nextActiveIndex(room, room.state.currentPlayerIndex ?? room.dealerIndex);
  room.state.currentPlayerIndex = nextIndex;
  if (nextIndex !== null) {
    room.state.message = `${room.players[nextIndex].name} to act.`;
  }
}

function handleFold(room, player) {
  if (player.folded) throw new Error('Already folded.');
  player.folded = true;
  room.state.acted.add(player.id);
  evaluateEndOfAction(room);
  if (room.state.stage !== 'waiting' && room.state.stage !== 'showdown') {
    advanceTurn(room);
  }
}

function handleCheckCall(room, player) {
  const toCall = Math.max(0, room.state.currentBet - player.bet);
  const contribution = Math.min(toCall, player.stack);
  player.stack -= contribution;
  player.bet += contribution;
  room.state.pot += contribution;
  room.state.acted.add(player.id);
  evaluateEndOfAction(room);
  if (room.state.stage !== 'waiting' && room.state.stage !== 'showdown') {
    advanceTurn(room);
  }
}

function handleBetRaise(room, player, amount) {
  if (amount <= 0) throw new Error('Bet or raise must be greater than zero.');
  const raiseTo = player.bet + amount;
  if (raiseTo <= room.state.currentBet) {
    throw new Error('Raise must exceed the current bet.');
  }
  const chips = Math.min(amount, player.stack);
  player.stack -= chips;
  player.bet += chips;
  room.state.pot += chips;
  room.state.currentBet = player.bet;
  room.state.acted = new Set([player.id]);
  advanceTurn(room);
}

function declareWinner(room, winnerId) {
  const winner = room.players.find((p) => p.id === winnerId);
  if (!winner) throw new Error('Winner not found.');
  autoWin(room, winner);
}

function ensureTurn(room, playerId) {
  if (room.state.stage === 'waiting') {
    throw new Error('Round has not started yet.');
  }
  if (room.state.stage === 'showdown') {
    throw new Error('Betting is over. Declare a winner.');
  }
  const player = room.players[room.state.currentPlayerIndex];
  if (!player || player.id !== playerId) {
    throw new Error('Not your turn.');
  }
}

function sanitizeRoom(room, playerId) {
  return {
    code: room.code,
    stage: room.state.stage,
    pot: room.state.pot,
    currentBet: room.state.currentBet,
    community: room.state.community,
    message: room.state.message,
    currentPlayerId: room.state.currentPlayerIndex !== null && room.players[room.state.currentPlayerIndex]
      ? room.players[room.state.currentPlayerIndex].id
      : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      bet: p.bet,
      folded: p.folded,
      isHost: p.isHost,
      cards: room.state.stage === 'showdown' ? p.cards : (p.id === playerId ? p.cards : ['❓', '❓']),
      bestHand: room.state.stage === 'showdown' ? p.bestHand : null
    }))
  };
}

function sendEvent(room, data) {
  room.connections = room.connections.filter(({ res }) => !res.writableEnded);
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  room.connections.forEach(({ res }) => res.write(payload));
}

function broadcastRoom(room) {
  room.connections.forEach(({ res, playerId }) => {
    if (res.writableEnded) return;
    const payload = sanitizeRoom(room, playerId);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

function serveStatic(req, res) {
  const parsedUrl = url.parse(req.url);
  let pathname = `${publicDir}${parsedUrl.pathname}`;
  if (parsedUrl.pathname === '/') {
    pathname = path.join(publicDir, 'index.html');
  }
  const ext = path.parse(pathname).ext;
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css'
  }[ext] || 'text/plain';
  fs.readFile(pathname, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && parsedUrl.pathname === '/api/events') {
    const { roomCode, playerId } = parsedUrl.query;
    if (!roomCode) {
      res.statusCode = 400;
      res.end('roomCode required');
      return;
    }
    const room = getRoom(roomCode);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    room.connections.push({ res, playerId });
    const payload = sanitizeRoom(room, playerId);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    req.on('close', () => {
      room.connections = room.connections.filter((c) => c.res !== res);
      if (room.connections.length === 0 && room.players.length === 0) {
        rooms.delete(room.code);
      }
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/state') {
    const { roomCode, playerId } = parsedUrl.query;
    const room = getRoom(normalizeRoomCode(roomCode));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(sanitizeRoom(room, playerId)));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/join') {
    try {
      const { roomCode = 'table', name } = await collectBody(req);
      if (!name) {
        res.statusCode = 400;
        res.end('Name required');
        return;
      }
      const room = getRoom(normalizeRoomCode(roomCode));
      const playerId = randomUUID();
      const player = {
        id: playerId,
        name: name.trim().slice(0, 20),
        stack: 1000,
        bet: 0,
        folded: false,
        cards: ['❓', '❓'],
        isHost: room.players.length === 0
      };
      room.players.push(player);
      room.state.message = `${player.name} joined the table.`;
      broadcastRoom(room);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ playerId, room: sanitizeRoom(room, playerId) }));
    } catch (err) {
      res.statusCode = 400;
      res.end(err.message);
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/action') {
    try {
      const { roomCode, playerId, type, amount, winnerId } = await collectBody(req);
      if (!roomCode || !playerId || !type) {
        res.statusCode = 400;
        res.end('Missing parameters');
        return;
      }
      const normalizedRoomCode = normalizeRoomCode(roomCode);
      const room = getRoom(normalizedRoomCode);
      const player = room.players.find((p) => p.id === playerId);
      if (!player) throw new Error('Player not found.');

      switch (type) {
        case 'start':
          startRound(room, playerId);
          break;
        case 'fold':
          ensureTurn(room, playerId);
          handleFold(room, player);
          break;
        case 'checkCall':
          ensureTurn(room, playerId);
          handleCheckCall(room, player);
          break;
        case 'betRaise':
          ensureTurn(room, playerId);
          handleBetRaise(room, player, Number(amount || 0));
          break;
        case 'declare':
          declareWinner(room, winnerId);
          break;
        default:
          throw new Error('Unknown action');
      }
      broadcastRoom(room);
      res.end('ok');
    } catch (err) {
      res.statusCode = 400;
      res.end(err.message);
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/leave') {
    try {
      const { roomCode, playerId } = await collectBody(req);
      const room = getRoom(normalizeRoomCode(roomCode));
      room.players = room.players.filter((p) => p.id !== playerId);
      room.connections = room.connections.filter((c) => c.playerId !== playerId);
      room.state.message = 'A player left the table.';
      broadcastRoom(room);
      res.end('ok');
    } catch (err) {
      res.statusCode = 400;
      res.end(err.message);
    }
    return;
  }

  serveStatic(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Poker table running on http://localhost:${PORT}`);
});
