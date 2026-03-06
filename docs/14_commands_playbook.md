# 14. Commands Playbook

This document lists the essential commands for developing, testing, and deploying the application.

## 1. Setup

### 1.1 Installation
```bash
npm install
```

### 1.2 Environment Variables
Ensure `.env` is configured (see `.env.example`).

## 2. Development

### 2.1 Start Dev Server
Starts both the Backend (Express) and Frontend (Vite) in development mode.
```bash
npm run dev
```
*   **Frontend:** http://localhost:5173
*   **Backend:** http://localhost:3000

### 2.2 Database Management (Prisma)
*   **Migrate (Dev):** Apply schema changes.
    ```bash
    npx prisma migrate dev
    ```
*   **Studio:** Open DB GUI.
    ```bash
    npx prisma studio
    ```
*   **Reset:** Wipe DB and re-seed.
    ```bash
    npx prisma migrate reset
    ```

## 3. Testing

### 3.1 Run All Tests
```bash
npm test
```

### 3.2 Run Specific Test File
```bash
npx jest backend/src/services/traffic-engine.test.ts
```

### 3.3 Coverage
```bash
npm run test:coverage
```

## 4. Code Quality

### 4.1 Linting
```bash
npm run lint
```

### 4.2 Formatting
```bash
npm run format
```

## 5. Performance

### 5.1 Seed Large Topology
Generates 10k devices for load testing.
```bash
npm run perf:seed
```

### 5.2 Run Load Test
Runs Artillery/K6 benchmark.
```bash
npm run perf:load
```

## 6. Production Build

### 6.1 Build
Compiles TypeScript and bundles Frontend.
```bash
npm run build
```

### 6.2 Start Production Server
```bash
npm start
```
