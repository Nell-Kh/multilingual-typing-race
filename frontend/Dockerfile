# ---- base: dependencies ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: Vite dev server with hot reload (used by docker-compose) ----
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---- build: static production bundle ----
FROM deps AS build
# Vite bakes the API URL into the bundle at build time.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN npm run build

# ---- serve: nginx serving the bundle (default stage, used in production) ----
FROM nginx:1.27-alpine AS serve
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Only ${PORT} is substituted, so nginx's own $uri variables survive.
ENV PORT=80 \
    NGINX_ENVSUBST_FILTER=PORT
EXPOSE 80
