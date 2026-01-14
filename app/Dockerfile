FROM node:20-slim

WORKDIR /usr/src/app
COPY package.json package.json
RUN npm install
COPY . .

EXPOSE 3021
CMD ["node", "server.js"]
