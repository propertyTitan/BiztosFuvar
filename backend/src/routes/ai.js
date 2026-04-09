// AI segéd (Gemini alapú) – POST /ai/chat
// Egyszerű request/response chat. A history mezőt a kliens tárolja,
// és minden új üzenetnél újra elküldi.
const express = require('express');
const { authRequired } = require('../middleware/auth');
const { supportChat } = require('../services/gemini');

const router = express.Router();

router.post('/ai/chat', authRequired, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Hiányzó üzenet' });
  }
  const reply = await supportChat(message, Array.isArray(history) ? history : []);
  res.json(reply);
});

module.exports = router;
