const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { usuario_id } = req.query;
  if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('quiz_resultados').select('*').eq('usuario_id', usuario_id)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ resultados: data });
  }

  if (req.method === 'POST') {
    const { banca, score, total } = req.body;
    const { error } = await supabase.from('quiz_resultados').insert({ usuario_id, banca, score, total });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
