# UNOC v3 - Network Emulator

A full-stack network planning and emulation tool built with Node.js, Express, Prisma, React, and React Flow.

## Features

*   **Network Topology:** Visual drag-and-drop interface for creating network devices (OLT, ONT, Splitter).
*   **Provisioning:** Connect devices with fiber links, enforcing port constraints.
*   **Real-Time:** Updates propagate instantly via WebSockets.
*   **Simulation:** Basic traffic generation and congestion detection (MVP).

## Tech Stack

*   **Frontend:** React 19, Vite, Tailwind CSS, React Flow.
*   **Backend:** Node.js, Express, Socket.io.
*   **Database:** SQLite (Dev), PostgreSQL (Prod) via Prisma.

## Getting Started

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Database Setup:**
    ```bash
    npx prisma migrate dev --name init
    ```

3.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    *   Frontend: http://localhost:5173
    *   Backend: http://localhost:3000

## Documentation

See `/docs` for detailed architecture and API specifications.
