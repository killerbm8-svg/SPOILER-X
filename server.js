import express from 'express';
import makeWASocket, { useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

function cleanFolder(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (!fs.lstatSync(curPath).isDirectory()) fs.unlinkSync(curPath);
        });
        fs.rmdirSync(dirPath);
    }
}

app.get('/', async (req, res) => {
    const number = req.query.number;
    if (!number) {
        return res.send(`
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 80px; background-color: #121212; color: white; }
                input { padding: 12px; font-size: 16px; border-radius: 8px; border: 1px solid #333; width: 280px; background: #222; color: white; }
                button { padding: 12px 24px; font-size: 16px; border-radius: 8px; border: none; background-color: #25D366; color: white; font-weight: bold; cursor: pointer; }
            </style>
            <h2>SPOILER-X Code Generator</h2>
            <p>Enter your WhatsApp number with country code to pair:</p>
            <form action="/" method="get">
                <input type="text" name="number" placeholder="e.g. 254712345678" required><br><br>
                <button type="submit">Generate Link Code</button>
            </form>
        `);
    }

    const cleanNum = number.replace(/[^0-9]/g, '');
    const tempId = `pairing_${Date.now()}_${cleanNum}`;
    const tempDir = path.join('./temp_auth', tempId);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        const sock = makeWASocket.default({
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: false
        });

        await delay(3000);
        let code = await sock.requestPairingCode(cleanNum);

        res.write(`
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 80px; background-color: #121212; color: white; }
                .box { color: #3498db; font-family: monospace; font-size: 38px; letter-spacing: 5px; background: #222; padding: 15px; display: inline-block; border-radius: 8px; border: 1px solid #333; }
            </style>
            <h2>Your SPOILER-X Link Code:</h2>
            <div class="box">${code}</div>
            <p>Go to WhatsApp -> Linked Devices -> Link with phone number instead and enter this code.</p>
            <p style="color: #888;">Keep this tab open! Your Session ID will display here after you link it.</p>
        `);

        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                await delay(4000);
                const rawCreds = fs.readFileSync(path.join(tempDir, 'creds.json'), 'utf-8');
                const base64Token = Buffer.from(rawCreds).toString('base64');
                const finalSessionId = `SPOILER-X~${base64Token}`;

                await sock.sendMessage(sock.user.id, { 
                    text: `👋 *Welcome to SPOILER-X*\n\nHere is your secure Session ID token string:\n\n\`\`\`${finalSessionId}\`\`\`\n\nCopy this entire text block to deploy your bot.` 
                });

                res.write(`
                    <h3 style="color: #25D366; margin-top:30px;">🎉 Device successfully paired!</h3>
                    <p>Your token has been sent to your WhatsApp chats. You can also copy it directly below:</p>
                    <textarea style="width: 85%; height: 120px; background:#222; color:#3498db; font-family:monospace; border:1px solid #333; padding:10px; border-radius:5px;" readonly>${finalSessionId}</textarea>
                `);
                res.end();
                sock.logout();
                cleanFolder(tempDir);
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        if (!res.writableEnded) res.status(500).send(`Error: ${err.message}`);
        cleanFolder(tempDir);
    }
});

app.listen(PORT, () => console.log(`Generator web engine live on port ${PORT}`));

