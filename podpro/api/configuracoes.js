// api/configuracoes.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function isAdmin(req){ return req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — qualquer um pode ler as configs públicas
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('configuracoes').select('chave, valor');
    if (error) return res.status(500).json({ error: error.message });
    const cfg = {};
    (data || []).forEach(row => { cfg[row.chave] = row.valor; });
    return res.status(200).json({ ok: true, configuracoes: cfg });
  }

  // PUT — só ADM pode alterar
  if (req.method === 'PUT') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });
    const { chave, valor } = req.body;
    if (!chave) return res.status(400).json({ error: 'chave obrigatória' });
    const { error } = await supabase.from('configuracoes')
      .upsert({ chave, valor, updated_at: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
