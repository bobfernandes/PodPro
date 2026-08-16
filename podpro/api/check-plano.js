// api/check-plano.js — retorna o plano atual do usuário
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const usuario_id = req.query?.usuario_id;
  if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

  const { data, error } = await supabase
    .from('usuários')
    .select('plano')
    .eq('id', usuario_id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ plano: data?.plano || 'ferreiro' });
};
