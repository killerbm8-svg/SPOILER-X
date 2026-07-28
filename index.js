import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import config from './settings.js';

// Ensure the auth folder exists
const sessionPath = './session_data';
if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath);
}

// Extract and reconstruct login credentials from environment variable
const sessionId = process.env.SESSION_ID;
if (!sessionId) {
    console.error("❌ CRITICAL ERROR: Environment variable 'SESSION_ID' is missing!");
    process.exit(1);
}

try {
    const base64Data = sessionId.split('SPOILER-X~')[1];
    if (!base64Data) throw new Error("Invalid Session ID format.");
    const decryptedCreds = Buffer.from(base64Data, 'base64').toString('utf-8');
    fs.writeFileSync(path.join(sessionPath, 'creds.json'), decryptedCreds);
} catch (err) {
    console.error("❌ Failed to decode your SESSION_ID string:", err.message);
    process.exit(1);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket.default({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`\n🎉 [SPOILER-X] Successfully authenticated and online!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const msg = chatUpdate.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        let text = "";

        if (messageType === 'conversation') text = msg.message.conversation;
        else if (messageType === 'extendedTextMessage') text = msg.message.extendedTextMessage.text;

        if (!text.startsWith(config.prefix)) return;

        const from = msg.key.remoteJid;
        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Standard Bot Response Command Loops
        try {
            switch (command) {
                case 'ping':
                    await sock.sendMessage(from, { text: `🤖 *${config.botName}* is active and processing.` });
                    break;
                case 'menu':
                case 'help':
                    const uiText = `✨ *${config.botName} Dashboard* ✨\n\n` +
                                   `• *Prefix:* [ ${config.prefix} ]\n` +
                                   `• *Mode:* ${config.workMode}\n\n` +
                                   `*Commands Available:*\n` +
                                   `▫️ \`${config.prefix}ping\` - Verify uptime state\n` +
                                   `▫️ \`${config.prefix}alive\` - Current health status\n` +
                                   `▫️ \`${config.prefix}owner\` - Profile metadata`;
                    await sock.sendMessage(from, { text: uiText });
                    break;
                case 'alive':
                    await sock.sendMessage(from, { text: `System operational under *${config.ownerName}*'s parameters.` });
                    break;
                case 'owner':
                    await sock.sendMessage(from, { text: `Bot creator registry matching phone signature: ${config.ownerNumber}` });
                    break;
            }
        } catch (e) {
            console.error("Command Execution Error:", e);
        }
    });
}

startBot();
