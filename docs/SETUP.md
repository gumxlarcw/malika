# Developer Setup Guide

## Prerequisites
- Node.js 20+
- npm 9+
- MySQL 8+
- PM2 (optional for production-like runs)

## Repository Layout
- backend/ — Express API
- backend/admin/ — Next.js Admin Panel
- frontend/ — Public PWA

## Environment Configuration
### Backend
Create backend/.env (see .github/copilot-instructions.md for full list):

Required:
- DB_NAME
- DB_USER
- DB_PASS
- DB_HOST
- JWT_SECRET

Optional:
- OPENAI_API_KEY_* (server-side only)
- BPS_API_KEY
- VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
- AUTOMATION_* flags

### Frontend PWA
Create frontend/.env.local:
- NEXT_PUBLIC_BPS_API_KEY
- NEXT_PUBLIC_API_BASE_URL
- NEXT_PUBLIC_VAPID_PUBLIC_KEY

## Database Setup
1. Create database:
   - project_data_strategis
2. Ensure credentials match backend/.env
3. Start backend once to auto-sync models.

## Install Dependencies
From repository root:
- backend: npm install
- backend/admin: npm install
- frontend: npm install

## Run Locally
### Backend API
- cd backend
- npm start
- Health check: http://localhost:5000/health
- OpenAPI: http://localhost:5000/api-docs

### Admin Panel (Dev)
- cd backend/admin
- npm run dev -p 5050
- URL: http://localhost:5050/backend

### Public PWA (Dev)
- cd frontend
- npm run dev -p 3000
- URL: http://localhost:3000

## Common Tasks
- Run backend tests: cd backend && npm test
- Run admin lint: cd backend/admin && npm run lint
- Run PWA tests: cd frontend && npm run test:nonexim
- Load test (smoke): cd backend && npm run load:smoke

## Troubleshooting
- If /login redirects incorrectly in admin, ensure you use /backend/login.
- If DB connection fails, confirm DB_HOST and credentials.
- For cloudflared routing, review .github/copilot-instructions.md.
