#!/usr/bin/env node
import axios from 'axios';
import { defineChain, createPublicClient, http, webSocket } from 'viem';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const secret = process.env.ETHERNAL_SECRET;
const apiHost = process.env.ETHERNAL_HOST || 'http://localhost:8888';
const redisUrl = process.env.ETHERNAL_REDIS_URL || 'redis://127.0.0.1:6379';
const defaultPollingInterval = process.env.DEFAULT_POLLING_INTERVAL || 4000;

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
        return rpcServer.protocol == 'ws:' || rpcServer.protocol == 'wss:' ? { http: [], webSocket: [_rpcServer] } : { http: [_rpcServer], webSocket: [] };
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

    const chain = defineChain({
        id: workspace.networkId,
        name: workspace.name,
        network: workspace.name,
        nativeCurrency: {
            decimals: 18,
            name: 'Ether',
            symbol: 'ETH'
        },
        rpcUrls: {
            default: getProvider(workspace.rpcServer),
            public: getProvider(workspace.rpcServer)
        }
    });

    const fetchOptions = () => {
        const rpcServer: URL = new URL(workspace.rpcServer);
        if (rpcServer.username.length || rpcServer.password.length) {
            const base64Credentials = btoa(`${rpcServer.username}:${rpcServer.password}`);
            return { headers: { 'Authorization': `Basic ${base64Credentials}` }};
        }
        else
            return {};
    };

    const transport = workspace.rpcServer.startsWith('ws') ? webSocket() : http(new URL(workspace.rpcServer).origin, { fetchOptions: fetchOptions() });

    const client = createPublicClient({ chain, transport });

    let firstBlock = !workspace.skipFirstBlock;
    const pollingInterval = parseInt(workspace.pollingInterval || defaultPollingInterval);
    client.watchBlocks({
        pollingInterval,
        emitMissed: !!workspace.emitMissedBlocks,
        onBlock: async block => {
            if (!firstBlock) firstBlock = true;
            else {
                if (!block)
                    return console.log(`Error while receiving block.`);
                await queue.add(`blockSync-${workspaceId}-${block.number}`, {
                    userId: workspace.user.firebaseUserId,
                    workspace: workspace.name,
                    blockNumber: parseInt(block.number.toString()),
                    source: 'cli-light'
                }, { priority: 1 });
                console.log(`Synced block #${block.number}...`);
            }
        },

        onError: error => {
            if (workspace.skipFirstBlock)
                firstBlock = false;
            if (error && error.message)
                console.log(`Could not connect to ${workspace.rpcServer}. Error: ${error.message}. Retrying...`);
            else
                console.log(`Could not connect to ${workspace.rpcServer}. Retrying...`);
        }
    });
};

main();