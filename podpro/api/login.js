const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ error: 'Preencha e-mail e senha.' });

  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .eq('senha', senha)
    .single();

  if (error || !data) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

  return res.status(200).json({
    ok: true,
    user: { id: data.id, nome: data.nome, email: data.email, uf: data.uf, is_pro: data.is_pro }
  });
};
