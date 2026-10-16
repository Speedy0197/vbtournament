require('dotenv').config();
const path = require('node:path');
const express = require('express');
const createApp = require('./app');
const localIcons = require('./local-icons');
const db = require('./db');
const PORT = process.env.PORT || 3000;
if (!process.env.ADMIN_PIN) console.warn('[WARNING] Set ADMIN_PIN before hosting this app.');
const app = createApp({
  db, icons: localIcons(path.join(__dirname, 'public', 'uploads', 'teams')),
  adminPin: process.env.ADMIN_PIN || '1234',
  baseUrl: process.env.BASE_URL || 'http://localhost:' + PORT,
  staticMiddleware: express.static(path.join(__dirname, 'public')),
});
app.set('views', path.join(__dirname, 'views'));
app.listen(PORT, () => console.log('Running on http://localhost:' + PORT));
