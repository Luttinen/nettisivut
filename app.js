const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

let deck = [];
let dealerHand = [];
let playerHands = [];
let activeHandIndex = 0;
let bankroll = 1000;
let bet = 50;
let inRound = false;
let dealerHidden = true;
let splitUsed = false;

const bankrollEl = document.getElementById("bankroll");
const betEl = document.getElementById("bet");
const messageEl = document.getElementById("message");
const dealerCardsEl = document.getElementById("dealer-cards");
const playerCardsEl = document.getElementById("player-cards");
const dealerScoreEl = document.getElementById("dealer-score");
const playerScoreEl = document.getElementById("player-score");
const handLabelEl = document.getElementById("hand-label");
const splitHandsEl = document.getElementById("split-hands");

const dealBtn = document.getElementById("deal-btn");
const hitBtn = document.getElementById("hit-btn");
const standBtn = document.getElementById("stand-btn");
const doubleBtn = document.getElementById("double-btn");
const splitBtn = document.getElementById("split-btn");
const newRoundBtn = document.getElementById("new-round-btn");
const betPlusBtn = document.getElementById("bet-plus");
const betMinusBtn = document.getElementById("bet-minus");

function createDeck() {
  const newDeck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      newDeck.push({ suit, rank });
    }
  }
  return shuffle(newDeck);
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawCard() {
  if (deck.length === 0) deck = createDeck();
  return deck.pop();
}

function getCardValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function getHandValue(hand) {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    value += getCardValue(card);
    if (card.rank === "A") aces += 1;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces -= 1;
  }
  return value;
}

function renderHand(container, hand, hideFirstCard = false) {
  container.innerHTML = "";
  hand.forEach((card, index) => {
    const el = document.createElement("div");
    const redSuit = card.suit === "♥" || card.suit === "♦";
    el.className = `card ${redSuit ? "red" : ""}`;
    if (hideFirstCard && index === 0) {
      el.className = "card back";
      el.textContent = "X";
    } else {
      el.textContent = `${card.rank}${card.suit}`;
    }
    container.appendChild(el);
  });
}

function getActiveHand() {
  return playerHands[activeHandIndex] || null;
}

function canSplitCurrentHand() {
  const handState = getActiveHand();
  if (!handState || handState.done || handState.cards.length !== 2 || handState.hasActed) return false;
  if (bankroll < handState.bet) return false;
  return handState.cards[0].rank === handState.cards[1].rank;
}

function canDoubleCurrentHand() {
  const handState = getActiveHand();
  if (!handState || handState.done || handState.cards.length !== 2 || handState.hasActed) return false;
  return bankroll >= handState.bet;
}

function updateUI() {
  bankrollEl.textContent = bankroll;
  betEl.textContent = bet;

  renderHand(dealerCardsEl, dealerHand, dealerHidden);
  const active = getActiveHand();
  renderHand(playerCardsEl, active ? active.cards : [], false);

  const playerScore = active ? getHandValue(active.cards) : 0;
  playerScoreEl.textContent = active ? `(${playerScore})` : "";
  handLabelEl.textContent = playerHands.length > 1 && active ? `[Hand ${activeHandIndex + 1}/${playerHands.length}]` : "";

  splitHandsEl.innerHTML = "";
  playerHands.forEach((handState, idx) => {
    const tag = document.createElement("span");
    tag.className = "split-tag";
    if (idx === activeHandIndex && inRound && !handState.done) tag.classList.add("active");
    const stateLabel = handState.done ? "done" : "playing";
    tag.textContent = `H${idx + 1}: ${getHandValue(handState.cards)} (${stateLabel}) bet $${handState.bet}`;
    splitHandsEl.appendChild(tag);
  });

  if (dealerHidden && dealerHand.length > 1) {
    const visibleValue = getCardValue(dealerHand[1]);
    dealerScoreEl.textContent = `( ? + ${visibleValue} )`;
  } else {
    dealerScoreEl.textContent = dealerHand.length ? `(${getHandValue(dealerHand)})` : "";
  }
}

function setMessage(text) {
  messageEl.textContent = text;
}

function setButtons({ canDeal, canHit, canStand, canDouble, canSplit, canNewRound, canAdjustBet }) {
  dealBtn.disabled = !canDeal;
  hitBtn.disabled = !canHit;
  standBtn.disabled = !canStand;
  doubleBtn.disabled = !canDouble;
  splitBtn.disabled = !canSplit;
  newRoundBtn.disabled = !canNewRound;
  betPlusBtn.disabled = !canAdjustBet;
  betMinusBtn.disabled = !canAdjustBet;
}

function moveToNextHandOrDealer() {
  let next = activeHandIndex + 1;
  while (next < playerHands.length && playerHands[next].done) next += 1;
  if (next < playerHands.length) {
    activeHandIndex = next;
    const handNum = activeHandIndex + 1;
    setMessage(`Playing hand ${handNum}.`);
    refreshActionButtons();
    updateUI();
    return;
  }
  resolveDealerAndPayouts();
}

function refreshActionButtons() {
  if (!inRound) return;
  const active = getActiveHand();
  setButtons({
    canDeal: false,
    canHit: Boolean(active && !active.done),
    canStand: Boolean(active && !active.done),
    canDouble: canDoubleCurrentHand(),
    canSplit: canSplitCurrentHand(),
    canNewRound: false,
    canAdjustBet: false,
  });
}

