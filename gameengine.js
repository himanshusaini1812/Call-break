// ============================================================
//  CALL BREAK — GameEngine.js
//  Senior Full-Stack Game Developer Reference Implementation
//  Covers: Deck, Deal, Redeal, Auction FSM, Bidding, Playing
// ============================================================

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
export const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i])); // 2=0 … A=12
export const FACE_RANKS = new Set(['J', 'Q', 'K', 'A']);

export const GAME_PHASE = {
  IDLE: 'IDLE',
  INITIAL_DEAL: 'INITIAL_DEAL',   // Deal 5 cards
  AUCTION: 'AUCTION',              // Hidden trump auction
  REVEAL: 'REVEAL',                // Announce winning trump
  FINAL_DEAL: 'FINAL_DEAL',        // Deal remaining 8 cards
  BIDDING: 'BIDDING',              // Normal 1-N bids
  PLAYING: 'PLAYING',              // Trick play
  ROUND_END: 'ROUND_END',
  GAME_OVER: 'GAME_OVER',
};

export const PLAYER_SEATS = [0, 1, 2, 3]; // 0 = Human (South), 1=West, 2=North, 3=East

// ─────────────────────────────────────────────
//  CARD FACTORY
// ─────────────────────────────────────────────
export function makeCard(suit, rank) {
  return {
    id: `${rank}${suit}`,
    suit,
    rank,
    value: RANK_VALUE[rank],
    isTrump: false, // set dynamically after trump is revealed
  };
}

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push(makeCard(suit, rank));
  return deck;
}

export function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─────────────────────────────────────────────
//  REDEAL CHECK
// ─────────────────────────────────────────────
/**
 * Returns true if ANY player's full 13-card hand should trigger a redeal.
 * Condition: zero spades OR zero face cards (J/Q/K/A).
 * Note: checked against the FULL 13-card hand after final deal for the
 * classic rule; however we also expose a 5-card variant for the initial deal.
 */
export function shouldRedeal(hands) {
  return hands.some(hand => {
    const hasSpade = hand.some(c => c.suit === 'S');
    const hasFace = hand.some(c => FACE_RANKS.has(c.rank));
    return !hasSpade || !hasFace;
  });
}

// ─────────────────────────────────────────────
//  DEAL HELPERS
// ─────────────────────────────────────────────
/** Deal `count` cards to each of 4 players from the top of deck */
export function dealCards(deck, existingHands, count) {
  const hands = existingHands.map(h => [...h]);
  let idx = 0;
  // Counter-clockwise: seats 0,3,2,1 repeated
  const order = [0, 3, 2, 1];
  let card = 0;
  while (card < count * 4) {
    const seat = order[card % 4];
    hands[seat].push({ ...deck[idx], isTrump: false });
    idx++;
    card++;
  }
  return { hands, remaining: deck.slice(idx) };
}

/** Full initial 5-card deal with redeal loop */
export function initialDeal() {
  let deck, hands, remaining;
  let attempts = 0;
  do {
    deck = shuffleDeck(makeDeck());
    const result = dealCards(deck, [[], [], [], []], 5);
    hands = result.hands;
    remaining = result.remaining;
    attempts++;
    if (attempts > 100) break; // safety
  } while (false); // Redeal for 5-card phase not checked — only full 13-card hand
  return { hands, remaining, deck };
}

/** After trump is known, mark trump cards in hands */
export function stampTrump(hands, trump) {
  return hands.map(hand =>
    hand.map(c => ({ ...c, isTrump: c.suit === trump }))
  );
}

// ─────────────────────────────────────────────
//  AUCTION ENGINE
// ─────────────────────────────────────────────
/**
 * AuctionState shape:
 * {
 *   currentBidder: seatIndex,         // whose turn to bid / pass
 *   highestBid: number,               // current winning bid value
 *   highestBidder: seatIndex | null,
 *   chosenSuit: SUIT | null,          // hidden from opponents
 *   bids: [{ seat, bid, suit }],      // full history
 *   passedSeats: Set<seatIndex>,
 *   done: boolean,
 * }
 */
export function createAuctionState(firstBidder = 0) {
  return {
    currentBidder: firstBidder,
    highestBid: 4,           // first bid must be >= 5
    highestBidder: null,
    chosenSuit: null,
    bids: [],
    passedSeats: new Set(),
    done: false,
  };
}

