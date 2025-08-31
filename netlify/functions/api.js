// netlify/functions/api.js
const { Pool } = require('pg');

exports.handler = async (event, context) => {
  // Configuración - Netlify usa process.env
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const DATABASE_URL = process.env.DATABASE_URL;

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Habilitar CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const client = await pool.connect();
    
    if (event.path === '/api/chat' && event.httpMethod === 'POST') {
      const { message, chat_id = '1' } = JSON.parse(event.body);
      
      // 1. Guardar mensaje del usuario
      await client.query(
        'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
        [chat_id, 'user', message]
      );

      // 2. Obtener historial
      const historyResult = await client.query(
        'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 20',
        [chat_id]
      );

      // 3. Llamar a DeepSeek
      const deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'Eres un asistente útil con memoria infinita. Responde en español.'
            },
            ...historyResult.rows.map(row => ({ role: row.role, content: row.content }))
          ],
          max_tokens: 2000
        })
      });

      const aiData = await deepseekResponse.json();
      const aiResponse = aiData.choices[0].message.content;

      // 4. Guardar respuesta
      await client.query(
        'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
        [chat_id, 'assistant', aiResponse]
      );

      client.release();
      
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ response: aiResponse })
      };
    }

    client.release();
    return {
      statusCode: 404,
      body: 'Not Found'
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
