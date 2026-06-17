'use strict';

const express = require('express');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────

// GET /api/poll
// Returns full poll state: question, voteType, options with voters.
app.get('/api/poll', (_req, res) => {
  try {
    res.json(db.getPoll());
  } catch (err) {
    console.error('[GET /api/poll]', err);
    res.status(500).json({ error: 'Failed to load poll' });
  }
});

// POST /api/admin/config
// Body: { question: string, voteType: 'one'|'multiple', options: string[] }
// Replaces the poll question, type, and options. Clears all votes.
app.post('/api/admin/config', (req, res) => {
  const { question, voteType, options } = req.body ?? {};

  if (!question?.trim())
    return res.status(400).json({ error: 'question is required' });
  if (!['one', 'multiple'].includes(voteType))
    return res.status(400).json({ error: 'voteType must be "one" or "multiple"' });
  if (!Array.isArray(options) || options.filter(o => o?.trim()).length === 0)
    return res.status(400).json({ error: 'At least one option is required' });

  try {
    db.setConfig(
      question.trim(),
      voteType,
      options.map(o => o.trim()).filter(Boolean)
    );
    res.json(db.getPoll());
  } catch (err) {
    console.error('[POST /api/admin/config]', err);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// POST /api/vote
// Body: { voterName: string, optionId: string }
// Toggles a vote. In select-one mode, clears previous votes first.
app.post('/api/vote', (req, res) => {
  const { voterName, optionId } = req.body ?? {};

  if (!voterName?.trim())
    return res.status(400).json({ error: 'voterName is required' });
  if (!optionId)
    return res.status(400).json({ error: 'optionId is required' });

  try {
    const poll = db.getPoll();
    if (poll.voteType === 'one') {
      db.clearVoteForUser(voterName.trim());
    }
    db.toggleVote(voterName.trim(), Number(optionId));
    res.json(db.getPoll());
  } catch (err) {
    console.error('[POST /api/vote]', err);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// DELETE /api/admin/votes
// Resets everything to defaults (question, options, votes).
app.delete('/api/admin/votes', (_req, res) => {
  try {
    db.clearAll();
    res.json(db.getPoll());
  } catch (err) {
    console.error('[DELETE /api/admin/votes]', err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

// Fallback — serve index.html for any non-API route (future client-side routing)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Poll app listening on port ${PORT}`);
});
