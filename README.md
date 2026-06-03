# Cyberpunk Chat v2.0 — Production Setup

## Architecture
- **Backend**: Express.js + PostgreSQL + WebSocket
- **Frontend**: Vanilla JS (Cyberpunk UI from v1.0)
- **File Storage**: Local disk (with database tracking)

## Prerequisites
- Node.js >= 18
- PostgreSQL >= 14
- 1GB RAM minimum (2GB recommended)

## Setup

### 1. Database Setup
```bash
createdb cyberpunk_chat
npm run migrate
```

### 2. Environment Variables
```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Install & Start
```bash
npm install
npm start
```