'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// DATA_DIR is mounted as a Docker volume → survives container restarts.
// Falls back to a local ./data/ dir when running outside Docker.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'poll.db'));

// WAL mode: better concurrent read performance, safe for single-writer SQLite
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    question  TEXT NOT NULL DEFAULT 'When can we meet?',
    vote_type TEXT NOT NULL DEFAULT 'multiple'
  );

  CREATE TABLE IF NOT EXISTS options (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    text     TEXT    NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_name TEXT    NOT NULL,
    option_id  INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
    voted_at   TEXT    NOT NULL
  );
`);

// Seed the single config row if this is a fresh database
if (!db.prepare('SELECT 1 FROM config WHERE id = 1').get()) {
  db.prepare(
    "INSERT INTO config (id, question, vote_type) VALUES (1, 'When can we meet?', 'multiple')"
  ).run();
}

// ── Prepared statements (compiled once, reused on every call) ─────
const stmts = {
  getConfig:   db.prepare('SELECT question, vote_type FROM config WHERE id = 1'),
  getOptions:  db.prepare('SELECT id, text FROM options ORDER BY position'),
  getVoters:   db.prepare(
    'SELECT voter_name AS name, voted_at AS ts FROM votes WHERE option_id = ? ORDER BY voted_at'
  ),
  findVote:    db.prepare('SELECT id FROM votes WHERE voter_name = ? AND option_id = ?'),
  deleteVote:  db.prepare('DELETE FROM votes WHERE id = ?'),
  insertVote:  db.prepare('INSERT INTO votes (voter_name, option_id, voted_at) VALUES (?, ?, ?)'),
  clearUser:   db.prepare('DELETE FROM votes WHERE voter_name = ?'),
  clearVotes:  db.prepare('DELETE FROM votes'),
  clearOpts:   db.prepare('DELETE FROM options'),
  updateCfg:   db.prepare('UPDATE config SET question = ?, vote_type = ? WHERE id = 1'),
  insertOpt:   db.prepare('INSERT INTO options (text, position) VALUES (?, ?)'),
  resetConfig: db.prepare(
    "UPDATE config SET question = 'When can we meet?', vote_type = 'multiple' WHERE id = 1"
  ),
};

// ── Public API ────────────────────────────────────────────────────

/**
 * Returns the full poll state: question, voteType, and options with their voters.
 */
function getPoll() {
  const cfg     = stmts.getConfig.get();
  const options = stmts.getOptions.all().map(opt => ({
    id:     String(opt.id),   // string so the frontend Set() works consistently
    text:   opt.text,
    voters: stmts.getVoters.all(opt.id).map(v => ({
      name: v.name,
      ts:   formatTs(v.ts),
    })),
  }));
  return { question: cfg.question, voteType: cfg.vote_type, options };
}

/**
 * Replaces the poll question, vote type, and all options.
 * All existing votes are cleared (option IDs change).
 */
function setConfig(question, voteType, optionTexts) {
  db.transaction(() => {
    stmts.updateCfg.run(question, voteType);
    stmts.clearVotes.run();
    stmts.clearOpts.run();
    optionTexts.forEach((text, i) => stmts.insertOpt.run(text, i));
  })();
}

/**
 * Toggles a vote for voterName on optionId.
 * Returns 'added' or 'removed'.
 */
function toggleVote(voterName, optionId) {
  const existing = stmts.findVote.get(voterName, optionId);
  if (existing) {
    stmts.deleteVote.run(existing.id);
    return 'removed';
  }
  stmts.insertVote.run(voterName, optionId, new Date().toISOString());
  return 'added';
}

/**
 * Removes all votes for voterName — used in select-one mode before casting.
 */
function clearVoteForUser(voterName) {
  stmts.clearUser.run(voterName);
}

/**
 * Resets everything: clears votes, options, and resets config to defaults.
 */
function clearAll() {
  db.transaction(() => {
    stmts.clearVotes.run();
    stmts.clearOpts.run();
    stmts.resetConfig.run();
  })();
}

// ── Helpers ───────────────────────────────────────────────────────

function formatTs(isoStr) {
  if (!isoStr) return '';
  try {
    const d  = new Date(isoStr);
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${mo[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

module.exports = { getPoll, setConfig, toggleVote, clearVoteForUser, clearAll };
