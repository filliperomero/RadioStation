FROM node:17-slim

RUN apt-get update \
  && apt-get install -y sox libsox-fmt-mp3

  # libsox-fmt-all -> all formats

WORKDIR /radio/

COPY package.json yarn.lock /radio/

RUN yarn

COPY . .

USER node

CMD yarn dev