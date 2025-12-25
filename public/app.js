const stateEl = {
  tableCode: document.getElementById('table-code'),
  stage: document.getElementById('stage'),
  pot: document.getElementById('pot'),
  community: document.getElementById('community'),
  message: document.getElementById('message'),
  players: document.getElementById('players')
};

const controls = {
  start: document.getElementById('start'),
  fold: document.getElementById('fold'),
  checkCall: document.getElementById('check-call'),
  betRaise: document.getElementById('bet-raise'),
  amount: document.getElementById('amount')
};

const joinButton = document.getElementById('join');
const nameInput = document.getElementById('name');
const roomInput = document.getElementById('room');

let playerId = null;
let roomCode = null;
let eventSource = null;

function cardCode(card) {
  const match = card.match(/^(10|[2-9JQKA])([♠♥♦♣])$/);
  if (!match) return null;
  const rank = match[1] === '10' ? '0' : match[1];
  const suitMap = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  return `${rank}${suitMap[match[2]]}`;
}

function renderCard(card) {
  const div = document.createElement('div');
  div.className = 'card-chip';
  if (card === '❓') {
    div.textContent = '❓';
    div.classList.add('hidden-card');
    return div;
  }
  const code = cardCode(card);
  if (code) {
    const img = document.createElement('img');
    img.src = `https://deckofcardsapi.com/static/img/${code}.png`;
    img.alt = card;
    img.loading = 'lazy';
    div.classList.add('card-image');
    div.appendChild(img);
  } else {
    div.textContent = card;
  }
  return div;
}

function renderCommunity(cards) {
  stateEl.community.innerHTML = '';
  if (!cards || cards.length === 0) {
    stateEl.community.innerHTML = '<span class="card-chip hidden">Nog geen kaarten</span>';
    return;
  }
  cards.forEach((card) => {
    stateEl.community.appendChild(renderCard(card));
  });
}

function renderPlayers(room) {
  stateEl.players.innerHTML = '';

  room.players.forEach((p) => {
    const card = document.createElement('div');
    const isWinner = room.winners?.includes(p.id);
    card.className = `player-card${isWinner ? ' winner' : ''}`;

    const header = document.createElement('div');
    header.className = 'player-header';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${p.name}</strong> <span class="stack">(${p.stack} chips)</span>`;

    const badges = document.createElement('div');
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'badge host';
      badge.textContent = 'Host';
      badges.appendChild(badge);
    }
    if (isWinner) {
      const badge = document.createElement('span');
      badge.className = 'badge winner';
      badge.textContent = 'Winner';
      badges.appendChild(badge);
    }
    if (p.id === room.currentPlayerId) {
      const badge = document.createElement('span');
      badge.className = 'badge turn';
      badge.textContent = 'Aan zet';
      badges.appendChild(badge);
    }
    if (p.folded) {
      const badge = document.createElement('span');
      badge.className = 'badge folded';
      badge.textContent = 'Folded';
      badges.appendChild(badge);
    }
    header.appendChild(title);
    header.appendChild(badges);

    const cards = document.createElement('div');
    cards.className = 'card-row';
    cards.style.marginTop = '6px';
    p.cards.forEach((c) => cards.appendChild(renderCard(c)));

    const bet = document.createElement('div');
    bet.style.marginTop = '6px';
    bet.textContent = `Bet: ${p.bet}`;

    const handInfo = document.createElement('div');
    handInfo.className = 'hand-info';
    handInfo.textContent = p.bestHand ? `Hand: ${p.bestHand.name}` : '';

    card.appendChild(header);
    card.appendChild(cards);
    card.appendChild(bet);
    card.appendChild(handInfo);
    stateEl.players.appendChild(card);
  });
}

function render(room) {
  stateEl.tableCode.textContent = room.code;
  stateEl.stage.textContent = room.stage;
  stateEl.pot.textContent = room.pot;
  stateEl.message.textContent = room.message;
  renderCommunity(room.community);
  renderPlayers(room);

  const isMyTurn = room.currentPlayerId === playerId;
  controls.fold.disabled = !isMyTurn;
  controls.checkCall.disabled = !isMyTurn;
  controls.betRaise.disabled = !isMyTurn;
  controls.amount.disabled = !isMyTurn;
  controls.start.disabled = !room.players.find((p) => p.id === playerId && p.isHost);
}

async function joinRoom() {
  const name = nameInput.value.trim();
  const code = (roomInput.value.trim() || 'table').toLowerCase();
  if (!name) {
    alert('Vul je naam in.');
    return;
  }
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, roomCode: code })
  });
  if (!res.ok) {
    alert(await res.text());
    return;
  }
  const data = await res.json();
  playerId = data.playerId;
  roomCode = code;
  stateEl.message.textContent = 'Verbonden, wachten op updates…';
  subscribe();
  render(data.room);
}

function subscribe() {
  if (eventSource) {
    eventSource.close();
  }
  eventSource = new EventSource(`/api/events?roomCode=${encodeURIComponent(roomCode)}&playerId=${playerId}`);
  eventSource.onmessage = (event) => {
    const room = JSON.parse(event.data);
    render(room);
  };
  eventSource.onerror = () => {
    stateEl.message.textContent = 'Verbinding verbroken, opnieuw proberen…';
  };
}

async function sendAction(type, extra = {}) {
  if (!roomCode || !playerId) return;
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerId, type, ...extra })
  });
  if (!res.ok) {
    alert(await res.text());
  }
}

joinButton.addEventListener('click', joinRoom);
controls.start.addEventListener('click', () => sendAction('start'));
controls.fold.addEventListener('click', () => sendAction('fold'));
controls.checkCall.addEventListener('click', () => sendAction('checkCall'));
controls.betRaise.addEventListener('click', () => sendAction('betRaise', { amount: Number(controls.amount.value) }));

window.addEventListener('beforeunload', () => {
  if (playerId) {
    navigator.sendBeacon('/api/leave', JSON.stringify({ roomCode, playerId }));
  }
});
