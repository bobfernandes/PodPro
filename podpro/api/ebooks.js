// api/ebooks.js — com suporte a plano_minimo
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function isAdmin(req){ return req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { plano } = req.query || {};
    const NIVEIS = { ferreiro:0, libaneo:1, vygotsky:2, piaget:3 };
    let query = supabase.from('ebooks')
      .select('id,titulo,descricao,categoria,conteudo,pdf_url,plano_minimo,ordem,ativo,created_at')
      .order('plano_minimo').order('ordem').order('created_at');
    if (!isAdmin(req)) {
      query = query.eq('ativo', true);
      if (plano) {
        const nivel = NIVEIS[plano] ?? 0;
        // retorna conteúdo cujo plano_minimo <= plano do usuário
        const planosPermitidos = Object.entries(NIVEIS)
          .filter(([,n]) => n <= nivel).map(([p]) => p);
        query = query.in('plano_minimo', planosPermitidos);
      }
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ebooks: data || [] });
  }

  if (req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });
    const { titulo, descricao, categoria, conteudo, pdf_url, plano_minimo, ordem } = req.body;
    if (!titulo) return res.status(400).json({ error: 'Título obrigatório' });
    if (!conteudo && !pdf_url) return res.status(400).json({ error: 'Informe conteúdo ou pdf_url' });
    const { data: ebook, error } = await supabase.from('ebooks').insert({
      titulo, descricao: descricao||null, categoria: categoria||'geral',
      conteudo: conteudo||null, pdf_url: pdf_url||null,
      plano_minimo: plano_minimo||'ferreiro', ordem: parseInt(ordem)||0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, ebook });
  }

  if (req.method === 'PUT') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    if (updates.ordem !== undefined) updates.ordem = parseInt(updates.ordem);
    const { error } = await supabase.from('ebooks').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const { error } = await supabase.from('ebooks').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
