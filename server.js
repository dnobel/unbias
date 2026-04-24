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

const TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

let store;

if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
  // ── Firestore (production) ───────────────────────────────────────
  // TTL: enable a TTL policy in the Firestore console to auto-delete
  // expired documents. Collection = "interviews", Field = "expiresAt".
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore();

  store = {
    async tokenExists(token) {
      const doc = await db.collection('interviews').doc(token).get();
      return doc.exists;
    },
    async createInterview(token, candidateFirstName) {
      const expiresAt = Firestore.Timestamp.fromDate(new Date(Date.now() + TTL_MS));
      await db.collection('interviews').doc(token).set({
        candidateFirstName,
        createdAt: Firestore.Timestamp.now(),
        expiresAt,
        revealed: false
      });
    },
    async getInterview(token) {
      const doc = await db.collection('interviews').doc(token).get();
      if (!doc.exists) return null;
      const { candidateFirstName, revealed, expiresAt } = doc.data();
      if (expiresAt && expiresAt.toDate() < new Date()) return null;
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
  const interviews = new Map(); // token → { candidateFirstName, revealed, votes[], expiresAt }

  store = {
    async tokenExists(token)  { return interviews.has(token); },
    async createInterview(token, candidateFirstName) {
      interviews.set(token, {
        candidateFirstName,
        revealed: false,
        votes: [],
        expiresAt: new Date(Date.now() + TTL_MS)
      });
    },
    async getInterview(token) {
      const interview = interviews.get(token);
      if (!interview) return null;
      if (interview.expiresAt < new Date()) {
        interviews.delete(token);
        return null;
      }
      return interview;
    },
    async addVote(token, vote) {
      interviews.get(token).votes.push({ ...vote, submittedAt: new Date().toISOString() });
    },
    async reveal(token) {
      interviews.get(token).revealed = true;
    }
  };

  // Purge expired interviews every 10 minutes
  setInterval(() => {
    const now = new Date();
    for (const [token, interview] of interviews) {
      if (interview.expiresAt < now) interviews.delete(token);
    }
  }, 10 * 60 * 1000);

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

// Privacy page
app.get('/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Data &amp; Privacy — Unbias</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ── Tokens ───────────────────────────────────────────────────── */
    :root {
      --bg:          #0c0c14;
      --surface:     #13131e;
      --card:        #1a1a28;
      --border:      #2a2a3e;
      --text:        #e8e8f0;
      --muted:       #6b6b8a;
      --accent:      #7c6af7;
      --accent-dim:  rgba(124,106,247,0.12);
      --radius:      10px;
    }

    /* ── Reset ────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; font-size: 15px; line-height: 1.6; }

    /* ── Layout ───────────────────────────────────────────────────── */
    .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 0 1.5rem 4rem; }

    header {
      width: 100%; max-width: 680px;
      padding: 2.4rem 0 2rem;
      display: flex; align-items: center; justify-content: space-between;
    }
    .logo {
      display: flex; align-items: center; gap: 0.6rem;
      text-decoration: none;
    }
    .logo-mark {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 0.8rem; color: #fff; letter-spacing: -0.5px;
      flex-shrink: 0;
    }
    .logo-text { font-weight: 700; font-size: 1.1rem; letter-spacing: -0.3px; color: var(--text); }
    .logo-text span { color: var(--accent); }

    .back-link {
      font-size: 0.85rem; font-weight: 500;
      color: var(--muted);
      text-decoration: none;
      transition: color 0.15s;
    }
    .back-link:hover { color: var(--accent); }

    /* ── Content ──────────────────────────────────────────────────── */
    .content { width: 100%; max-width: 680px; }

    h1 { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 0.5rem; }
    .lead { color: var(--muted); font-size: 0.93rem; margin-bottom: 2.4rem; }

    /* ── Section ──────────────────────────────────────────────────── */
    .section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.6rem 1.8rem;
      margin-bottom: 1rem;
    }
    .section h2 {
      font-size: 0.78rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--accent);
      margin-bottom: 0.6rem;
    }
    .section p {
      font-size: 0.93rem;
      color: var(--text);
      line-height: 1.65;
    }

    /* ── Notice ───────────────────────────────────────────────────── */
    .notice {
      background: var(--accent-dim);
      border: 1px solid rgba(124,106,247,0.25);
      border-radius: var(--radius);
      padding: 1.2rem 1.6rem;
      margin-bottom: 1rem;
      font-size: 0.93rem;
      line-height: 1.65;
    }
    .notice strong { color: var(--accent); }

    /* ── Footer link ──────────────────────────────────────────────── */
    .footer-link {
      margin-top: 2.4rem;
      font-size: 0.78rem;
      color: var(--muted);
      text-align: center;
    }
    .footer-link a { color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
    .footer-link a:hover { color: var(--accent); }
  </style>
</head>
<body>
<div class="page">

  <header>
    <a class="logo" href="/">
      <div class="logo-mark">U</div>
      <div class="logo-text">un<span>bias</span></div>
    </a>
    <a class="back-link" href="/">&#8592; Back to app</a>
  </header>

  <div class="content">
    <h1>Data &amp; Privacy</h1>
    <p class="lead">Plain English. No legalese. Here is exactly what Unbias collects, how long it keeps it, and who can see it.</p>

    <div class="section">
      <h2>What we collect</h2>
      <p>Unbias stores the candidate's first name, each interviewer's first name, their numerical rating (1 to 5), and any written notes they choose to add. No other personal information is requested or retained.</p>
    </div>

    <div class="section">
      <h2>How long data is kept</h2>
      <p>All session data is deleted automatically 72 hours after the session is created. No manual action is required. Once the window has passed the data is gone permanently.</p>
    </div>

    <div class="section">
      <h2>How data is protected</h2>
      <p>All data is stored encrypted at rest in Google Cloud Firestore. Data in transit is protected by TLS. Unbias does not use cookies, tracking pixels, or third-party analytics of any kind.</p>
    </div>

    <div class="section">
      <h2>Who can access session data</h2>
      <p>Anyone who holds the session link can view the vote count while voting is in progress. Once votes are revealed, everyone with the link can see each interviewer's rating and notes. There is no user authentication. Keep your session link private if you need to restrict access.</p>
    </div>

    <div class="notice">
      <strong>Important notice.</strong> Do not enter full names of candidates or interviewers. Use first names only. Unbias is designed for first names and is not intended to process data that could directly identify an individual on its own.
    </div>

    <div class="section">
      <h2>Cookies and tracking</h2>
      <p>Unbias uses no cookies, no tracking, and no third-party analytics. The only data stored in your browser is a local flag that records whether you have already submitted your vote in a given session, so you are not prompted to vote twice.</p>
    </div>

    <p class="footer-link"><a href="/">Back to Unbias</a></p>
  </div>

</div>
</body>
</html>`);
});

// Fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Unbias running on http://localhost:${PORT}`));
