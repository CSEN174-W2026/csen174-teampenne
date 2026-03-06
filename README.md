# CSEN-174 Distributed System Manager

This repo has three apps that run together:

- `backend` - FastAPI manager API on port `8000`
- `web` - Next.js API + MikroORM/Postgres integration on port `3000`
- `frontend` - Vite React dashboard on port `5173`

The frontend talks to backend and web through Vite proxies:

- `/manager-api` -> `http://localhost:8000`
- `/web-api` -> `http://localhost:3000`

## 1) Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm 9+
- Python 3.11+ (3.12 works)
- Docker + Docker Compose
- A Firebase project (Auth enabled)
- AWS account credentials (for EC2 node mode)
- Terraform 1.5+ (for automated EC2 provisioning)

## 2) Clone and install dependencies

From repo root:

```bash
cd /root/csen-174
```

Install frontend deps:

```bash
cd frontend
npm install
```

Install web deps:

```bash
cd ../web
npm install
```

Install backend deps (venv):

```bash
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install fastapi "uvicorn[standard]" requests firebase-admin boto3
```

## 3) Environment variables

### `backend/.env`

Create/update `backend/.env`:

```env
DB_NAME=systems-manager
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json
FIREBASE_WEB_API_KEY=your-firebase-web-api-key

# Optional bootstrap admin (will set admin claim if user exists)
ADMIN_EMAIL=admin@example.com

# EC2 node discovery
AWS_REGION=us-east-1
EC2_NODE_TAG_KEY=aimse:node
EC2_NODE_TAG_VALUE=true
NODE_SERVICE_PORT=5001
```

Notes:

- `FIREBASE_SERVICE_ACCOUNT_PATH` must point to a real JSON file on disk.
- If you prefer inline JSON instead of a file, use `FIREBASE_SERVICE_ACCOUNT_JSON` (and omit `FIREBASE_SERVICE_ACCOUNT_PATH`).

### `web/.env`

Create/update `web/.env`:

```env
DB_NAME=systems-manager
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
PY_AGENT_BASE_URL=http://127.0.0.1:8000
```

### `frontend/.env`

Create/update `frontend/.env`:

```env
VITE_API_BASE=/manager-api
VITE_WEB_API_BASE=/web-api

VITE_FIREBASE_API_KEY=your-firebase-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
VITE_FIREBASE_APP_ID=your-firebase-app-id
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

Important:

- Use `VITE_FIREBASE_STORAGE_BUCKET` (not `VITE_STORAGE_BUCKET`).

## 4) Database setup (Postgres + migrations)

Start Postgres from the `web` folder:

```bash
cd /root/csen-174/web
docker compose up -d db
```

Run MikroORM migrations:

```bash
npm run db:migrate
```

Optional DB check:

```bash
docker ps
```

You should see container `csen174-postgres` running on port `5432`.

## 5) Run all services

Start in this order (recommended):

1. Backend API
2. Web API (Next.js)
3. Frontend UI (Vite)

### Terminal 1 - backend

```bash
cd /root/csen-174/backend
source .venv/bin/activate
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 2 - web

```bash
cd /root/csen-174/web
npm run dev
```

### Terminal 3 - frontend

```bash
cd /root/csen-174/frontend
npm run dev
```

Open UI at:

- `http://localhost:5173`

## 6) First login / auth setup

- Enable Email/Password auth in Firebase Console.
- Create a user either:
  - in Firebase Console, or
  - from the app Sign Up flow.
- If `ADMIN_EMAIL` is set in `backend/.env`, backend startup will try to mark that user as admin.

## 7) Quick health checks

- Backend health: `http://127.0.0.1:8000/health`
- Web API test (if web is running): `http://127.0.0.1:3000`
- Frontend: `http://127.0.0.1:5173`

## 8) Common issues

- `Invalid Firebase token`
  - Check frontend/backend are using the same Firebase project.
  - Verify `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_WEB_API_KEY`.
- `FileNotFoundError` for service account JSON
  - Fix `FIREBASE_SERVICE_ACCOUNT_PATH` to a valid absolute path.
- Frontend can load but API calls fail
  - Ensure backend (`8000`) and web (`3000`) are running.
  - Ensure `VITE_API_BASE=/manager-api` and `VITE_WEB_API_BASE=/web-api`.
- DB/migration errors
  - Ensure Postgres container is running and `web/.env` DB values match compose config.

## 9) Useful commands

From `web`:

```bash
npm run db:migration:create
npm run db:migrate
```

From `frontend`:

```bash
npm run build
```

From `backend`:

```bash
source .venv/bin/activate
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 10) Terraform EC2 automation

Provision EC2 worker nodes that the manager auto-discovers by tag:

```bash
cd /root/csen-174/infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with your VPC/subnet/AMI
terraform init
terraform plan
terraform apply
```

Detailed guide: `infra/terraform/README.md`

