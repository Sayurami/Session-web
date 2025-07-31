import express from 'express';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  makeInMemoryStore,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys';
import P from 'pino';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const store = makeInMemoryStore({ logger: P().child({ level: 'silent', stream: 'store' }) });

async function downloadAndUploadSession(sessionPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(sessionPath), 'creds.json');

  const response = await axios.post('https://tmp.ninja/api/upload', form, {
    headers: form.getHeaders(),
  });

  return response.data.files[0].url;
}

async function triggerHerokuDeploy(sessionUrl) {
  const appName = 'gojomain';
  const herokuApiKey = 'HRKU-AAuwrPbXoQwDgKzD6jUtwJWHycxTWfStWlIYz5V6KQQw_____wIliv9RHBTr';
  const githubRepo = 'gojosathory2/Gojo-md-new';

  const configVars = {
    SESSION_ID: sessionUrl
  };

  try {
    await axios.patch(`https://api.heroku.com/apps/${appName}/config-vars`, configVars, {
      headers: {
        Authorization: `Bearer ${herokuApiKey}`,
        Accept: 'application/vnd.heroku+json; version=3',
        'Content-Type': 'application/json',
      }
    });

    await axios.post(`https://api.heroku.com/apps/${appName}/builds`, {
      source_blob: {
        url: `https://github.com/${githubRepo}/tarball/main/`
      }
    }, {
      headers: {
        Authorization: `Bearer ${herokuApiKey}`,
        Accept: 'application/vnd.heroku+json; version=3',
        'Content-Type': 'application/json',
      }
    });

    console.log('🔁 Heroku deploy trigger successful!');
  } catch (error) {
    console.error('❌ Heroku Deploy Error:', error?.response?.data || error.message);
  }
}

app.get('/', async (req, res) => {
  const number = req.query.number;
  if (!number) return res.send('Number is missing');

  const { state, saveCreds } = await useMultiFileAuthState(join(tmpdir(), `session-${Date.now()}`));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: ['GOJO', 'safari', '1.0']
  });

  store.bind(sock.ev);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('connection closed due to', lastDisconnect?.error, ', reconnecting', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      await sock.sendMessage(`${number}@s.whatsapp.net`, {
        text: '*🟢 Your WhatsApp is successfully paired with GOJO MD.*\n\nWait a few seconds while we deploy your bot...'
      });

      await saveCreds();
      const sessionPath = join(state.credsPath, 'creds.json');
      const stringSession = await downloadAndUploadSession(sessionPath);

      await sock.sendMessage(`${number}@s.whatsapp.net`, {
        text: `✅ Your Session is Ready!\n\n🔗 ${stringSession}`
      });

      await triggerHerokuDeploy(stringSession);

      process.exit(0);
    }
  });
});

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
