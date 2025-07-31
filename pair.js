import express from 'express';
import fs from 'fs';
import axios from 'axios';
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { upload } from './mega.js'; // MEGA upload function

const router = express.Router();

// 🧹 Delete temp session folder
function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: 'Missing number parameter' });

  let dirs = './' + num.replace(/[^0-9]/g, '');

  removeFile(dirs); // Clear old session folder

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);

    try {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'silent' }).child({})
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
      });

      // Show pairing code
      if (!sock.authState.creds.registered) {
        await delay(2000);
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) return res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
          console.log(`✅ Connected for: ${num}`);
          await delay(3000);

          const sessionPath = `${dirs}/creds.json`;
          const sessionStream = fs.createReadStream(sessionPath);

          // Generate random name
          const fileName = `gojo-${Math.random().toString(36).substring(2, 10)}.json`;

          const megaUrl = await upload(sessionStream, fileName);
          console.log(`📦 Session uploaded: ${megaUrl}`);

          // === HEROKU CONFIG ===
          const HEROKU_APP_NAME = 'gojoweb';
          const HEROKU_API_KEY = 'HRKU-AAuwrPbXoQwDgKzD6jUtwJWHycxTWfStWlIYz5V6KQQw_____wIliv9RHBTr';
          const GITHUB_TARBALL = 'https://api.github.com/repos/gojosathory2/Gojo-md-new/tarball/main/';

          try {
            // 1. Set SESSION_ID env
            await axios.patch(
              `https://api.heroku.com/apps/${HEROKU_APP_NAME}/config-vars`,
              { SESSION_ID: megaUrl },
              {
                headers: {
                  Authorization: `Bearer ${HEROKU_API_KEY}`,
                  Accept: 'application/vnd.heroku+json; version=3',
                  'Content-Type': 'application/json',
                },
              }
            );
            console.log('🛠️ Heroku config updated');

            // 2. Trigger deploy
            await axios.post(
              `https://api.heroku.com/apps/${HEROKU_APP_NAME}/builds`,
              {
                source_blob: {
                  url: GITHUB_TARBALL,
                },
              },
              {
                headers: {
                  Authorization: `Bearer ${HEROKU_API_KEY}`,
                  Accept: 'application/vnd.heroku+json; version=3',
                  'Content-Type': 'application/json',
                },
              }
            );
            console.log('🚀 Deployment triggered');

            if (!res.headersSent)
              res.send({ status: '✅ Deployed', session: megaUrl });
          } catch (err) {
            console.error('Heroku error:', err.response?.data || err.message);
            if (!res.headersSent)
              res.status(500).send({ error: '❌ Heroku deploy failed' });
          }

          await delay(2000);
          removeFile(dirs);
          process.exit(0);
        }
      });
    } catch (e) {
      console.error('Error:', e);
      if (!res.headersSent)
        res.status(500).send({ error: '❌ Pairing failed' });
    }
  }

  await initiateSession();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

export default router;
