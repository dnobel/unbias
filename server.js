const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Token generation ─────────────────────────────────────────────────
const ADJECTIVES = [
  'brave', 'swift', 'calm', 'bold', 'keen', 'wise', 'bright', 'clear',
  'fair', 'sharp', 'quiet', 'proud', 'warm', 'cool', 'light', 'deep',
  'fresh', 'grand', 'kind', 'pure'
];
const NOUNS = [
  'lion', 'hawk', 'wolf', 'bear', 'fox', 'crane', 'deer', 'eagle',
  'owl', 'crow', 'seal', 'lynx', 'swan', 'kite', 'ibis', 'wren',
  'finch', 'dove', 'colt', 'fawn'
];

function generateToken() {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = String(Math.floor(Math.random() * 90) + 10);
  return `${adj}-${noun}-${num}`;
}

// ── Storage abstraction ──────────────────────────────────────────────
// Swaps between in-memory (local dev) and Firestore (Cloud Run).
// Detected automatically — no env vars to set.

let store;

if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
  // ── Firestore (production) ───────────────────────────────────────
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore();

  store = {
    async tokenExists(token) {
      const doc = await db.collection('interviews').doc(token).get();
      return doc.exists;
    },
    async createInterview(token, candidateFirstName) {
      await db.collection('interviews').doc(token).set({
        candidateFirstName,
        createdAt: Firestore.Timestamp.now(),
        revealed: false
      });
    },
    async getInterview(token) {
      const doc = await db.collection('interviews').doc(token).get();
      if (!doc.exists) return null;
      const { candidateFirstName, revealed } = doc.data();
      const votesSnap = await db.collection('interviews')
        .doc(token).collection('votes').orderBy('submittedAt').get();
      const votes = votesSnap.docs.map(d => d.data());
      return { candidateFirstName, revealed, votes };
    },
    async addVote(token, vote) {
      await db.collection('interviews').doc(token)
        .collection('votes').add({ ...vote, submittedAt: Firestore.Timestamp.now() });
    },
    async reveal(token) {
      await db.collection('interviews').doc(token).update({ revealed: true });
    }
  };

  console.log('Storage: Firestore');
} else {
  // ── In-memory (local dev) ────────────────────────────────────────
  const interviews = new Map(); // token → { candidateFirstName, revealed, votes[] }

  store = {
    async tokenExists(token)  { return interviews.has(token); },
    async createInterview(token, candidateFirstName) {
      interviews.set(token, { candidateFirstName, revealed: false, votes: [] });
    },
    async getInterview(token) {
      return interviews.get(token) ?? null;
    },
    async addVote(token, vote) {
      interviews.get(token).votes.push({ ...vote, submittedAt: new Date().toISOString() });
    },
    async reveal(token) {
      interviews.get(token).revealed = true;
    }
  };

  console.log('Storage: in-memory (local dev)');
}

// ── Helpers ──────────────────────────────────────────────────────────
function handleError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

async function uniqueToken() {
  for (let i = 0; i < 10; i++) {
    const token = generateToken();
    if (!(await store.tokenExists(token))) return token;
  }
  throw new Error('Could not generate unique token');
}

// ── Routes ───────────────────────────────────────────────────────────

// Create interview
app.post('/api/interviews', async (req, res) => {
  try {
    const { candidateFirstName } = req.body;
    if (!candidateFirstName?.trim())
      return res.status(400).json({ error: 'candidateFirstName is required' });

    const token = await uniqueToken();
    await store.createInterview(token, candidateFirstName.trim());
    res.json({ token });
  } catch (err) { handleError(res, err); }
});

// Get interview state
app.get('/api/interviews/:token', async (req, res) => {
  try {
    const interview = await store.getInterview(req.params.token);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    const { candidateFirstName, revealed, votes } = interview;
    const response = { candidateFirstName, revealed, voteCount: votes.length };

    if (revealed) {
      response.votes = votes.map(({ voterName, rating, positive, negative, misc }) =>
        ({ voterName, rating, positive, negative, misc }));
    }
    res.json(response);
  } catch (err) { handleError(res, err); }
});

// Submit vote
app.post('/api/interviews/:token/votes', async (req, res) => {
  try {
    const interview = await store.getInterview(req.params.token);
    if (!interview)          return res.status(404).json({ error: 'Interview not found' });
    if (interview.revealed)  return res.status(400).json({ error: 'Interview already revealed' });

    const { voterName, rating, positive, negative, misc } = req.body;
    if (!voterName?.trim())
      return res.status(400).json({ error: 'voterName is required' });
    if (![1,2,3,4,5].includes(Number(rating)))
      return res.status(400).json({ error: 'rating must be 1–5' });

    await store.addVote(req.params.token, {
      voterName: voterName.trim(),
      rating:    Number(rating),
      positive:  positive?.trim()  || '',
      negative:  negative?.trim()  || '',
      misc:      misc?.trim()      || ''
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Reveal votes
app.post('/api/interviews/:token/reveal', async (req, res) => {
  try {
    const interview = await store.getInterview(req.params.token);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });
    await store.reveal(req.params.token);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Unbias running on http://localhost:${PORT}`));
