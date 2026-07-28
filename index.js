import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_NAME = "SPOILER-X";

// Helper function to clean up session folders after use
function deleteFolderRecursive(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const curPath = path.join(directoryPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(directoryPath);
    }
}

app.get('/', async (req, res) => {
    const number = req.query.number;
    if (!number) {
        return res.send(`
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background-color: #121212; color: white; }
                input { padding: 10px; font-size: 16px; border-radius: 5px; border: none; width: 250px; }
                button { padding: 10px 20px; font-size: 16px; border-radius: 5px; border: none; background-color: #25D366; color: white; cursor: pointer; }
            </style>
            <h2>${BOT_NAME} Session Generator</h2>
            <p>Enter your phone number with country code (e.g., 254712345678) to pair your bot:</p>
            <form action="/" method="get">
                <input type="text" name="number" placeholder="254712345678" required><br><br>
                <button type="submit">Get Pairing Code</button>
            </form>
        `);
    }

    // Clean phone number format
    const cleanedNumber = number.replace(/[^0-9]/g, '');
    // Create an isolated temporary ID folder for this specific user request
    const uniqueSessionId = `session_${Date.now()}_${cleanedNumber}`;
    const sessionDir = path.join('./temp_sessions', uniqueSessionId);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket.default({
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: false
        });

        // Request pairing code instantly for this user
        await delay(3000);
        let code = await sock.requestPairingCode(cleanedNumber);

        // Send the code to the user's web browser tab immediately
        res.write(`
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background-color: #121212; color: white; }
                .code { color: #3498db; font-family: monospace; font-size: 35px; letter-spacing: 4px; background: #222; padding: 10px; display: inline-block; border-radius: 5px; }
            </style>
            <h2>Your ${BOT_NAME} Pairing Code is:</h2>
            <div class="code">${code}</div>
            <p>Enter this code in WhatsApp -> Linked Devices -> Link with phone number</p>
            <p style="color: #aaa;">Keep this web page open. Your Session ID will appear here shortly after you link your device...</p>
        `);

        // Monitor connection status specifically for this user's process
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                try {
                    await delay(5000); // Allow system keys to settle
                    
                    // Read the credentials file that WhatsApp just verified
                    const credsContent = fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf-8');
                    
                    // Upload the creds raw content to a free online text bin (e.g., bin.scand.io or similar paste engine)
                    // For this setup, we'll convert the file string into a secure Base64 token directly.
                    // This creates a compact, single-line string users can easily copy-paste into Heroku/Render/Koyeb!
                    const sessionBase64 = Buffer.from(credsContent).toString('base64');
                    const finalSessionId = `SPOILER-X~${sessionBase64}`;

                    // Send success notification directly inside their WhatsApp chat
                    await sock.sendMessage(sock.user.id, { 
                        text: `🎉 *SUCCESSFULLY CONNECTED TO ${BOT_NAME}* 🎉\n\nHere is your unique Session ID. Keep it secret!\n\n\`\`\`${finalSessionId}\`\`\n\nCopy this ID and use it in your environment deployment settings.` 
                    });

                    // Print the token directly onto the active webpage screen for them
                    res.write(`
                        <h2 style="color: #25D366;">🎉 Connection Successful!</h2>
                        <p>Your Session ID has been sent to your WhatsApp saved messages!</p>
                        <textarea style="width: 80%; height: 100px; font-family: monospace;" readonly>${finalSessionId}</textarea>
                    `);
                    res.end();

                } catch (err) {
                    res.write(`<p style="color:red;">Error saving session string: ${err.message}</p>`);
                    res.end();
                } finally {
                    // Turn off this temporary background worker safely and wipe the folder
                    sock.logout();
                    deleteFolderRecursive(sessionDir);
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    res.write(`<p style="color:red;">Connection rejected by device.</p>`);
                    res.end();
                    deleteFolderRecursive(sessionDir);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        if (!res.writableEnded) {
            res.status(500).send(`System error processing pairing request: ${error.message}`);
        }
        deleteFolderRecursive(sessionDir);
    }
});

app.listen(PORT, () => {
    console.log(`Multi-pairing engine running smoothly on port ${PORT}`);
});
