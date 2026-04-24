# Unbias

Unbiased candidate evaluation for hiring panels. Create a session, share the link, collect honest ratings, reveal together.

---

## One-time setup

### 1. Create the GitHub repository

Go to https://github.com/new and create a **private** repository named `unbias`.  
Then push this code:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/unbias.git
git push -u origin main
```

---

### 2. Set up Google Cloud

#### Enable required APIs

In the Google Cloud Console (console.cloud.google.com), enable these APIs for your project:

- Cloud Run API
- Artifact Registry API
- Firestore API

#### Create Firestore database

Console → Firestore → Create database → **Native mode** → choose region `europe-west1`.

#### Create Artifact Registry repository

```bash
gcloud artifacts repositories create unbias \
  --repository-format=docker \
  --location=europe-west1 \
  --project=YOUR_PROJECT_ID
```

#### Create a service account for GitHub Actions

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions" \
  --project=YOUR_PROJECT_ID

# Grant required roles
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Download the key
gcloud iam service-accounts keys create key.json \
  --iam-account=github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

---

### 3. Add GitHub secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → New repository secret.

Add these two secrets:

| Secret name | Value |
|---|---|
| `GCP_PROJECT_ID` | Your Google Cloud project ID (e.g. `my-project-123`) |
| `GCP_SA_KEY` | The full contents of `key.json` (copy and paste the entire JSON) |

Then delete `key.json` from your machine — it is no longer needed locally:

```bash
rm key.json
```

---

## Deploy

Every push to `main` triggers an automatic deploy via GitHub Actions.

```bash
git add .
git commit -m "Your change"
git push
```

Watch the deploy in the Actions tab of your GitHub repo. When it completes, the Cloud Run URL is shown in the deploy step output.

---

## Local development

No cloud account needed locally. The app runs with in-memory storage automatically.

```bash
npm install
npm run dev
```

Open http://localhost:8080. Data resets on server restart — this is intentional for local testing.

---

## Cost

At the scale of an internal hiring tool the monthly bill is zero. Both Cloud Run and Firestore stay within their permanent free tiers.
