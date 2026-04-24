# Unbias

Unbiased candidate evaluation for hiring panels. Create a session, share the link, collect honest ratings independently, then reveal all votes together.

Built to remove groupthink and seniority bias from interview feedback. Each interviewer submits their verdict privately before anyone sees the results.

---

## How it works

1. **Create a session** — enter the candidate's first name and get a memorable token (e.g. `brave-lion-42`)
2. **Share the link** — send it to everyone in the interview panel
3. **Vote independently** — each person rates the candidate (Strong Yes / Yes / Unsure / No / Strong No) and adds written notes on positives, concerns and anything else
4. **Reveal together** — one click reveals all votes simultaneously. The session closes and no further votes can be submitted.

Sessions expire automatically after 72 hours. No accounts, no logins.

---

## Running locally

No cloud account needed. The app runs with in-memory storage automatically when no Google Cloud project is detected.

```bash
npm install
npm run dev
```

Open http://localhost:8080

Data resets on server restart — intentional for local development.

---

## Stack

- **Node.js + Express** — serves the app and all API routes
- **Vanilla JS** — single HTML file frontend, no framework
- **Google Cloud Firestore** — data storage in production (auto-detected)
- **In-memory store** — used automatically when running locally

---

## Optimised for Google Cloud Run

The app is designed to deploy directly to Cloud Run with a single command. Cloud Run provides automatic scaling, HTTPS, and a generous free tier that covers typical internal hiring volumes at zero cost.

Firestore credentials are picked up automatically via the Cloud Run service account — no API keys, no `.env` files, nothing to manage.

### First-time Google Cloud setup

Enable the required APIs in your project:

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com --project=YOUR_PROJECT_ID
```

Create the Firestore database (Native mode, once per project):

**Console → Firestore → Create database → Native mode → choose region → Create**

Create the Artifact Registry repository for Docker images:

```bash
gcloud artifacts repositories create unbias \
  --repository-format=docker \
  --location=europe-west3 \
  --project=YOUR_PROJECT_ID
```

### Deploy via GitHub Actions

Every push to `main` deploys automatically. Two GitHub secrets are required:

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_SA_KEY` | JSON key for a service account with Cloud Run Admin, Artifact Registry Writer, Service Account User, and Cloud Datastore User roles |

Add secrets at: **github.com/YOUR_USERNAME/unbias → Settings → Secrets and variables → Actions**

### Manual deploy

```bash
gcloud run deploy unbias \
  --source . \
  --region europe-west3 \
  --allow-unauthenticated \
  --project YOUR_PROJECT_ID
```

---

## Data and privacy

- Candidate first names and interviewer notes are stored in Google Cloud Firestore, encrypted at rest
- All session data is deleted automatically after 72 hours
- No cookies, no tracking, no third-party analytics
- No full names — first names only for both candidates and interviewers
- A privacy information page is available in the app at `/privacy`
