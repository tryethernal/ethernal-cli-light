#!/usr/bin/env node
import axios from 'axios';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const secret = process.env.ETHERNAL_SECRET;
const apiHost = process.env.ETHERNAL_HOST || 'http://localhost:8888';
const redisUrl = process.env.ETHERNAL_REDIS_URL || 'redis://127.0.0.1:6379';

if (!secret) {
    console.log(`Pass the secret with the ETHERNAL_SECRET env variable.`);
    process.exit(1);
}

const args = process.argv.slice(2);
const workspaceId = args[0];

if (!workspaceId) {
    console.log(`Pass the workspace id as an argument. Example: ethernal-cli-light 1`);
    process.exit(1);
}

const defaultJobOptions = {
    attempts: 50,
    removeOnComplete: {
        count: 100,
        age: 4 * 60
    },
    timeout: 30000,
    backoff: {
        type: 'exponential',
        delay: 1000
    }
};

const connection = new Redis(redisUrl);
const queue = new Queue('blockSync', { connection, defaultJobOptions });

const getProvider = (_rpcServer: string) => {
    try {
        const rpcServer = new URL(_rpcServer);
        const provider = { JsonRpcProvider, WebSocketProvider }[rpcServer.protocol == 'ws:' || rpcServer.protocol == 'wss:' ? 'WebSocketProvider' : 'JsonRpcProvider'];
        return new provider(_rpcServer);
    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};

const main = async () => {
    const { data: workspace } = await axios.get(`${apiHost}/api/workspaces/${workspaceId}`, { params: { secret }});
    
    if (!workspace) {
        console.log(`Couldn't find workspace with id ${workspaceId}.`);
        process.exit(1);
    }

    if (!workspace.user) {
        console.log(`This workspace doesn't seem to have an user (workspace id: "${workspaceId}").`);
        process.exit(1);
    }

    const rpcServer = workspace.rpcServer;
    const provider = getProvider(rpcServer);

    provider.on('error', async error => {
        if (error && error.reason)
            console.log(`Could not connect to ${rpcServer}. Error: ${error.reason}. Retrying...`);
        else
            console.log(`Could not connect to ${rpcServer}. Retrying...`);
    });

    provider.on('block', async (blockNumber, error) => {
        if (error && error.reason)
            return console.log(`Error while receiving data: ${error.reason}`);
    
        console.log(`Syncing block #${blockNumber}...`);
        await queue.add(`blockSync-${workspaceId}-${blockNumber}`, {
            userId: workspace.user.firebaseUserId,
            workspace: workspace.name,
            blockNumber,
            source: 'cli-light'
        });
    });
};

main();
