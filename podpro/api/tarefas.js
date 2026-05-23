const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { usuario_id } = req.query;
  if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tarefas').select('*').eq('usuario_id', usuario_id).order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tarefas: data });
  }

  if (req.method === 'POST') {
    const { texto } = req.body;
    const { data, error } = await supabase.from('tarefas').insert({ usuario_id, texto }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, tarefa: data });
  }

  if (req.method === 'PUT') {
    const { id, feita } = req.body;
    const { error } = await supabase.from('tarefas').update({ feita }).eq('id', id).eq('usuario_id', usuario_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const query = id
      ? supabase.from('tarefas').delete().eq('id', id).eq('usuario_id', usuario_id)
      : supabase.from('tarefas').delete().eq('usuario_id', usuario_id).eq('feita', true);
    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
