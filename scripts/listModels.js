require('dotenv').config();

const axios = require('axios');

async function listModels() {
  try {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Missing GOOGLE_API_KEY or GEMINI_API_KEY in environment.');
      process.exit(1);
    }

    const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    const { data } = await axios.get(url);

    const models = data.models || [];
    for (const m of models) {
      const name = m.name || m.model || 'unknown';
      const methods = m.supportedMethods || m.supported_methods || m.supportedGenerationMethods || [];
      console.log(JSON.stringify({ name, supported: methods }, null, 2));
    }
  } catch (err) {
    console.error('Error listing models:', err?.response?.data || err.message || err);
    process.exit(1);
  }
}

listModels();