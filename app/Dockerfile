FROM node:20-slim

# Install wkhtmltopdf & dependencies
RUN apt-get update && apt-get install -y \
    wkhtmltopdf \
    libxrender1 \
    libfontconfig1 \
    xfonts-base \
    xfonts-75dpi \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package.json package.json
RUN npm install
COPY . .

EXPOSE 3021
CMD ["node", "server.js"]
