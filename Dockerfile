FROM node:alpine3.24

RUN apk update && apk upgrade --no-cache

WORKDIR /usr/src/app/

# copy package.json, and package-lock.json if exists
COPY package*.json ./

RUN npm install --omit=dev
RUN npm cache clean --force

COPY . .