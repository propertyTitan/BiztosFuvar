// AI segéd (Gemini alapú) – POST /ai/chat
// Egyszerű request/response chat. A history mezőt a kliens tárolja,
// és minden új üzenetnél újra elküldi.
const express = require('express');
const { authRequired, requireVerifiedEmail } = require('../middleware/auth');
const { supportChat, AI_CHAT_MAX_MESSAGE_CHARS } = require('../services/gemini');
const { aiChatRateLimit, aiChatDailyRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Percenként max 20, naponta max 200 üzenetet küldhet egy user — elegendő
// normál használathoz és védi a Gemini kvótát a botoktól.
// ⚠️ 2026-09-28 (audit P1, R2-4): eddig e-mail-kapu és hossz-korlát nélkül
// futott — egy meg sem erősített fiók percenként 20 × ~2 MB bemenetet
// küldethetett a fizetős Gemini-re, a közös kvóta kimerülése pedig a
// KYC-ellenőrzést is 429-re futtatta. Az előzményt a supportChat tisztítja
// (≤20 elem, elemenként ≤2000 karakter).
router.post('/ai/chat', authRequired, requireVerifiedEmail, aiChatRateLimit, aiChatDailyRateLimit, async (req, res) => {
  const { message, history } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Hiányzó üzenet' });
  }
  const uzenet = message.trim();
  if (uzenet.length > AI_CHAT_MAX_MESSAGE_CHARS) {
    return res.status(400).json({
      error: `Az üzenet legfeljebb ${AI_CHAT_MAX_MESSAGE_CHARS} karakter lehet — rövidítsd, kérlek.`,
      code: 'AI_MESSAGE_TOO_LONG',
    });
  }
  const reply = await supportChat(uzenet, history);
  res.json(reply);
});

module.exports = router;