export const MIN_FIRST_BID = 5;

/**
 * Attempt to place an auction bid.
 * Returns { success, state, error }
 */
export function placeBid(auctionState, seat, bid, suit) {
  const s = cloneAuctionState(auctionState);

  if (s.done) return { success: false, state: s, error: 'Auction over' };
  if (seat !== s.currentBidder) return { success: false, state: s, error: 'Not your turn' };
  if (s.passedSeats.has(seat)) return { success: false, state: s, error: 'Already passed' };

  const isFirstBid = s.highestBidder === null;
  const minBid = isFirstBid ? MIN_FIRST_BID : s.highestBid + 1;

  if (bid < minBid)
    return { success: false, state: s, error: `Bid must be >= ${minBid}` };

  if (!SUITS.includes(suit))
    return { success: false, state: s, error: 'Invalid suit' };

  s.highestBid = bid;
  s.highestBidder = seat;
  s.chosenSuit = suit; // hidden from others in UI layer
  s.bids.push({ seat, bid, suit });
  s.currentBidder = nextActiveSeat(s);
  s.done = checkAuctionDone(s);
  return { success: true, state: s };
}

/**
 * Pass the auction for the current bidder.
 */
export function passAuction(auctionState, seat) {
  const s = cloneAuctionState(auctionState);

  if (s.done) return { success: false, state: s, error: 'Auction over' };
  if (seat !== s.currentBidder) return { success: false, state: s, error: 'Not your turn' };
  if (s.highestBidder === null)
    return { success: false, state: s, error: 'Cannot pass before first bid' };

  s.passedSeats.add(seat);
  s.bids.push({ seat, bid: null, suit: null }); // null = pass
  s.currentBidder = nextActiveSeat(s);
  s.done = checkAuctionDone(s);
  return { success: true, state: s };
}

function checkAuctionDone(s) {
  // Done when all seats except the highest bidder have passed
  if (s.highestBidder === null) return false;
  const activePlayers = PLAYER_SEATS.filter(
    seat => seat !== s.highestBidder && !s.passedSeats.has(seat)
  );
  return activePlayers.length === 0;
}

function nextActiveSeat(s) {
  // Counter-clockwise: 0 → 3 → 2 → 1 → 0
  const ccw = [0, 3, 2, 1];
  const currentIdx = ccw.indexOf(s.currentBidder);
  for (let i = 1; i <= 4; i++) {
    const candidate = ccw[(currentIdx + i) % 4];
    if (candidate !== s.highestBidder && !s.passedSeats.has(candidate)) {
      return candidate;
    }
  }
  return s.highestBidder; // fallback — auction is done
}

function cloneAuctionState(s) {
  return {
    ...s,
    bids: [...s.bids],
    passedSeats: new Set(s.passedSeats),
  };
}

// ─────────────────────────────────────────────
//  AI AUCTION BIDDER  (Greedy probability model)
// ─────────────────────────────────────────────
/**
 * Score a 5-card hand for auction potential.
 * Weights: Aces=5, Kings=3, Queens=2, Jacks=1, plus
 *          2 bonus per trump suit card (unknown at this point).
 * The AI evaluates its hand for each possible trump suit and
 * picks the best one, then decides whether to bid.
 */
export function aiBidDecision(hand, currentHighestBid, isFirstBid) {
  const MIN_BID = isFirstBid ? MIN_FIRST_BID : currentHighestBid + 1;

  let bestScore = 0;
  let bestSuit = null;

  for (const suit of SUITS) {
    const score = evaluateHandForTrump(hand, suit);
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }

  // Convert score to expected tricks (rough linear mapping)
  const expectedTricks = Math.round(bestScore / 3);

  if (expectedTricks < MIN_BID) {
    return { action: 'pass' };
  }

  // Bid conservatively: expected tricks or MIN_BID, whichever is higher
  const bid = Math.max(MIN_BID, Math.min(expectedTricks, 8));
  return { action: 'bid', bid, suit: bestSuit };
}

