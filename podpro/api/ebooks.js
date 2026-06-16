// api/ebooks.js
// CRUD de e-books — leitura pública, escrita apenas para ADM
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function isAdmin(req) {
  return req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: listar e-books ativos ────────────────────────────────────────────
  if (req.method === 'GET') {
    const { categoria } = req.query || {};
    let query = supabase
      .from('ebooks')
      .select('id, titulo, descricao, categoria, conteudo, pdf_url, ordem, ativo, created_at')
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true });

    if (!isAdmin(req)) {
      query = query.eq('ativo', true);
    }

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    const { data: ebooks, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ebooks: ebooks || [] });
  }

  // ── POST: criar e-book (ADM) ──────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });

    const { titulo, descricao, categoria, conteudo, pdf_url, ordem } = req.body;
    if (!titulo) return res.status(400).json({ error: 'Título obrigatório' });
    if (!conteudo && !pdf_url) return res.status(400).json({ error: 'Informe conteúdo (texto) ou pdf_url' });

    const { data: ebook, error } = await supabase
      .from('ebooks')
      .insert({
        titulo,
        descricao: descricao || null,
        categoria: categoria || 'geral',
        conteudo: conteudo || null,
        pdf_url: pdf_url || null,
        ordem: parseInt(ordem) || 0,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, ebook });
  }

  // ── PUT: ativar/desativar e-book (ADM) ───────────────────────────────────
  if (req.method === 'PUT') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });

    const { id, ativo, titulo, descricao, categoria, conteudo, pdf_url, ordem } = req.body;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });

    const updates = {};
    if (ativo !== undefined) updates.ativo = ativo;
    if (titulo !== undefined) updates.titulo = titulo;
    if (descricao !== undefined) updates.descricao = descricao;
    if (categoria !== undefined) updates.categoria = categoria;
    if (conteudo !== undefined) updates.conteudo = conteudo;
    if (pdf_url !== undefined) updates.pdf_url = pdf_url;
    if (ordem !== undefined) updates.ordem = parseInt(ordem);

    const { error } = await supabase.from('ebooks').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remover e-book (ADM) ─────────────────────────────────────────
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
