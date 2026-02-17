



The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```



This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS


## Docker hot reload (dev)

This repo includes a separate dev compose file that runs hot reload without rebuilding images. It reuses the existing database volume, so your data remains intact.

```sh
# Start dev containers with hot reload
docker compose -f docker-compose.dev.yml up

# Stop dev containers (keeps volumes)
docker compose -f docker-compose.dev.yml down
```

Avoid `docker compose down -v` unless you explicitly want to delete volumes (including the database).

## Portainer dev stack

If you run everything through Portainer, use `docker-compose.dev.portainer.yml` as a Stack. It uses different ports so it can run alongside prod, and it reuses the same database volume to keep your data.

Ports:
- Frontend: `5174`
- Backend: `3003`

## Prod deploy checklist (build -> redeploy)

1) Build images on the Docker host:
```sh
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest --build-arg VITE_API_URL=/api .
```

2) In Portainer:
- Stacks → prod stack → Update the stack
- Make sure "Pull latest image" is unchecked
- Deploy
Database volume is not affected by this step.

3) If deploy fails with "container name is already in use":
```sh
docker rm -f it-ticketing-backend it-ticketing-frontend
```
Then repeat step 2.