function evaluateHandForTrump(hand, trumpSuit) {
  let score = 0;
  for (const card of hand) {
    const rv = card.value; // 0(2) to 12(A)
    if (card.suit === trumpSuit) {
      // Trump cards are significantly more powerful
      score += rv >= 10 ? 5 : rv >= 8 ? 3 : 2;
    } else {
      // Off-suit high cards
      if (rv === 12) score += 4; // Ace
      else if (rv === 11) score += 2; // King
      else if (rv === 10) score += 1; // Queen
    }
  }
  return score;
}

// ─────────────────────────────────────────────
//  STANDARD BIDDING PHASE
// ─────────────────────────────────────────────
/**
 * AI bid for the standard bidding phase (post-auction, full hand unknown).
 * Uses 5 visible cards + heuristic projection for the 8 hidden cards.
 */
export function aiStandardBid(hand, trump) {
  // Count power cards in hand
  let expectedWins = 0;
  const trumpCards = hand.filter(c => c.suit === trump).sort((a, b) => b.value - a.value);
  const offSuitAces = hand.filter(c => c.suit !== trump && c.rank === 'A');

  // Each trump card: high trump wins, low trump might not
  trumpCards.forEach((c, i) => {
    if (c.value >= 10) expectedWins += 1;        // Q/K/A trump = almost certain win
    else if (c.value >= 6 && i === 0) expectedWins += 0.5; // only if highest trump held
  });

  // Off-suit aces
  expectedWins += offSuitAces.length * 0.8;

  // Project remaining 8 cards: assume avg 2 more winning cards
  expectedWins += 1.5;

  return Math.max(1, Math.round(expectedWins));
}

// ─────────────────────────────────────────────
//  TRICK PLAYING ENGINE
// ─────────────────────────────────────────────
/**
 * TrickState shape:
 * {
 *   leadSeat: number,
 *   currentSeat: number,
 *   plays: [{ seat, card }],   // in play order
 *   leadSuit: SUIT | null,
 *   trump: SUIT,
 *   winner: seatIndex | null,  // set when trick complete
 * }
 */
export function createTrickState(leadSeat, trump) {
  return {
    leadSeat,
    currentSeat: leadSeat,
    plays: [],
    leadSuit: null,
    trump,
    winner: null,
  };
}

/**
 * Get legal cards for a player.
 * Enforces the "Must-Play-Higher" rule:
 *   1. If player has lead suit: must play it; AND if they have a higher card, must play higher.
 *   2. If no lead suit: must play trump if available.
 *   3. Otherwise: any card.
 */
export function getLegalCards(hand, trickState) {
  if (trickState.plays.length === 0) return hand; // leading — any card

  const { leadSuit, trump } = trickState;
  const leadPlays = trickState.plays.filter(p => p.card.suit === leadSuit);
  const currentHighValue = leadPlays.length > 0
    ? Math.max(...leadPlays.map(p => p.card.value))
    : -1;

  const leadSuitCards = hand.filter(c => c.suit === leadSuit);
  const trumpCards = hand.filter(c => c.suit === trump);

  if (leadSuitCards.length > 0) {
    // Must follow suit
    const higherCards = leadSuitCards.filter(c => c.value > currentHighValue);
    // Must play higher if possible
    return higherCards.length > 0 ? higherCards : leadSuitCards;
  }

  if (trumpCards.length > 0) {
    // No lead suit — must trump
    return trumpCards;
  }

  // No lead suit, no trump — free to play any
  return hand;
}

/**
 * Play a card into the current trick.
 * Returns { success, state, error }
 */
export function playCard(trickState, seat, card, hand) {
  if (seat !== trickState.currentSeat)
    return { success: false, error: 'Not your turn' };

  const legal = getLegalCards(hand, trickState);
  if (!legal.find(c => c.id === card.id))
    return { success: false, error: 'Illegal card play' };

  const newState = {
    ...trickState,
    plays: [...trickState.plays, { seat, card }],
    leadSuit: trickState.leadSuit ?? card.suit,
  };

  if (newState.plays.length === 4) {
    newState.winner = determineTrickWinner(newState);
    newState.currentSeat = newState.winner;
  } else {
    // Counter-clockwise next
    newState.currentSeat = ccwNext(seat);
  }

  return { success: true, state: newState };
}

function ccwNext(seat) {
  const order = [0, 3, 2, 1, 0, 3, 2, 1];
  return order[order.indexOf(seat) + 1];
}