function startRound() {
  if (inRound) return;
  if (bankroll < bet) {
    setMessage("Not enough bankroll for this bet.");
    return;
  }

  bankroll -= bet;
  inRound = true;
  dealerHidden = true;
  splitUsed = false;
  activeHandIndex = 0;
  dealerHand = [drawCard(), drawCard()];
  playerHands = [{ cards: [drawCard(), drawCard()], bet, done: false, hasActed: false }];

  const dealerValue = getHandValue(dealerHand);
  const playerValue = getHandValue(playerHands[0].cards);

  if (playerValue === 21 || dealerValue === 21) {
    inRound = false;
    dealerHidden = false;
    if (playerValue === 21 && dealerValue === 21) {
      bankroll += bet;
      setMessage("Both have blackjack. Push.");
    } else if (playerValue === 21) {
      bankroll += Math.floor(bet * 2.5);
      setMessage("Blackjack! You win 3:2 payout.");
    } else {
      setMessage("Dealer blackjack. You lose.");
    }
    setButtons({
      canDeal: false,
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      canNewRound: bankroll > 0,
      canAdjustBet: false,
    });
    updateUI();
    return;
  }

  setMessage("Your turn: Hit, Stand, Double, or Split.");
  refreshActionButtons();
  updateUI();
}

function playerHit() {
  if (!inRound) return;
  const handState = getActiveHand();
  if (!handState || handState.done) return;

  handState.cards.push(drawCard());
  handState.hasActed = true;
  const value = getHandValue(handState.cards);
  if (value >= 21) {
    handState.done = true;
    moveToNextHandOrDealer();
    return;
  }
  refreshActionButtons();
  setMessage(`Hand ${activeHandIndex + 1}: Hit or Stand.`);
  updateUI();
}

function playerStand() {
  if (!inRound) return;
  const handState = getActiveHand();
  if (!handState || handState.done) return;
  handState.done = true;
  handState.hasActed = true;
  moveToNextHandOrDealer();
}

function playerDouble() {
  if (!inRound || !canDoubleCurrentHand()) return;
  const handState = getActiveHand();
  bankroll -= handState.bet;
  handState.bet *= 2;
  handState.cards.push(drawCard());
  handState.hasActed = true;
  handState.done = true;
  moveToNextHandOrDealer();
}

function playerSplit() {
  if (!inRound || !canSplitCurrentHand()) return;
  const handState = getActiveHand();
  bankroll -= handState.bet;
  splitUsed = true;

  const [cardA, cardB] = handState.cards;
  const first = { cards: [cardA, drawCard()], bet: handState.bet, done: false, hasActed: false };
  const second = { cards: [cardB, drawCard()], bet: handState.bet, done: false, hasActed: false };
  playerHands.splice(activeHandIndex, 1, first, second);
  setMessage("Split done. Play first hand.");
  refreshActionButtons();
  updateUI();
}

function resolveDealerAndPayouts() {
  inRound = false;
  dealerHidden = false;

  const liveHands = playerHands.filter((h) => getHandValue(h.cards) <= 21);
  if (liveHands.length > 0) {
    while (getHandValue(dealerHand) < 17) dealerHand.push(drawCard());
  }

  const dealerValue = getHandValue(dealerHand);
  const results = [];

  playerHands.forEach((handState, idx) => {
    const value = getHandValue(handState.cards);
    if (value > 21) {
      results.push(`H${idx + 1}: bust`);
      return;
    }
    if (dealerValue > 21 || value > dealerValue) {
      bankroll += handState.bet * 2;
      results.push(`H${idx + 1}: win`);
      return;
    }
    if (value === dealerValue) {
      bankroll += handState.bet;
      results.push(`H${idx + 1}: push`);
      return;
    }
    results.push(`H${idx + 1}: lose`);
  });

  if (bankroll <= 0) {
    setMessage("Game over. Refresh to restart.");
    setButtons({
      canDeal: false,
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      canNewRound: false,
      canAdjustBet: false,
    });
  } else {
    setMessage(`Round over - ${results.join(" | ")}`);
    setButtons({
      canDeal: false,
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      canNewRound: true,
      canAdjustBet: false,
    });
  }
  updateUI();
}

function newRound() {
  dealerHand = [];
  playerHands = [];
  activeHandIndex = 0;
  splitUsed = false;
  dealerHidden = true;
  setButtons({
    canDeal: true,
    canHit: false,
    canStand: false,
    canDouble: false,
    canSplit: false,
    canNewRound: false,
    canAdjustBet: true,
  });
  setMessage("Press Deal to start.");
  updateUI();
}

function adjustBet(delta) {
  if (inRound) return;
  const newBet = bet + delta;
  if (newBet < 10) return;
  if (newBet > bankroll) return;
  bet = newBet;
  updateUI();
}

betPlusBtn.addEventListener("click", () => adjustBet(10));
betMinusBtn.addEventListener("click", () => adjustBet(-10));
dealBtn.addEventListener("click", startRound);
hitBtn.addEventListener("click", playerHit);
standBtn.addEventListener("click", playerStand);
doubleBtn.addEventListener("click", playerDouble);
splitBtn.addEventListener("click", playerSplit);
newRoundBtn.addEventListener("click", newRound);

deck = createDeck();
newRound();
