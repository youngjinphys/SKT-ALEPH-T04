FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY src ./src
COPY public ./public
COPY contract ./contract
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=4173 DATA_DIR=/app/data
EXPOSE 4173
CMD ["node","server.mjs"]