function determineTrickWinner(trickState) {
  const { plays, leadSuit, trump } = trickState;
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    const challenger = plays[i];
    if (beats(challenger.card, best.card, leadSuit, trump)) {
      best = challenger;
    }
  }
  return best.seat;
}

/** Returns true if `challenger` beats `current` */
function beats(challenger, current, leadSuit, trump) {
  const cTrump = challenger.suit === trump;
  const bTrump = current.suit === trump;
  const cLead = challenger.suit === leadSuit;
  const bLead = current.suit === leadSuit;

  if (bTrump && !cTrump) return false;  // current is trump, challenger is not
  if (!bTrump && cTrump) return true;   // challenger is trump, current is not
  if (bTrump && cTrump) return challenger.value > current.value; // both trump
  if (bLead && !cLead) return false;    // current follows suit, challenger doesn't
  if (!bLead && cLead) return true;
  return challenger.value > current.value;
}

// ─────────────────────────────────────────────
//  AI CARD PLAYER  (Greedy)
// ─────────────────────────────────────────────
/**
 * Pick the best legal card using a greedy strategy:
 * - If leading: play highest trump, or highest card in longest suit
 * - If following: play just-enough to win, or discard lowest
 */
export function aiChooseCard(hand, trickState) {
  const legal = getLegalCards(hand, trickState);
  const { trump, plays, leadSuit } = trickState;

  if (plays.length === 0) {
    // Leading — play highest trump if we have many, else highest card overall
    const trumpCards = legal.filter(c => c.suit === trump).sort((a, b) => b.value - a.value);
    if (trumpCards.length >= 2) return trumpCards[0];
    // Play highest non-trump ace/king
    const highCards = legal.filter(c => c.value >= 11).sort((a, b) => b.value - a.value);
    if (highCards.length > 0) return highCards[0];
    // Default: highest card
    return [...legal].sort((a, b) => b.value - a.value)[0];
  }

  // Following: try to win cheaply
  const currentHighValue = Math.max(...plays.map(p => p.card.value));
  const canWin = legal.filter(c => c.value > currentHighValue);

  if (canWin.length > 0) {
    // Play the lowest winning card
    return canWin.sort((a, b) => a.value - b.value)[0];
  }

  // Can't win — play lowest card to preserve power cards
  return [...legal].sort((a, b) => a.value - b.value)[0];
}

// ─────────────────────────────────────────────
//  SCORING
// ─────────────────────────────────────────────
export function calculateRoundScore(bid, tricksWon) {
  if (tricksWon >= bid) {
    const extra = tricksWon - bid;
    return parseFloat((bid * 1.0 + extra * 0.1).toFixed(1));
  } else {
    return -bid;
  }
}

// ─────────────────────────────────────────────
//  FULL ROUND INITIALIZER
// ─────────────────────────────────────────────
/**
 * Bootstrap a new round. Returns initial game state object.
 * `dealerSeat` rotates each round.
 */
export function initRound(dealerSeat = 0, cumulativeScores = [0, 0, 0, 0]) {
  // Deal 5 cards each
  const { hands: initialHands, remaining } = (() => {
    let deck, hands, rem;
    let tries = 0;
    do {
      deck = shuffleDeck(makeDeck());
      const r = dealCards(deck, [[], [], [], []], 5);
      hands = r.hands;
      rem = r.remaining;
      tries++;
    } while (tries < 1); // For 5-card phase, no redeal check
    return { hands, remaining: rem };
  })();

  // First bidder is left of dealer (counter-clockwise)
  const ccw = [0, 3, 2, 1];
  const dealerIdx = ccw.indexOf(dealerSeat);
  const firstBidder = ccw[(dealerIdx + 1) % 4];

  return {
    phase: GAME_PHASE.AUCTION,
    dealerSeat,
    hands: initialHands,
    remainingDeck: remaining,
    auction: createAuctionState(firstBidder),
    trump: null,          // revealed after auction
    bids: [null, null, null, null],
    tricks: [],           // completed tricks
    currentTrick: null,
    tricksWon: [0, 0, 0, 0],
    scores: cumulativeScores,
    roundScores: [0, 0, 0, 0],
    auctionWinner: null,
  };
}
