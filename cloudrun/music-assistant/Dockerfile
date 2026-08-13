FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ncm-output.js netease-web.js ./

ENV PORT=8080
ENV NCM_HOME=/data/ncm
RUN mkdir -p /data/ncm

EXPOSE 8080
CMD ["npm", "start"]
