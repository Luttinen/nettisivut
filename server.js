const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const RAISE_AMOUNT = 20;
const MAX_PLAYERS = 6;
const MAX_BOTS = 4;
const TURN_TIME_MS = 40_000;
const AUTO_NEXT_HAND_MS = 5000;

const suits = ["S", "H", "D", "C"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rooms = new Map();
const BOT_NAMES = ["Shark", "River", "Ace", "Bluff", "Dealer", "Nova", "Orbit", "Raptor"];
const usePostgres = Boolean(process.env.DATABASE_URL);
const mustUsePostgres =
  process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
let sqliteDb = null;
if (!usePostgres) {
  if (mustUsePostgres) {
    console.error("DATABASE_URL is missing. In Railway: add a PostgreSQL service and connect it to this app.");
    process.exit(1);
  }
  const sqlite3 = require("sqlite3").verbose();
  sqliteDb = new sqlite3.Database(path.join(__dirname, "poker.db"));
}
const pgPool = usePostgres
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  })
  : null;

app.use(express.static(path.join(__dirname)));

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
}

async function run(sql, params = []) {
  if (usePostgres) {
    await pgPool.query(toPgSql(sql), params);
    return;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function get(sql, params = []) {
  if (usePostgres) {
    const result = await pgPool.query(toPgSql(sql), params);
    return result.rows[0];
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function all(sql, params = []) {
  if (usePostgres) {
    const result = await pgPool.query(toPgSql(sql), params);
    return result.rows;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function dbPing() {
  if (usePostgres) {
    await pgPool.query("SELECT 1 AS ok");
    return true;
  }
  await get("SELECT 1 AS ok");
  return true;
}

async function initDb() {
  if (usePostgres) {
    await run(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        chips INTEGER NOT NULL DEFAULT 1000,
        hands INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        password_salt TEXT,
        password_hash TEXT,
        avatar_data TEXT
      )
    `);
    return;
  }

  await run(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        chips INTEGER NOT NULL DEFAULT 1000,
        hands INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        password_salt TEXT,
        password_hash TEXT,
        avatar_data TEXT
      )
    `);
  const cols = await all("PRAGMA table_info(profiles)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("password_salt")) await run("ALTER TABLE profiles ADD COLUMN password_salt TEXT");
  if (!names.has("password_hash")) await run("ALTER TABLE profiles ADD COLUMN password_hash TEXT");
  if (!names.has("avatar_data")) await run("ALTER TABLE profiles ADD COLUMN avatar_data TEXT");
}

app.get("/health", async (_req, res) => {
  try {
    await dbPing();
    res.json({
      ok: true,
      db: usePostgres ? "postgres" : "sqlite",
      uptime_sec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (_err) {
    res.status(500).json({
      ok: false,
      db: usePostgres ? "postgres" : "sqlite",
      timestamp: new Date().toISOString(),
    });
  }
});

async function ensureProfile(name) {
  await run(
    `INSERT INTO profiles (name, chips, hands, wins)
     VALUES (?, 1000, 0, 0)
     ON CONFLICT(name) DO NOTHING`,
    [name],
  );
  return get(`SELECT name, chips, hands, wins, avatar_data FROM profiles WHERE name = ?`, [name]);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function validatePassword(raw) {
  return typeof raw === "string" && raw.length >= 6 && raw.length <= 72;
}

async function registerProfile(name, password) {
  const existing = await get(
    "SELECT name, password_salt, password_hash, chips, hands, wins, avatar_data FROM profiles WHERE name = ?",
    [name],
  );
  if (existing) {
    // Legacy profile from before auth rollout: allow claiming it by setting first password.
    if (!existing.password_salt || !existing.password_hash) {
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = hashPassword(password, salt);
      await run(
        `UPDATE profiles
         SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE name = ?`,
        [salt, hash, name],
      );
      return {
        ok: true,
        profile: {
          name: existing.name,
          chips: existing.chips,
          hands: existing.hands,
          wins: existing.wins,
          avatar: existing.avatar_data || "",
        },
      };
    }
    return { ok: false, message: "Name already exists. Please log in." };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  await run(
    `INSERT INTO profiles (name, chips, hands, wins, password_salt, password_hash)
     VALUES (?, 1000, 0, 0, ?, ?)`,
    [name, salt, hash],
  );
  const profile = await get(`SELECT name, chips, hands, wins, avatar_data FROM profiles WHERE name = ?`, [name]);
  return {
    ok: true,
    profile: {
      name: profile.name,
      chips: profile.chips,
      hands: profile.hands,
      wins: profile.wins,
      avatar: profile.avatar_data || "",
    },
  };
}

async function loginProfile(name, password) {
  const row = await get(
    "SELECT name, chips, hands, wins, password_salt, password_hash, avatar_data FROM profiles WHERE name = ?",
    [name],
  );
  if (!row) {
    return { ok: false, message: "Account not found. Register first." };
  }
  if (!row.password_salt || !row.password_hash) {
    return { ok: false, message: "This profile has no password yet. Click Register to claim it." };
  }
  const incoming = hashPassword(password, row.password_salt);
  const valid = crypto.timingSafeEqual(Buffer.from(incoming, "hex"), Buffer.from(row.password_hash, "hex"));
  if (!valid) return { ok: false, message: "Wrong password." };
  return {
    ok: true,
    profile: {
      name: row.name,
      chips: row.chips,
      hands: row.hands,
      wins: row.wins,
      avatar: row.avatar_data || "",
    },
  };
}

function sanitizeAvatarDataUrl(raw) {
  if (typeof raw !== "string") return "";
  if (!raw.startsWith("data:image/jpeg;base64,")) return "";
  if (raw.length > 350000) return "";
  return raw;
}

async function saveAvatar(name, avatarDataUrl) {
  await run("UPDATE profiles SET avatar_data = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?", [avatarDataUrl, name]);
}

async function saveStack(name, chips) {
  await run(`UPDATE profiles SET chips = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`, [chips, name]);
}

async function incrementStats(name, { handsDelta = 0, winsDelta = 0 }) {
  await run(
    `UPDATE profiles
     SET hands = hands + ?, wins = wins + ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
    [handsDelta, winsDelta, name],
  );
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createDeck() {
  const deck = [];
  for (const suit of suits) for (const rank of ranks) deck.push({ suit, rank });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function nextActiveIndex(players, from) {
  let idx = from;
  for (let i = 0; i < players.length; i += 1) {
    idx = (idx + 1) % players.length;
    const p = players[idx];
    if (!p.folded && !p.out && (p.stack > 0 || p.bet > 0)) return idx;
  }
  return from;
}

function activeCount(players) {
  return players.filter((p) => !p.folded && !p.out && (p.stack > 0 || p.bet > 0)).length;
}

function valueOf(rank) {
  return ranks.indexOf(rank) + 2;
}

function combinations(cards, pick = 5) {
  const out = [];
  function rec(start, combo) {
    if (combo.length === pick) {
      out.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      combo.push(cards[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  }
  rec(0, []);
  return out;
}

function evaluateFive(cards) {
  const values = cards.map((c) => valueOf(c.rank)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const counts = {};
  values.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const entries = Object.entries(counts)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);

  const uniq = [...new Set(values)];
  let straightHigh = 0;
  if (uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) straightHigh = 5;
  for (let i = 0; i <= uniq.length - 5; i += 1) if (uniq[i] - uniq[i + 4] === 4) straightHigh = Math.max(straightHigh, uniq[i]);

  if (flush && straightHigh) return [8, straightHigh];
  if (entries[0].c === 4) return [7, entries[0].v, entries[1].v];
  if (entries[0].c === 3 && entries[1]?.c === 2) return [6, entries[0].v, entries[1].v];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (entries[0].c === 3) return [3, entries[0].v, ...entries.filter((e) => e.c === 1).map((e) => e.v).sort((a, b) => b - a)];
  if (entries[0].c === 2 && entries[1]?.c === 2) {
    const highPair = Math.max(entries[0].v, entries[1].v);
    const lowPair = Math.min(entries[0].v, entries[1].v);
    const kicker = entries.find((e) => e.c === 1).v;
    return [2, highPair, lowPair, kicker];
  }
  if (entries[0].c === 2) return [1, entries[0].v, ...entries.filter((e) => e.c === 1).map((e) => e.v).sort((a, b) => b - a)];
  return [0, ...values];
}

function compareRank(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function bestRank(cards7) {
  let best = null;
  combinations(cards7, 5).forEach((combo) => {
    const rank = evaluateFive(combo);
    if (!best || compareRank(rank, best) > 0) best = rank;
  });
  return best;
}

function rankName(rank) {
  const names = ["High Card", "Pair", "Two Pair", "Trips", "Straight", "Flush", "Full House", "Quads", "Straight Flush"];
  return names[rank[0]] || "Hand";
}

function randomBotName(room) {
  for (const base of BOT_NAMES) {
    const candidate = `${base} Bot`;
    if (!room.players.some((p) => p.name === candidate)) return candidate;
  }
  let i = 1;
  while (room.players.some((p) => p.name === `Bot ${i}`)) i += 1;
  return `Bot ${i}`;
}

function estimateBotStrength(player, board) {
  const all = [...player.cards, ...board];
  if (all.length < 5) {
    const hole = player.cards.map((c) => valueOf(c.rank)).sort((a, b) => b - a);
    const pair = hole[0] === hole[1];
    return (pair ? 0.62 : 0.22) + ((hole[0] || 2) + (hole[1] || 2)) / 30;
  }
  const rank = bestRank(all.length > 7 ? all.slice(0, 7) : all);
  return Math.min(1, (rank[0] + (rank[1] || 0) / 14) / 9);
}

function clearRoomTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnGeneration = (room.turnGeneration || 0) + 1;
  room.turnExpiresAt = null;
}

function clearAutoDealTimer(room) {
  if (room.autoDealTimer) {
    clearTimeout(room.autoDealTimer);
    room.autoDealTimer = null;
  }
}

function scheduleHumanTurnTimeout(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnGeneration = (room.turnGeneration || 0) + 1;
  room.turnExpiresAt = null;

  if (room.phase === "waiting" || room.phase === "showdown") return;

  const cur = room.players.find((p) => p.id === room.currentTurn);
  if (!cur || cur.isBot) return;

  const gen = room.turnGeneration;
  room.turnExpiresAt = Date.now() + TURN_TIME_MS;
  room.turnTimer = setTimeout(async () => {
    if (room.turnGeneration !== gen) return;
    if (room.phase === "waiting" || room.phase === "showdown") return;
    const p = room.players.find((pl) => pl.id === room.currentTurn);
    if (!p || p.isBot || p.folded || p.out) return;
    const toCall = Math.max(0, room.currentBet - p.bet);
    const action = toCall > 0 ? "fold" : "checkcall";
    await applyAction(room, p.id, action, undefined);
    await runBotTurnLoop(room);
  }, TURN_TIME_MS);
}

function scheduleAutoNextHand(room) {
  clearAutoDealTimer(room);
  room.autoDealTimer = setTimeout(async () => {
    room.autoDealTimer = null;
    if (room.phase !== "waiting") return;
    let seated = room.players.filter((p) => !p.out);
    if (seated.length < 2) {
      const autoBot = addBotToRoom(room);
      if (autoBot) {
        broadcastState(room, `${autoBot.name} auto-joined for next hand.`);
        seated = room.players.filter((p) => !p.out);
      }
    }
    if (seated.length < 2) return;
    startHand(room);
    await runBotTurnLoop(room);
  }, AUTO_NEXT_HAND_MS);
}

function broadcastState(room, message = "") {
  room.players
    .filter((viewer) => !viewer.isBot)
    .forEach((viewer) => {
      const viewerPlayer = room.players.find((p) => p.id === viewer.id);
      let bettingHints = null;
      if (
        viewerPlayer
        && room.currentTurn === viewer.id
        && room.phase !== "waiting"
        && room.phase !== "showdown"
      ) {
        const h = getBettingHints(room, viewerPlayer);
        if (h) {
          bettingHints = {
            ...h,
            canRaise: canPlayerRaise(room, viewerPlayer),
          };
        }
      }

      const payload = {
        code: room.code,
        message,
        phase: room.phase,
        pot: room.pot,
        currentBet: room.currentBet,
        board: room.board,
        dealerIndex: room.dealerIndex,
        currentTurn: room.currentTurn,
        handNumber: room.handNumber || 0,
        smallBlind: SMALL_BLIND,
        bigBlind: BIG_BLIND,
        raiseAmount: RAISE_AMOUNT,
        maxPlayers: MAX_PLAYERS,
        buttonIndex: room.buttonIndex ?? null,
        sbIndex: room.sbIndex ?? null,
        bbIndex: room.bbIndex ?? null,
        hostId: room.hostId,
        turnExpiresAt: room.turnExpiresAt ?? null,
        turnTimeLimitSec: Math.round(TURN_TIME_MS / 1000),
        bettingHints,
        players: room.players.map((p) => ({
          id: p.id,
          name: p.name,
          stack: p.stack,
          bet: p.bet,
          folded: p.folded,
          out: p.out,
          allIn: p.allIn,
          hands: p.hands,
          wins: p.wins,
          avatar: p.avatar || "",
          isBot: Boolean(p.isBot),
          cards: room.phase === "showdown" || p.folded || p.id === viewer.id ? p.cards : [],
        })),
      };
      io.to(viewer.id).emit("state", payload);
    });
  scheduleHumanTurnTimeout(room);
}

function resetBets(room) {
  room.players.forEach((p) => { p.bet = 0; p.acted = false; });
  room.currentBet = 0;
}

function moveStreet(room) {
  if (room.phase === "preflop") {
    room.phase = "flop";
    room.deck.pop();
    room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.phase === "flop") {
    room.phase = "turn";
    room.deck.pop();
    room.board.push(room.deck.pop());
  } else if (room.phase === "turn") {
    room.phase = "river";
    room.deck.pop();
    room.board.push(room.deck.pop());
  } else {
    room.phase = "showdown";
  }
  resetBets(room);
  const firstIdx = nextActiveIndex(room.players, room.dealerIndex);
  room.currentTurn = room.players[firstIdx].id;
}

async function persistRoomProfiles(room, winnerIds = []) {
  const winners = new Set(winnerIds);
  const updates = room.players
    .filter((p) => p.wasInHand && !p.isBot)
    .map(async (p) => {
      p.hands += 1;
      if (winners.has(p.id)) p.wins += 1;
      await incrementStats(p.name, { handsDelta: 1, winsDelta: winners.has(p.id) ? 1 : 0 });
      await saveStack(p.name, p.stack);
    });
  await Promise.all(updates);
}

async function finishHand(room, messagePrefix = "") {
  clearRoomTurnTimer(room);
  room.phase = "showdown";
  const alive = room.players.filter((p) => !p.folded && !p.out);
  let winnerIds = [];
  if (alive.length === 1) {
    alive[0].stack += room.pot;
    winnerIds = [alive[0].id];
    const msg = `${messagePrefix}${alive[0].name} wins $${room.pot}.`;
    room.pot = 0;
    broadcastState(room, msg);
  } else {
    const ranked = alive.map((p) => ({ p, rank: bestRank([...p.cards, ...room.board]) }));
    ranked.sort((a, b) => compareRank(b.rank, a.rank));
    const best = ranked[0].rank;
    const winners = ranked.filter((r) => compareRank(r.rank, best) === 0);
    winnerIds = winners.map((w) => w.p.id);
    const share = Math.floor(room.pot / winners.length);
    winners.forEach((w) => { w.p.stack += share; });
    const rem = room.pot - share * winners.length;
    if (rem > 0) winners[0].p.stack += rem;
    const names = winners.map((w) => w.p.name).join(", ");
    const msg = `${messagePrefix}${names} win $${room.pot} with ${rankName(best)}.`;
    room.pot = 0;
    broadcastState(room, msg);
  }

  try {
    await persistRoomProfiles(room, winnerIds);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("persistRoomProfiles", err);
  }

  room.players.forEach((p) => {
    p.out = p.stack <= 0;
    p.folded = false;
    p.cards = [];
    p.bet = 0;
    p.acted = false;
    p.allIn = false;
    p.wasInHand = false;
  });
  room.board = [];
  room.phase = "waiting";
  room.currentTurn = null;
  room.buttonIndex = null;
  room.sbIndex = null;
  room.bbIndex = null;
  broadcastState(room, "Ready for next hand.");
  scheduleAutoNextHand(room);
}

function canAdvanceStreet(room) {
  const live = room.players.filter((p) => !p.folded && !p.out);
  return live.every((p) => (p.bet === room.currentBet || p.allIn) && p.acted);
}

function getBettingHints(room, player) {
  if (!player || player.folded || player.out) return null;
  const maxBet = player.bet + player.stack;
  const toCall = Math.max(0, room.currentBet - player.bet);
  let minRaiseBet;
  if (room.currentBet === 0) {
    minRaiseBet = player.bet + Math.min(BIG_BLIND, Math.max(0, player.stack));
  } else {
    const minFullRaise = player.bet + toCall + RAISE_AMOUNT;
    minRaiseBet = minFullRaise <= maxBet ? minFullRaise : maxBet;
  }
  if (minRaiseBet > maxBet) minRaiseBet = maxBet;
  return {
    toCall,
    minRaiseBet,
    maxBet,
    pot: room.pot,
    playerBet: player.bet,
    currentBet: room.currentBet,
  };
}

function raiseTargetError(room, player, targetBet) {
  const maxBet = player.bet + player.stack;
  if (targetBet == null || !Number.isFinite(targetBet)) return "bad";
  const tb = Math.round(targetBet);
  if (tb !== targetBet) return "bad";
  if (tb <= player.bet || tb > maxBet) return "range";
  if (tb < room.currentBet) {
    if (tb !== maxBet) return "short";
    return null;
  }
  if (tb === room.currentBet) return "call";
  if (room.currentBet === 0) {
    const minOpen = player.bet + Math.min(BIG_BLIND, player.stack);
    if (tb < minOpen && tb < maxBet) return "minopen";
    return null;
  }
  const toCall = Math.max(0, room.currentBet - player.bet);
  const minFullRaise = player.bet + toCall + RAISE_AMOUNT;
  if (tb < minFullRaise && tb < maxBet) return "minraise";
  return null;
}

function canPlayerRaise(room, player) {
  const maxBet = player.bet + player.stack;
  const toCall = Math.max(0, room.currentBet - player.bet);
  const postCallBet = player.bet + Math.min(player.stack, toCall);
  if (maxBet <= postCallBet) return false;
  if (raiseTargetError(room, player, maxBet) !== null) return false;
  if (room.currentBet === 0) return maxBet > player.bet;
  return maxBet > room.currentBet;
}

function humanRaiseError(code) {
  const map = {
    bad: "Invalid bet amount.",
    range: "That total is outside what you can put in this hand.",
    short: "That bet is not allowed.",
    call: "Use Call / Check — that size only matches the current bet.",
    minopen: `Minimum new bet is $${BIG_BLIND} (or go all-in for your full stack).`,
    minraise: `Minimum raise is $${RAISE_AMOUNT} more than the call amount (or go all-in).`,
  };
  return map[code] || "That bet is not allowed.";
}

async function applyAction(room, playerId, action, raiseTargetBet) {
  if (room.phase === "waiting" || room.phase === "showdown") return { ok: false };
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.id !== room.currentTurn || player.folded || player.out) return { ok: false };

  const toCall = Math.max(0, room.currentBet - player.bet);
  const explicitRaise = raiseTargetBet != null && raiseTargetBet !== "";
  if (action === "fold") {
    player.folded = true;
    player.acted = true;
  } else if (action === "checkcall") {
    const pay = Math.min(player.stack, toCall);
    player.stack -= pay;
    player.bet += pay;
    room.pot += pay;
    player.allIn = player.stack === 0;
    player.acted = true;
  } else if (action === "raise") {
    const maxBet = player.bet + player.stack;
    let targetBet;
    if (explicitRaise) {
      targetBet = Number(raiseTargetBet);
    } else if (room.currentBet === 0) {
      targetBet = Math.min(player.bet + BIG_BLIND, maxBet);
    } else {
      targetBet = Math.min(player.bet + toCall + RAISE_AMOUNT, maxBet);
    }
    const rerr = raiseTargetError(room, player, targetBet);
    if (rerr !== null) return { ok: false, raiseErr: rerr, explicitRaise };
    const pay = targetBet - player.bet;
    player.stack -= pay;
    player.bet = targetBet;
    room.pot += pay;
    player.allIn = player.stack === 0;
    const reopens = targetBet > room.currentBet;
    room.currentBet = Math.max(room.currentBet, player.bet);
    if (reopens) {
      room.players.forEach((p) => { if (!p.folded && !p.out) p.acted = false; });
    }
    player.acted = true;
  } else {
    return { ok: false };
  }

  if (activeCount(room.players) === 1) {
    await finishHand(room);
    return { ok: true };
  }

  if (canAdvanceStreet(room)) {
    moveStreet(room);
    if (room.phase === "showdown") {
      await finishHand(room);
      return { ok: true };
    }
    broadcastState(room, `Dealing ${room.phase}...`);
    return { ok: true };
  }

  const turnIdx = room.players.findIndex((p) => p.id === room.currentTurn);
  if (turnIdx === -1) {
    broadcastState(room);
    return { ok: true };
  }
  const nextIdx = nextActiveIndex(room.players, turnIdx);
  room.currentTurn = room.players[nextIdx].id;
  broadcastState(room);
  return { ok: true };
}

function pickBotAction(room, player) {
  const toCall = Math.max(0, room.currentBet - player.bet);
  const strength = estimateBotStrength(player, room.board);
  const hints = getBettingHints(room, player);
  const canRaise = canPlayerRaise(room, player);
  if (toCall > 0 && strength < 0.35 && Math.random() < 0.55) return { type: "fold" };
  if (canRaise && strength > 0.68 && Math.random() < 0.35) {
    const minB = hints.minRaiseBet;
    const span = Math.max(0, hints.maxBet - minB);
    let t = span === 0 ? minB : minB + Math.floor(Math.random() * (span + 1));
    t = Math.min(hints.maxBet, Math.max(minB, t));
    if (raiseTargetError(room, player, t) !== null) t = minB;
    if (raiseTargetError(room, player, t) !== null) return { type: "checkcall" };
    return { type: "raise", targetBet: t };
  }
  return { type: "checkcall" };
}

async function runBotTurnLoop(room) {
  let safety = 0;
  while (room.phase !== "waiting" && room.phase !== "showdown" && safety < 16) {
    const current = room.players.find((p) => p.id === room.currentTurn);
    if (!current || !current.isBot || current.folded || current.out) return;
    const botAction = pickBotAction(room, current);
    if (botAction.type === "raise") await applyAction(room, current.id, "raise", botAction.targetBet);
    else await applyAction(room, current.id, botAction.type, undefined);
    safety += 1;
  }
}

function startHand(room) {
  clearRoomTurnTimer(room);
  clearAutoDealTimer(room);
  let seated = room.players.filter((p) => !p.out);
  if (seated.length < 2) {
    const autoBot = addBotToRoom(room);
    if (autoBot) {
      broadcastState(room, `${autoBot.name} auto-joined so the hand can start.`);
      seated = room.players.filter((p) => !p.out);
    }
  }
  if (seated.length < 2) {
    broadcastState(room, "Need at least 2 players with chips.");
    return;
  }
  room.deck = createDeck();
  room.board = [];
  room.pot = 0;
  room.phase = "preflop";
  room.players.forEach((p) => {
    p.cards = [];
    p.folded = p.out;
    p.bet = 0;
    p.acted = false;
    p.allIn = false;
    p.wasInHand = !p.out;
  });

  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < room.players.length; i += 1) {
      const idx = (room.dealerIndex + 1 + i) % room.players.length;
      const p = room.players[idx];
      if (!p.out) p.cards.push(room.deck.pop());
    }
  }

  const buttonIdx = room.dealerIndex;
  const sb = nextActiveIndex(room.players, buttonIdx);
  const bb = nextActiveIndex(room.players, sb);

  const sbPlayer = room.players[sb];
  const bbPlayer = room.players[bb];
  const sbPay = Math.min(sbPlayer.stack, SMALL_BLIND);
  const bbPay = Math.min(bbPlayer.stack, BIG_BLIND);
  sbPlayer.stack -= sbPay;
  sbPlayer.bet += sbPay;
  bbPlayer.stack -= bbPay;
  bbPlayer.bet += bbPay;
  room.pot += sbPay + bbPay;
  sbPlayer.allIn = sbPlayer.stack === 0;
  bbPlayer.allIn = bbPlayer.stack === 0;

  room.currentBet = bbPlayer.bet;
  const firstToActIdx = nextActiveIndex(room.players, bb);
  room.currentTurn = room.players[firstToActIdx].id;
  room.buttonIndex = buttonIdx;
  room.sbIndex = sb;
  room.bbIndex = bb;
  room.handNumber = (room.handNumber || 0) + 1;
  room.dealerIndex = nextActiveIndex(room.players, buttonIdx);
  broadcastState(room, "Hand started.");
}

function addBotToRoom(room) {
  const botCount = room.players.filter((p) => p.isBot).length;
  if (botCount >= MAX_BOTS || room.players.length >= MAX_PLAYERS) return null;
  const id = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const bot = {
    id,
    name: randomBotName(room),
    stack: 1000,
    hands: 0,
    wins: 0,
    avatar: "",
    cards: [],
    bet: 0,
    folded: false,
    acted: false,
    out: false,
    allIn: false,
    wasInHand: false,
    isBot: true,
  };
  room.players.push(bot);
  return bot;
}

async function resetRoomChips(room, amount = 1000) {
  clearRoomTurnTimer(room);
  clearAutoDealTimer(room);
  for (const player of room.players) {
    player.stack = amount;
    player.bet = 0;
    player.folded = false;
    player.out = false;
    player.allIn = false;
    player.cards = [];
    if (!player.isBot) {
      await saveStack(player.name, amount);
    }
  }
  room.phase = "waiting";
  room.pot = 0;
  room.board = [];
  room.currentBet = 0;
  room.currentTurn = null;
  room.handNumber = 0;
  room.buttonIndex = null;
  room.sbIndex = null;
  room.bbIndex = null;
}

function sanitizeName(raw) {
  const s = String(raw || "").trim().slice(0, 16);
  return s || "Player";
}

io.on("connection", (socket) => {
  socket.on("register", async ({ name, password }) => {
    try {
      const cleanName = sanitizeName(name);
      if (!validatePassword(password)) {
        io.to(socket.id).emit("error_message", "Password must be 6-72 characters.");
        return;
      }
      const result = await registerProfile(cleanName, password);
      if (!result.ok) {
        io.to(socket.id).emit("error_message", result.message);
        return;
      }
      socket.data.authName = result.profile.name;
      io.to(socket.id).emit("auth_ok", {
        name: result.profile.name,
        chips: result.profile.chips,
        hands: result.profile.hands,
        wins: result.profile.wins,
        avatar: result.profile.avatar || "",
      });
    } catch (err) {
      io.to(socket.id).emit("error_message", "Registration failed.");
    }
  });

  socket.on("login", async ({ name, password }) => {
    try {
      const cleanName = sanitizeName(name);
      const result = await loginProfile(cleanName, password);
      if (!result.ok) {
        io.to(socket.id).emit("error_message", result.message);
        return;
      }
      socket.data.authName = result.profile.name;
      io.to(socket.id).emit("auth_ok", {
        name: result.profile.name,
        chips: result.profile.chips,
        hands: result.profile.hands,
        wins: result.profile.wins,
        avatar: result.profile.avatar || "",
      });
    } catch (err) {
      io.to(socket.id).emit("error_message", "Login failed.");
    }
  });

  socket.on("create_room", async () => {
    if (!socket.data.authName) {
      io.to(socket.id).emit("error_message", "Login required.");
      return;
    }
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const profile = await ensureProfile(socket.data.authName);

    const room = {
      code,
      hostId: socket.id,
      players: [{
        id: socket.id,
        name: profile.name,
        stack: profile.chips,
        hands: profile.hands,
        wins: profile.wins,
        avatar: profile.avatar || "",
        cards: [],
        bet: 0,
        folded: false,
        acted: false,
        out: false,
        allIn: false,
        wasInHand: false,
        isBot: false,
      }],
      deck: [],
      board: [],
      pot: 0,
      dealerIndex: 0,
      currentTurn: null,
      currentBet: 0,
      phase: "waiting",
      handNumber: 0,
      buttonIndex: null,
      sbIndex: null,
      bbIndex: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    io.to(socket.id).emit("room_joined", { code, playerId: socket.id, host: true, hostId: room.hostId });
    broadcastState(room, `${room.players[0].name} created room ${code}.`);
  });

  socket.on("join_room", async ({ code }) => {
    if (!socket.data.authName) {
      io.to(socket.id).emit("error_message", "Login required.");
      return;
    }
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) {
      io.to(socket.id).emit("error_message", "Room not found.");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      io.to(socket.id).emit("error_message", "Room is full.");
      return;
    }
    if (room.players.some((p) => p.name.toLowerCase() === socket.data.authName.toLowerCase())) {
      io.to(socket.id).emit("error_message", "Name already used in this room.");
      return;
    }
    const profile = await ensureProfile(socket.data.authName);
    room.players.push({
      id: socket.id,
      name: profile.name,
      stack: profile.chips,
      hands: profile.hands,
      wins: profile.wins,
      avatar: profile.avatar || "",
      cards: [],
      bet: 0,
      folded: false,
      acted: false,
      out: false,
      allIn: false,
      wasInHand: false,
      isBot: false,
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    io.to(socket.id).emit("room_joined", { code: room.code, playerId: socket.id, host: false, hostId: room.hostId });
    broadcastState(room, `${profile.name} joined.`);
  });

  socket.on("start_hand", async () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase !== "waiting") return;
    clearAutoDealTimer(room);
    startHand(room);
    await runBotTurnLoop(room);
  });

  socket.on("add_bot", async () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase !== "waiting") {
      io.to(socket.id).emit("error_message", "Add bots only between hands.");
      return;
    }
    const bot = addBotToRoom(room);
    if (!bot) {
      io.to(socket.id).emit("error_message", "Bot limit reached for this room.");
      return;
    }
    broadcastState(room, `${bot.name} joined as a bot.`);
  });

  socket.on("admin_remove_bot", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase !== "waiting") {
      io.to(socket.id).emit("error_message", "Remove bots only between hands.");
      return;
    }
    const idx = room.players.findIndex((p) => p.isBot);
    if (idx === -1) {
      io.to(socket.id).emit("error_message", "No bot to remove.");
      return;
    }
    const [removed] = room.players.splice(idx, 1);
    broadcastState(room, `${removed.name} was removed by admin.`);
  });

  socket.on("admin_force_end_hand", async () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase === "waiting" || room.phase === "showdown") {
      io.to(socket.id).emit("error_message", "No active hand to end.");
      return;
    }
    await finishHand(room, "Admin ended hand. ");
  });

  socket.on("admin_reset_chips", async () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    await resetRoomChips(room, 1000);
    broadcastState(room, "Admin reset all chips to 1000.");
  });

  socket.on("admin_kick_player", async ({ targetId }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!targetId) return;

    const target = room.players.find((p) => p.id === targetId);
    if (!target || target.isBot) {
      io.to(socket.id).emit("error_message", "Select a valid human player.");
      return;
    }
    if (target.id === socket.id) {
      io.to(socket.id).emit("error_message", "Host cannot kick themselves.");
      return;
    }

    await saveStack(target.name, target.stack);
    room.players = room.players.filter((p) => p.id !== target.id);

    const targetSocket = io.sockets.sockets.get(target.id);
    if (targetSocket) {
      targetSocket.leave(room.code);
      targetSocket.data.roomCode = undefined;
      io.to(target.id).emit("error_message", "You were kicked by the host.");
      io.to(target.id).emit("kicked_from_room");
    }

    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.currentTurn === target.id) {
      room.currentTurn = room.players[0].id;
    }
    broadcastState(room, `${target.name} was kicked by admin.`);
    await runBotTurnLoop(room);
  });

  socket.on("action", async ({ type, targetBet }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const res = await applyAction(room, socket.id, type, targetBet);
    if (res && !res.ok && res.explicitRaise && res.raiseErr) {
      io.to(socket.id).emit("error_message", humanRaiseError(res.raiseErr));
    }
    await runBotTurnLoop(room);
  });

  socket.on("table_stream_subscribe", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (!room.players.some((p) => p.id === socket.id)) return;
    socket.to(room.code).emit("stream_subscriber", { viewerId: socket.id });
  });

  socket.on("webrtc_relay", ({ to, payload }) => {
    if (!to || !payload || !payload.type) return;
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const ids = new Set(room.players.map((p) => p.id));
    if (!ids.has(socket.id) || !ids.has(to)) return;
    io.to(to).emit("webrtc_relay", { from: socket.id, payload });
  });

  socket.on("table_stream_stop", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (!room.players.some((p) => p.id === socket.id)) return;
    socket.to(room.code).emit("peer_stream_stopped", { broadcasterId: socket.id });
  });

  socket.on("set_avatar", async ({ avatar }) => {
    try {
      if (!socket.data.authName) {
        io.to(socket.id).emit("error_message", "Login required.");
        return;
      }
      const cleanAvatar = sanitizeAvatarDataUrl(avatar);
      if (!cleanAvatar) {
        io.to(socket.id).emit("error_message", "Invalid avatar image.");
        return;
      }
      await saveAvatar(socket.data.authName, cleanAvatar);

      const code = socket.data.roomCode;
      if (code && rooms.has(code)) {
        const room = rooms.get(code);
        const player = room.players.find((p) => p.id === socket.id);
        if (player) player.avatar = cleanAvatar;
        broadcastState(room, `${player ? player.name : "Player"} updated profile picture.`);
      }
      io.to(socket.id).emit("avatar_saved", { avatar: cleanAvatar });
    } catch (err) {
      io.to(socket.id).emit("error_message", "Saving avatar failed.");
    }
  });

  socket.on("disconnect", async () => {
    const code = socket.data.roomCode;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const leaving = room.players.find((p) => p.id === socket.id);
    if (leaving) await saveStack(leaving.name, leaving.stack);
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.currentTurn === socket.id) room.currentTurn = room.players[0].id;
    broadcastState(room, "A player disconnected.");
  });
});

initDb().then(() => {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Texas Hold'em server running at http://localhost:${PORT}`);
  });
});
