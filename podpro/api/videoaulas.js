const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: lista videoaulas (público para PRO) ────────────────────────────────
  if (req.method === 'GET') {
    const { banca, disciplina } = req.query;
    let query = supabase.from('videoaulas').select('*').eq('ativo', true).order('ordem');
    if (banca) query = query.eq('banca', banca);
    if (disciplina) query = query.eq('disciplina', disciplina);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ videoaulas: data });
  }

  // ── Rotas ADM: exigem senha ─────────────────────────────────────────────────
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Senha ADM incorreta.' });

  // ── POST: adicionar videoaula ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const { titulo, descricao, youtube_url, banca, disciplina, ordem } = req.body;
    if (!titulo || !youtube_url) return res.status(400).json({ error: 'Título e URL são obrigatórios.' });

    // Extrai ID do YouTube da URL
    const ytId = extrairYoutubeId(youtube_url);
    if (!ytId) return res.status(400).json({ error: 'URL do YouTube inválida.' });

    const { data, error } = await supabase
      .from('videoaulas')
      .insert({ titulo, descricao, youtube_url: `https://www.youtube.com/embed/${ytId}`, banca, disciplina, ordem: ordem || 0 })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, videoaula: data });
  }

  // ── PUT: editar videoaula ───────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório.' });
    if (updates.youtube_url) {
      const ytId = extrairYoutubeId(updates.youtube_url);
      if (ytId) updates.youtube_url = `https://www.youtube.com/embed/${ytId}`;
    }
    const { data, error } = await supabase.from('videoaulas').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, videoaula: data });
  }

  // ── DELETE: remover videoaula ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório.' });
    const { error } = await supabase.from('videoaulas').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};

function extrairYoutubeId(url) {
  const regexps = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/
  ];
  for (const r of regexps) {
    const m = url.match(r);
    if (m) return m[1];
  }
  return null;
}
