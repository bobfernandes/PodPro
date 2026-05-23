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

  const { nome, email, senha, uf } = req.body;
  if (!nome || !email || !senha || !uf)
    return res.status(400).json({ error: 'Preencha todos os campos.' });

  // Verifica se email já existe
  const { data: existing } = await supabase
    .from('usuarios')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado.' });

  const { data, error } = await supabase
    .from('usuarios')
    .insert({ nome, email, senha, uf })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({
    ok: true,
    user: { id: data.id, nome: data.nome, email: data.email, uf: data.uf, is_pro: data.is_pro }
  });
};
