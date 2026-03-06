# 14. Commands Playbook

This document lists the commands used in the current codebase.

## 1. Setup

### 1.1 Install dependencies
```bash
npm install
```

### 1.2 Environment
Create `.env` from `.env.example` and ensure:
- `DATABASE_URL`
- `GEMINI_API_KEY` (optional for non-AI paths)
- `APP_URL` (optional local)

## 2. Development

### 2.1 Start development server
```bash
npm run dev
```
Runs Express backend and Vite middleware in one process on:
- `http://localhost:3000`

### 2.2 Prisma
```bash
npx prisma generate
npx prisma db push
npx prisma studio
```

## 3. Testing

### 3.1 Run all tests
```bash
npm test
```

### 3.2 Run smoke test only
```bash
npm run test:smoke
```

## 4. Code Quality

### 4.1 Type/lint checks
```bash
npm run lint
```

## 5. Build

### 5.1 Production bundle
```bash
npm run build
```

### 5.2 Preview built frontend
```bash
npm run preview
```

## 6. Performance (reserved)

```bash
npm run perf:seed
npm run perf:load
```
These entries are reserved for upcoming large-topology benchmarking.
