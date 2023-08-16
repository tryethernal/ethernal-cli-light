# Ethernal CLI Light

This is a simplified version of the [Ethernal CLI](https://github.com/tryethernal/cli).
The goal is to have a smaller & less memory consuming package that directly connects to the queuing Redis backend, without going through the API.

It is meant to be launched through the Ethernal PM2 server.

## Installation
`npm install ethernal-cli-light -g`
`yarn add global ethernal-cli-light`

## Usage
Only two env variables are needed:
`ETHERNAL_HOST`: Your Ethernal API endpoint
`ETHERNAL_SECRET`: Your Ethernal secret, as it's using an admin endpoint

Then call the CLI with only the workspace id as a parameter:
`ETHERNAL_HOST=https://yourethernalinstance/api ETHERNAL_SECRET=yoursecret ethernal-light 1`