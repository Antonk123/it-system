# IT Ticket System

Ett IT-ärendehanteringssystem med React-frontend och Node/Express-backend, paketerat i Docker.

## Installation

Kräver att Docker och Docker Compose är installerat på systemet.

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/Antonk123/it-system/main/setup.sh)
```

Scriptet sköter allt: klonar repot, bygger images, skapar databas och startar systemet.
När det är klart visas URL och inloggningsuppgifter i terminalen.

## Tech stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn-ui
- **Backend:** Node.js, Express, TypeScript, SQLite
- **Deploy:** Docker, Docker Compose

