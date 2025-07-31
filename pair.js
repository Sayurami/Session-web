import express from 'express';
import fs from 'fs';
import axios from 'axios';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { upload } from './mega.js'; // ඔබගේ mega upload module එක

const router = express.Router();

function removeFile(FilePath) {
  try {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
  } catch (e) {
    console.error('Error removing file:', e);
  }
}

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: "Missing number parameter" });

  let dirs = './' + num;

  await removeFile(dirs);

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);

    try {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
      });

      if (!sock.authState.creds.registered) {
        await delay(2000);
        num = num.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          return res.send({ code });
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log(`Session connected for number: ${num}`);
          await delay(5000);

          function generateRandomId(length = 6, numberLength = 4) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let res = '';
            for (let i = 0; i < length; i++) {
              res += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const num = Math.floor(Math.random() * Math.pow(10, numberLength));
            return `${res}${num}`;
          }

          const sessionFilePath = `${dirs}/creds.json`;
          const megaUrl = await upload(fs.createReadStream(sessionFilePath), `${generateRandomId()}.json`);
          console.log('Session uploaded to MEGA:', megaUrl);

          // Heroku config
          const HEROKU_APP_NAME = 'gojoweb';
          const HEROKU_API_KEY = 'HRKU-AAuwrPbXoQwDgKzD6jUtwJWHycxTWfStWlIYz5V6KQQw_____wIliv9RHBTr';
          const GITHUB_TARBALL = 'https://api.github.com/repos/gojosathory2/Gojo-md-new/tarball/main/';

          try {
            // Update SESSION_ID env var
            await axios.patch(`https://api.heroku.com/apps/${HEROKU_APP_NAME}/config-vars`,
              { SESSION_ID: megaUrl },
              {
                headers: {
                  Authorization: `Bearer ${HEROKU_API_KEY}`,
                  Accept: 'application/vnd.heroku+json; version=3',
                  'Content-Type': 'application/json',
                }
              });

            console.log('✅ SESSION_ID set in Heroku config vars');

            // Trigger build/deploy
            await axios.post(`https://api.heroku.com/apps/${HEROKU_APP_NAME}/builds`,
              {
                source_blob: { url: GITHUB_TARBALL }
              },
              {
                headers: {
                  Authorization: `Bearer ${HEROKU_API_KEY}`,
                  Accept: 'application/vnd.heroku+json; version=3',
                  'Content-Type': 'application/json',
                }
              });

            console.log('🚀 Heroku deployment triggered successfully');

            if (!res.headersSent) res.send({ status: 'Heroku deploy triggered', session: megaUrl });

          } catch (err) {
            console.error('Heroku deploy error:', err.response?.data || err.message);
            if (!res.headersSent) res.status(500).send({ error: 'Heroku deploy failed' });
          }

          await delay(100);
          removeFile(dirs);
          process.exit(0);

        } else if (connection === 'close' && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
          console.log('Connection closed unexpectedly:', lastDisconnect.error);
          await delay(10000);
          initiateSession();
        }
      });

    } catch (err) {
      console.error('Session init error:', err);
      if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
    }
  }

  await initiateSession();
});

process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});

export default router;  
