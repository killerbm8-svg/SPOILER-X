import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import config from './settings.js';
import { connectDatabase, User } from './database.js';

const app = express();
const PORT = process.env.PORT || 3000;
const sessionPath = './session_data';

if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);

// Session check
const sessionId = process.env.SESSION_ID;
if (!sessionId) {
    console.error("❌ CRITICAL ERROR: Environment variable 'SESSION_ID' is missing!");
    process.exit(1);
}

try {
    const cleanToken = sessionId.includes('SPOILER-X~') ? sessionId.split('SPOILER-X~')[1] : sessionId;
    const decryptedCreds = Buffer.from(cleanToken, 'base64').toString('utf-8');
    fs.writeFileSync(path.join(sessionPath, 'creds.json'), decryptedCreds);
} catch (err) {
    console.error("❌ Session decode error:", err.message);
    process.exit(1);
}

async function startBot() {
    // Fire up the long-term database channel
    await connectDatabase(process.env.MONGODB_URI);

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
            console.log(`\n🎉 [${config.botName}] Core processes verified. Automation engine live with database.`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || "Unknown";
        
        // --- DATABASE TRACKING MECHANISM ---
        let userData = null;
        if (process.env.MONGODB_URI) {
            try {
                // Find user or register them instantly if they are completely new
                userData = await User.findOne({ whatsappId: senderId });
                if (!userData) {
                    userData = new User({
                        whatsappId: senderId,
                        pushName: senderName,
                        role: senderId.includes(config.ownerNumber) ? 'owner' : 'user'
                    });
                }
                userData.pushName = senderName; // Keep their name updated
                userData.lastInteraction = new Date();
                await userData.save();
            } catch (dbErr) {
                console.error("Database tracking fault:", dbErr.message);
            }
        }

        const messageType = Object.keys(msg.message)[0];
        let text = "";
        if (messageType === 'conversation') text = msg.message.conversation;
        else if (messageType === 'extendedTextMessage') text = msg.message.extendedTextMessage.text;

        if (!text.startsWith(config.prefix)) return;

        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Increment command interaction counts
        if (userData) {
            userData.commandCount += 1;
            await userData.save();
        }

        try {
            switch (command) {
                case 'ping':
                    await sock.sendMessage(from, { text: `🤖 *${config.botName}* is connected securely to the database layer.` });
                    break;

                case 'profile':
                    if (!userData) {
                        return await sock.sendMessage(from, { text: "⚠️ Database layer is unavailable." });
                    }
                    const profileText = `👤 *${config.botName} USER PROFILE* 👤\n\n` +
                                        `• *Name:* ${userData.pushName}\n` +
                                        `• *Rank Status:* ${userData.role.toUpperCase()}\n` +
                                        `• *Commands Used:* ${userData.commandCount}\n` +
                                        `• *Registered:* ${new Date(userData.firstSeen).toLocaleDateString()}`;
                    await sock.sendMessage(from, { text: profileText });
                    break;

                case 'dbstats':
                    // Admin command to get total platform registrations
                    if (userData && userData.role !== 'owner' && userData.role !== 'admin') {
                        return await sock.sendMessage(from, { text: "❌ Access denied: Administrator credentials required." });
                    }
                    const totalUsers = await User.countDocuments();
                    const topUser = await User.findOne().sort({ commandCount: -1 });
                    
                    let statsText = `📊 *${config.botName} DATABASE SNAPSHOT* 📊\n\n` +
                                    `• *Total Saved Profiles:* ${totalUsers} users\n`;
                    if (topUser) {
                        statsText += `• *Top Active User:* ${topUser.pushName} (${topUser.commandCount} hits)`;
                    }
                    await sock.sendMessage(from, { text: statsText });
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    });
}

app.get('/', (req, res) => res.send(`${config.botName} Active with Persistent Storage Engine.`));
app.listen(PORT, () => startBot());
